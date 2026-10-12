import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { AppError, asyncHandler, pagination } from "../../utils/http.js";
import { listQuery, uuidParam } from "../../utils/schemas.js";

export const reservationsRouter = Router();

const reserveBody = z.object({
  vehicleId: z.string().uuid(),
  spotId: z.string().uuid(),
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

    const reservation = await prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.findUniqueOrThrow({
        where: { id: body.vehicleId },
      });
      if (req.user!.role !== "ADMIN" && vehicle.ownerId !== req.user!.id)
        throw new AppError(403, "Vehicle does not belong to current user");

      const updatedSpot = await tx.parkingSpot.updateMany({
        where: { id: body.spotId, isActive: true, status: "AVAILABLE" },
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
      const updated = await tx.reservation.update({
        where: { id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await tx.parkingSpot.update({
        where: { id: current.spotId },
        data: { status: "AVAILABLE" },
      });
      return updated;
    });
    return res.json({ reservation });
  }),
);
