import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { AppError, asyncHandler, pagination } from "../../utils/http.js";
import { listQuery, uuidParam, vehicleBody } from "../../utils/schemas.js";

export const vehiclesRouter = Router();

vehiclesRouter.use(requireAuth);

vehiclesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuery.parse(req.query);
    const page = pagination(query);
    const where = {
      ...(req.user!.role === "ADMIN" ? {} : { ownerId: req.user!.id }),
      ...(query.q
        ? {
            plateNumber: {
              contains: query.q.toUpperCase(),
              mode: "insensitive" as const,
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.vehicle.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.vehicle.count({ where }),
    ]);
    return res.json({ items, page: page.page, pageSize: page.pageSize, total });
  }),
);

vehiclesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = vehicleBody.parse(req.body);
    const vehicle = await prisma.vehicle.create({
      data: { ...body, ownerId: req.user!.id },
    });
    return res.status(201).json({ vehicle });
  }),
);

vehiclesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const current = await prisma.vehicle.findUniqueOrThrow({ where: { id } });
    if (req.user!.role !== "ADMIN" && current.ownerId !== req.user!.id)
      throw new AppError(403, "Insufficient permission");
    const body = vehicleBody.partial().parse(req.body);
    const vehicle = await prisma.vehicle.update({ where: { id }, data: body });
    return res.json({ vehicle });
  }),
);
