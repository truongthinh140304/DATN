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

export const sessionsRouter = Router();

const checkInBody = z.object({
  vehicleId: z.string().uuid(),
  lotId: z.string().uuid(),
  reservationId: z.string().uuid().optional(),
  notes: z.string().trim().max(500).optional(),
});

sessionsRouter.use(requireAuth);

sessionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuery
      .extend({ status: z.enum(["ACTIVE", "COMPLETED"]).optional() })
      .parse(req.query);
    const page = pagination(query);
    const where = {
      ...(req.user!.role === "ADMIN" ? {} : { userId: req.user!.id }),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.parkingSession.findMany({
        where,
        skip: page.skip,
        take: page.take,
        include: {
          vehicle: true,
          lot: true,
          reservation: true,
        },
        orderBy: { checkedInAt: "desc" },
      }),
      prisma.parkingSession.count({ where }),
    ]);
    return res.json({ items, page: page.page, pageSize: page.pageSize, total });
  }),
);

sessionsRouter.post(
  "/check-in",
  asyncHandler(async (req, res) => {
    const body = checkInBody.parse(req.body);
    const session = await prisma.$transaction(async (tx) => {
      const now = new Date();
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

      const activeSession = await tx.parkingSession.findFirst({
        where: { vehicleId: body.vehicleId, status: "ACTIVE" },
      });
      if (activeSession)
        throw new AppError(
          409,
          "Vehicle already has an active parking session",
        );

      if (body.reservationId) {
        const reservation = await tx.reservation.findUniqueOrThrow({
          where: { id: body.reservationId },
        });
        if (
          reservation.vehicleId !== body.vehicleId ||
          reservation.lotId !== body.lotId
        ) {
          throw new AppError(
            400,
            "Reservation does not match vehicle and parking lot",
          );
        }
        if (
          reservation.status !== "CONFIRMED" ||
          reservation.startsAt > now ||
          reservation.expiresAt <= now ||
          reservation.userId !== vehicle.ownerId
        )
          throw new AppError(409, "Reservation is not valid for check-in");
        if (reservation.paymentStatus === "UNPAID")
          throw new AppError(409, "Reservation payment is required");
        const claimed = await tx.reservation.updateMany({
          where: {
            id: reservation.id,
            status: "CONFIRMED",
            startsAt: { lte: now },
            expiresAt: { gt: now },
          },
          data: { status: "CHECKED_IN", checkedInAt: now },
        });
        if (claimed.count !== 1)
          throw new AppError(409, "Reservation has already changed");
      } else {
        const conflicting = await tx.reservation.findFirst({
          where: {
            vehicleId: body.vehicleId,
            status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
          },
        });
        if (conflicting)
          throw new AppError(
            409,
            "Vehicle has an active reservation; select the reservation",
          );
        const usage = await getLotUsage(tx, body.lotId, lot.capacity, now);
        if (usage.usedSlots >= lot.capacity)
          throw new AppError(409, "Parking lot is full");
      }

      const created = await tx.parkingSession.create({
        data: {
          userId: vehicle.ownerId,
          vehicleId: body.vehicleId,
          lotId: body.lotId,
          reservationId: body.reservationId,
          notes: body.notes,
        },
        include: { vehicle: true, lot: true, reservation: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          action: "SESSION_CHECK_IN",
          entityType: "ParkingSession",
          entityId: created.id,
          metadata: {
            lotId: body.lotId,
            vehicleId: body.vehicleId,
            reservationId: body.reservationId ?? null,
          },
        },
      });
      return created;
    });
    return res.status(201).json({ session });
  }),
);

sessionsRouter.post(
  "/:id/check-out",
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const session = await prisma.$transaction(async (tx) => {
      const current = await tx.parkingSession.findUniqueOrThrow({
        where: { id },
      });
      if (req.user!.role !== "ADMIN" && current.userId !== req.user!.id)
        throw new AppError(403, "Insufficient permission");
      if (current.status !== "ACTIVE")
        throw new AppError(409, "Session is already completed");
      const now = new Date();
      const claimed = await tx.parkingSession.updateMany({
        where: { id, status: "ACTIVE" },
        data: { status: "COMPLETED", checkedOutAt: now },
      });
      if (claimed.count !== 1)
        throw new AppError(409, "Session has already changed");
      if (current.reservationId) {
        const completed = await tx.reservation.updateMany({
          where: {
            id: current.reservationId,
            status: "CHECKED_IN",
            vehicleId: current.vehicleId,
            lotId: current.lotId,
          },
          data: { status: "COMPLETED", completedAt: now },
        });
        if (completed.count !== 1)
          throw new AppError(
            409,
            "Reservation state is inconsistent with this session",
          );
      }
      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          action: "SESSION_CHECK_OUT",
          entityType: "ParkingSession",
          entityId: id,
        },
      });
      return tx.parkingSession.findUniqueOrThrow({
        where: { id },
        include: { vehicle: true, lot: true, reservation: true },
      });
    });
    return res.json({ session });
  }),
);
