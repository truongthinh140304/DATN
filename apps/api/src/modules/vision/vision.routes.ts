import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireVisionApiKey } from "../../middleware/vision-auth.js";
import { AppError, asyncHandler, pagination } from "../../utils/http.js";
import { listQuery } from "../../utils/schemas.js";

export const visionRouter = Router();

const observationSchema = z.object({
  cameraId: z.string().trim().min(1).max(100),
  spotId: z.string().uuid(),
  occupancyStatus: z.enum(["EMPTY", "OCCUPIED", "UNKNOWN"]),
  confidence: z.number().min(0).max(1),
  timestamp: z.coerce.date(),
  metadata: z.record(z.unknown()).optional(),
});

const ingestSchema = z.union([
  observationSchema,
  z.object({ observations: z.array(observationSchema).min(1).max(50) }),
]);

const observationInclude = {
  spot: {
    select: {
      id: true,
      code: true,
      area: {
        select: {
          id: true,
          code: true,
          name: true,
          lot: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

visionRouter.post(
  "/observations",
  requireVisionApiKey,
  asyncHandler(async (req, res) => {
    const parsed = ingestSchema.parse(req.body);
    const observations =
      "observations" in parsed ? parsed.observations : [parsed];
    const spotIds = [...new Set(observations.map((item) => item.spotId))];
    const knownSpots = await prisma.parkingSpot.findMany({
      where: { id: { in: spotIds } },
      select: { id: true },
    });
    const knownIds = new Set(knownSpots.map((spot) => spot.id));
    const unknownSpotIds = spotIds.filter((id) => !knownIds.has(id));
    if (unknownSpotIds.length) {
      throw new AppError(400, "Unknown parking spot", { unknownSpotIds });
    }

    const result = await prisma.cameraObservation.createMany({
      data: observations.map((item) => ({
        cameraId: item.cameraId,
        spotId: item.spotId,
        occupancyStatus: item.occupancyStatus,
        confidence: item.confidence,
        observedAt: item.timestamp,
        ...(item.metadata
          ? { metadata: item.metadata as Prisma.InputJsonValue }
          : {}),
      })),
    });

    return res.status(202).json({ accepted: result.count });
  }),
);

visionRouter.get(
  "/observations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = listQuery
      .extend({
        cameraId: z.string().trim().optional(),
        spotId: z.string().uuid().optional(),
        occupancyStatus: z.enum(["EMPTY", "OCCUPIED", "UNKNOWN"]).optional(),
      })
      .parse(req.query);
    const page = pagination(query);
    const where = {
      ...(query.cameraId ? { cameraId: query.cameraId } : {}),
      ...(query.spotId ? { spotId: query.spotId } : {}),
      ...(query.occupancyStatus
        ? { occupancyStatus: query.occupancyStatus }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.cameraObservation.findMany({
        where,
        include: observationInclude,
        skip: page.skip,
        take: page.take,
        orderBy: { observedAt: "desc" },
      }),
      prisma.cameraObservation.count({ where }),
    ]);

    return res.json({ items, page: page.page, pageSize: page.pageSize, total });
  }),
);

visionRouter.get(
  "/observations/latest",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = z
      .object({ cameraId: z.string().trim().optional() })
      .parse(req.query);
    const items = await prisma.cameraObservation.findMany({
      where: query.cameraId ? { cameraId: query.cameraId } : undefined,
      include: observationInclude,
      distinct: ["spotId"],
      orderBy: [{ spotId: "asc" }, { observedAt: "desc" }],
    });
    return res.json({ items });
  }),
);
