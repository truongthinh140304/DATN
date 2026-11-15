import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { AppError, asyncHandler, pagination } from "../../utils/http.js";
import { listQuery, uuidParam } from "../../utils/schemas.js";
import { matchReservation, normalizePlate } from "../vision/plate-matching.js";

export const reservationsRouter = Router();

const reserveBody = z.object({
  vehicleId: z.string().uuid(),
  spotId: z.string().uuid(),
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
});

reservationsRouter.use(requireAuth);

reservationsRouter.get(
  "/:id/verification",
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const result = await prisma.$transaction(
      async (tx) => {
        const reservation = await tx.reservation.findUniqueOrThrow({
          where: { id },
          include: { vehicle: true, spot: true },
        });
        if (req.user!.role !== "ADMIN" && reservation.userId !== req.user!.id)
          throw new AppError(403, "Insufficient permission");
        const now = new Date();
        const base = {
          reservationId: id,
          spotId: reservation.spotId,
          spotCode: reservation.spot.code,
          expectedPlate: normalizePlate(reservation.vehicle.plateNumber),
          matchStatus: "INSUFFICIENT",
          reason: "waiting_for_camera",
          observation: null,
        };
        if (
          !["CONFIRMED", "CHECKED_IN"].includes(reservation.status) ||
          now < reservation.startsAt ||
          now >= reservation.expiresAt
        )
          return { ...base, reason: "reservation_not_effective" };
        const observation = await tx.cameraObservation.findFirst({
          where: {
            spotId: reservation.spotId,
            observedAt: {
              gte: new Date(
                Math.max(
                  reservation.startsAt.getTime(),
                  reservation.createdAt.getTime(),
                ),
              ),
              lt: reservation.expiresAt,
              lte: new Date(now.getTime() + 30_000),
            },
            receivedAt: { gte: reservation.createdAt },
          },
          orderBy: [
            { observedAt: "desc" },
            { receivedAt: "desc" },
            { id: "desc" },
          ],
        });
        if (!observation) return base;
        if (now.getTime() - observation.observedAt.getTime() > 60_000)
          return { ...base, reason: "camera_observation_stale" };
        const candidates = await tx.reservation.findMany({
          where: {
            spotId: reservation.spotId,
            status: { in: ["CONFIRMED", "CHECKED_IN"] },
            startsAt: { lte: observation.observedAt },
            expiresAt: { gt: observation.observedAt },
          },
          include: { vehicle: { select: { plateNumber: true } } },
        });
        const match = matchReservation(
          { ...observation, timestamp: observation.observedAt },
          candidates,
        );
        // USER may see their own matching plate, but never another vehicle's plate.
        const maySeePlate =
          req.user!.role === "ADMIN" || match.matchStatus === "MATCH";
        return {
          ...base,
          matchStatus: match.matchStatus,
          reason: match.matchReason,
          observation: {
            observedAt: observation.observedAt,
            occupancyStatus: observation.occupancyStatus,
            recognitionStatus: observation.recognitionStatus,
            plateNormalized: maySeePlate ? match.plateNormalized : null,
            plateHidden: !maySeePlate && !!match.plateNormalized,
            ocrConfidence: observation.ocrConfidence,
            plateSamples: observation.plateSamples,
          },
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
    res.setHeader("Cache-Control", "no-store");
    return res.json(result);
  }),
);

reservationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuery
      .extend({ status: z.string().optional() })
      .parse(req.query);
    const page = pagination(query);
    const where = {
      ...(req.user!.role === "ADMIN" ? {} : { userId: req.user!.id }),
      ...(query.status ? { status: query.status as never } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.reservation.findMany({
        where,
        skip: page.skip,
        take: page.take,
        include: {
          vehicle: true,
          spot: { include: { area: { include: { lot: true } } } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.reservation.count({ where }),
    ]);
    return res.json({ items, page: page.page, pageSize: page.pageSize, total });
  }),
);

reservationsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = reserveBody.parse(req.body);
    const startsAt = body.startsAt ?? new Date();
    const expiresAt =
      body.expiresAt ?? new Date(startsAt.getTime() + 30 * 60 * 1000);
    if (expiresAt <= startsAt)
      throw new AppError(400, "expiresAt must be after startsAt");
    if (expiresAt <= new Date())
      throw new AppError(400, "Cannot create an already expired reservation");

    const reservation = await prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.findUniqueOrThrow({
        where: { id: body.vehicleId },
      });
      if (req.user!.role !== "ADMIN" && vehicle.ownerId !== req.user!.id)
        throw new AppError(403, "Vehicle does not belong to current user");
      if (!vehicle.isActive) throw new AppError(409, "Vehicle is inactive");

      const updatedSpot = await tx.parkingSpot.updateMany({
        where: {
          id: body.spotId,
          isActive: true,
          status: "AVAILABLE",
          area: { isActive: true, lot: { isActive: true } },
        },
        data: { status: "RESERVED" },
      });
      if (updatedSpot.count !== 1)
        throw new AppError(409, "Spot is not available");

      return tx.reservation.create({
        data: {
          userId: vehicle.ownerId,
          vehicleId: body.vehicleId,
          spotId: body.spotId,
          startsAt,
          expiresAt,
          status: "CONFIRMED",
        },
        include: { vehicle: true, spot: true },
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
      const released = await tx.parkingSpot.updateMany({
        where: { id: current.spotId, status: "RESERVED" },
        data: { status: "AVAILABLE" },
      });
      if (released.count !== 1)
        throw new AppError(409, "Reserved spot state has changed");
      return tx.reservation.findUniqueOrThrow({ where: { id } });
    });
    return res.json({ reservation });
  }),
);
