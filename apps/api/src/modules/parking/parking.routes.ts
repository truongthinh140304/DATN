import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { asyncHandler, pagination } from "../../utils/http.js";
import { listQuery, lotBody, uuidParam } from "../../utils/schemas.js";
import { expireStaleReservations } from "./parking.service.js";

export const parkingRouter = Router();

parkingRouter.use(requireAuth);

parkingRouter.get(
  "/lots",
  asyncHandler(async (req, res) => {
    const query = listQuery.parse(req.query);
    const page = pagination(query);
    const now = new Date();
    const where = query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" as const } },
            { address: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {};

    const result = await prisma.$transaction(async (tx) => {
      await expireStaleReservations(tx, now);
      const [lots, total] = await Promise.all([
        tx.parkingLot.findMany({
          where,
          skip: page.skip,
          take: page.take,
          orderBy: { createdAt: "desc" },
        }),
        tx.parkingLot.count({ where }),
      ]);
      const lotIds = lots.map((lot) => lot.id);
      const [reservationCounts, sessionCounts] = lotIds.length
        ? await Promise.all([
            tx.reservation.groupBy({
              by: ["lotId"],
              where: {
                lotId: { in: lotIds },
                status: { in: ["PENDING", "CONFIRMED"] },
                expiresAt: { gt: now },
              },
              _count: { _all: true },
            }),
            tx.parkingSession.groupBy({
              by: ["lotId"],
              where: {
                lotId: { in: lotIds },
                status: "ACTIVE",
              },
              _count: { _all: true },
            }),
          ])
        : [[], []];

      const reservationMap = new Map(
        reservationCounts.map((item) => [item.lotId, item._count._all]),
      );
      const sessionMap = new Map(
        sessionCounts.map((item) => [item.lotId, item._count._all]),
      );

      const items = lots.map((lot) => {
        const activeReservations = reservationMap.get(lot.id) ?? 0;
        const activeSessions = sessionMap.get(lot.id) ?? 0;
        const usedSlots = activeReservations + activeSessions;
        return {
          ...lot,
          activeReservations,
          activeSessions,
          usedSlots,
          availableSlots: Math.max(0, lot.capacity - usedSlots),
        };
      });
      return { items, total };
    });

    return res.json({
      items: result.items,
      page: page.page,
      pageSize: page.pageSize,
      total: result.total,
    });
  }),
);

parkingRouter.post(
  "/lots",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = lotBody.parse(req.body);
    const lot = await prisma.parkingLot.create({ data: body });
    return res.status(201).json({
      lot: {
        ...lot,
        activeReservations: 0,
        activeSessions: 0,
        usedSlots: 0,
        availableSlots: lot.capacity,
      },
    });
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
