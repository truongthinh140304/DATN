import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { AppError, asyncHandler, pagination } from "../../utils/http.js";
import { listQuery, uuidParam } from "../../utils/schemas.js";

export const sessionsRouter = Router();

const checkInBody = z.object({
  vehicleId: z.string().uuid(),
  spotId: z.string().uuid(),
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
          spot: { include: { area: { include: { lot: true } } } },
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
      const vehicle = await tx.vehicle.findUniqueOrThrow({
        where: { id: body.vehicleId },
      });
      if (req.user!.role !== "ADMIN" && vehicle.ownerId !== req.user!.id)
        throw new AppError(403, "Vehicle does not belong to current user");

      if (body.reservationId) {
        const reservation = await tx.reservation.findUniqueOrThrow({
          where: { id: body.reservationId },
        });
        if (
          reservation.vehicleId !== body.vehicleId ||
          reservation.spotId !== body.spotId
        ) {
          throw new AppError(
            400,
            "Reservation does not match vehicle and spot",
          );
        }
        if (!["CONFIRMED", "PENDING"].includes(reservation.status))
          throw new AppError(409, "Reservation is not valid for check-in");
        await tx.reservation.update({
          where: { id: reservation.id },
          data: { status: "CHECKED_IN", checkedInAt: new Date() },
        });
      } else {
        const updatedSpot = await tx.parkingSpot.updateMany({
          where: { id: body.spotId, isActive: true, status: "AVAILABLE" },
          data: { status: "OCCUPIED" },
        });
        if (updatedSpot.count !== 1)
          throw new AppError(409, "Spot is not available");
      }

      await tx.parkingSpot.update({
        where: { id: body.spotId },
        data: { status: "OCCUPIED" },
      });
      return tx.parkingSession.create({
        data: {
          userId: vehicle.ownerId,
          vehicleId: body.vehicleId,
          spotId: body.spotId,
          reservationId: body.reservationId,
          notes: body.notes,
        },
        include: { vehicle: true, spot: true, reservation: true },
      });
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
      const updated = await tx.parkingSession.update({
        where: { id },
        data: { status: "COMPLETED", checkedOutAt: new Date() },
      });
      await tx.parkingSpot.update({
        where: { id: current.spotId },
        data: { status: "AVAILABLE" },
      });
      if (current.reservationId) {
        await tx.reservation.update({
          where: { id: current.reservationId },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
      }
      return updated;
    });
    return res.json({ session });
  }),
);
