import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { asyncHandler, pagination } from "../../utils/http.js";
import {
  areaBody,
  listQuery,
  lotBody,
  spotBody,
  uuidParam,
} from "../../utils/schemas.js";

export const parkingRouter = Router();

parkingRouter.use(requireAuth);

parkingRouter.get(
  "/lots",
  asyncHandler(async (req, res) => {
    const query = listQuery.parse(req.query);
    const page = pagination(query);
    const where = query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" as const } },
            { address: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      prisma.parkingLot.findMany({
        where,
        skip: page.skip,
        take: page.take,
        include: { areas: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.parkingLot.count({ where }),
    ]);
    return res.json({ items, page: page.page, pageSize: page.pageSize, total });
  }),
);

parkingRouter.post(
  "/lots",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = lotBody.parse(req.body);
    const lot = await prisma.parkingLot.create({ data: body });
    return res.status(201).json({ lot });
  }),
);

parkingRouter.patch(
  "/lots/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const lot = await prisma.parkingLot.update({
      where: { id },
      data: lotBody.partial().parse(req.body),
    });
    return res.json({ lot });
  }),
);

parkingRouter.get(
  "/areas",
  asyncHandler(async (req, res) => {
    const query = listQuery
      .extend({ lotId: uuidParam.shape.id.optional() })
      .parse(req.query);
    const page = pagination(query);
    const where = {
      ...(query.lotId ? { lotId: query.lotId } : {}),
      ...(query.q
        ? { name: { contains: query.q, mode: "insensitive" as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.parkingArea.findMany({
        where,
        skip: page.skip,
        take: page.take,
        include: { lot: true },
        orderBy: { code: "asc" },
      }),
      prisma.parkingArea.count({ where }),
    ]);
    return res.json({ items, page: page.page, pageSize: page.pageSize, total });
  }),
);

parkingRouter.post(
  "/areas",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const area = await prisma.parkingArea.create({
      data: areaBody.parse(req.body),
    });
    return res.status(201).json({ area });
  }),
);

parkingRouter.patch(
  "/areas/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const area = await prisma.parkingArea.update({
      where: { id },
      data: areaBody.partial().parse(req.body),
    });
    return res.json({ area });
  }),
);

parkingRouter.get(
  "/spots",
  asyncHandler(async (req, res) => {
    const query = listQuery
      .extend({
        areaId: uuidParam.shape.id.optional(),
        status: spotBody.shape.status,
      })
      .parse(req.query);
    const page = pagination(query);
    const where = {
      ...(query.areaId ? { areaId: query.areaId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            code: {
              contains: query.q.toUpperCase(),
              mode: "insensitive" as const,
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.parkingSpot.findMany({
        where,
        skip: page.skip,
        take: page.take,
        include: { area: { include: { lot: true } } },
        orderBy: { code: "asc" },
      }),
      prisma.parkingSpot.count({ where }),
    ]);
    return res.json({ items, page: page.page, pageSize: page.pageSize, total });
  }),
);

parkingRouter.post(
  "/spots",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const spot = await prisma.parkingSpot.create({
      data: spotBody.parse(req.body),
    });
    return res.status(201).json({ spot });
  }),
);

parkingRouter.patch(
  "/spots/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const spot = await prisma.parkingSpot.update({
      where: { id },
      data: spotBody.partial().parse(req.body),
    });
    return res.json({ spot });
  }),
);
