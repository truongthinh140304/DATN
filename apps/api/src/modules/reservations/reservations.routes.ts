import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { AppError, asyncHandler, pagination } from "../../utils/http.js";
import { listQuery, uuidParam } from "../../utils/schemas.js";
import {
  expireStaleReservations,
  getLotUsage,
  lockParkingLot,
} from "../parking/parking.service.js";

export const reservationsRouter = Router();

const reserveBody = z.object({
  vehicleId: z.string().uuid(),
  lotId: z.string().uuid(),
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
});

reservationsRouter.use(requireAuth);

reservationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuery
      .extend({ status: z.string().optional() })
      .parse(req.query);
    const page = pagination(query);
    const now = new Date();
    const scopeFilter =
      req.user!.role === "ADMIN" ? {} : { userId: req.user!.id };
    const where = {
      ...scopeFilter,
      ...(query.status ? { status: query.status as never } : {}),
    };
    const [items, total] = await prisma.$transaction(async (tx) => {
      await expireStaleReservations(tx, now, scopeFilter);
      return Promise.all([
        tx.reservation.findMany({
          where,
          skip: page.skip,
          take: page.take,
          include: {
            vehicle: true,
            lot: true,
          },
          orderBy: { createdAt: "desc" },
        }),
        tx.reservation.count({ where }),
      ]);
    });
    return res.json({ items, page: page.page, pageSize: page.pageSize, total });
  }),
);

reservationsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = reserveBody.parse(req.body);
    const now = new Date();
    const startsAt = body.startsAt ?? now;
    const expiresAt =
      body.expiresAt ?? new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
    if (expiresAt <= startsAt)
      throw new AppError(400, "expiresAt must be after startsAt");
    if (expiresAt <= now)
      throw new AppError(400, "Cannot create an already expired reservation");

    const reservation = await prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.findUniqueOrThrow({
        where: { id: body.vehicleId },
      });
      if (req.user!.role !== "ADMIN" && vehicle.ownerId !== req.user!.id)
        throw new AppError(403, "Vehicle does not belong to current user");
      if (!vehicle.isActive) throw new AppError(409, "Vehicle is inactive");

      const lot = await lockParkingLot(tx, body.lotId);
      if (!lot.isActive)
        throw new AppError(409, "Parking location is inactive");

      await expireStaleReservations(tx, now, {
        OR: [{ lotId: body.lotId }, { vehicleId: body.vehicleId }],
      });

      const [existingBooking, activeSession, usage] = await Promise.all([
        tx.reservation.findFirst({
          where: {
            vehicleId: body.vehicleId,
            status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
          },
        }),
        tx.parkingSession.findFirst({
          where: { vehicleId: body.vehicleId, status: "ACTIVE" },
        }),
        getLotUsage(tx, body.lotId, lot.capacity, now),
      ]);
      if (existingBooking || activeSession) {
        throw new AppError(
          409,
          "Vehicle already has an active reservation or parking session",
        );
      }
      if (usage.usedSlots >= lot.capacity) {
        throw new AppError(409, "Parking lot is full");
      }

      return tx.reservation.create({
        data: {
          userId: vehicle.ownerId,
          vehicleId: body.vehicleId,
          lotId: body.lotId,
          startsAt,
          expiresAt,
          status: "CONFIRMED",
          paymentStatus: "NOT_REQUIRED",
        },
        include: { vehicle: true, lot: true },
      });
    });

    return res.status(201).json({ reservation });
  }),
);

reservationsRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const reservation = await prisma.$transaction(async (tx) => {
      const current = await tx.reservation.findUniqueOrThrow({ where: { id } });
      if (req.user!.role !== "ADMIN" && current.userId !== req.user!.id)
        throw new AppError(403, "Insufficient permission");
      if (!["PENDING", "CONFIRMED"].includes(current.status))
        throw new AppError(409, "Reservation cannot be cancelled");
      const claimed = await tx.reservation.updateMany({
        where: { id, status: { in: ["PENDING", "CONFIRMED"] } },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      if (claimed.count !== 1)
        throw new AppError(409, "Reservation has already changed");
      return tx.reservation.findUniqueOrThrow({
        where: { id },
        include: { vehicle: true, lot: true },
      });
    });
    return res.json({ reservation });
  }),
);
