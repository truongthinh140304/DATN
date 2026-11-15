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
      if (!vehicle.isActive) throw new AppError(409, "Vehicle is inactive");
      const spot = await tx.parkingSpot.findUniqueOrThrow({
        where: { id: body.spotId },
        include: { area: { include: { lot: true } } },
      });
      if (!spot.isActive || !spot.area.isActive || !spot.area.lot.isActive)
        throw new AppError(409, "Parking location is inactive");
      const now = new Date();

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
        if (
          reservation.status !== "CONFIRMED" ||
          reservation.startsAt > now ||
          reservation.expiresAt <= now ||
          reservation.userId !== vehicle.ownerId
        )
          throw new AppError(409, "Reservation is not valid for check-in");
        const claimed = await tx.reservation.updateMany({
          where: {
            id: reservation.id,
            status: "CONFIRMED",
            startsAt: { lte: now },
            expiresAt: { gt: now },
          },
          data: { status: "CHECKED_IN", checkedInAt: new Date() },
        });
        if (claimed.count !== 1)
          throw new AppError(409, "Reservation has already changed");
        const claimedSpot = await tx.parkingSpot.updateMany({
          where: { id: body.spotId, isActive: true, status: "RESERVED" },
          data: { status: "OCCUPIED" },
        });
        if (claimedSpot.count !== 1)
          throw new AppError(
            409,
            "Reserved spot is no longer available for check-in",
          );
      } else {
        const conflicting = await tx.reservation.findFirst({
          where: {
            OR: [{ spotId: body.spotId }, { vehicleId: body.vehicleId }],
            status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
          },
        });
        if (conflicting)
          throw new AppError(
            409,
            "Vehicle or spot has an active reservation; select the reservation",
          );
        const updatedSpot = await tx.parkingSpot.updateMany({
          where: { id: body.spotId, isActive: true, status: "AVAILABLE" },
          data: { status: "OCCUPIED" },
        });
        if (updatedSpot.count !== 1)
          throw new AppError(409, "Spot is not available");
      }

      const created = await tx.parkingSession.create({
        data: {
          userId: vehicle.ownerId,
          vehicleId: body.vehicleId,
          spotId: body.spotId,
          reservationId: body.reservationId,
          notes: body.notes,
        },
        include: { vehicle: true, spot: true, reservation: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          action: "SESSION_CHECK_IN",
          entityType: "ParkingSession",
          entityId: created.id,
          metadata: {
            spotId: body.spotId,
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
      const claimed = await tx.parkingSession.updateMany({
        where: { id, status: "ACTIVE" },
        data: { status: "COMPLETED", checkedOutAt: new Date() },
      });
      if (claimed.count !== 1)
        throw new AppError(409, "Session has already changed");
      const spot = await tx.parkingSpot.findUniqueOrThrow({
        where: { id: current.spotId },
        include: { area: { include: { lot: true } } },
      });
      if (spot.status !== "INACTIVE") {
        const released = await tx.parkingSpot.updateMany({
          where: { id: current.spotId, status: "OCCUPIED" },
          data: {
            status:
              spot.isActive && spot.area.isActive && spot.area.lot.isActive
                ? "AVAILABLE"
                : "INACTIVE",
          },
        });
        if (released.count !== 1)
          throw new AppError(
            409,
            "Spot state is inconsistent with this session",
          );
      }
      if (current.reservationId) {
        const completed = await tx.reservation.updateMany({
          where: {
            id: current.reservationId,
            status: "CHECKED_IN",
            vehicleId: current.vehicleId,
            spotId: current.spotId,
          },
          data: { status: "COMPLETED", completedAt: new Date() },
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
      return tx.parkingSession.findUniqueOrThrow({ where: { id } });
    });
    return res.json({ session });
  }),
);
