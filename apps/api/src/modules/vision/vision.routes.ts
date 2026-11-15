import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { matchReservation } from "./plate-matching.js";
import { requireVisionApiKey } from "../../middleware/vision-auth.js";
import { AppError, asyncHandler, pagination } from "../../utils/http.js";
import { listQuery } from "../../utils/schemas.js";
import { randomUUID } from "node:crypto";
import { updateVisionAlerts } from "./alert.service.js";
import { publishRealtime } from "../../realtime/events.js";
import { retryVisionTransaction } from "../../utils/transaction-retry.js";

export const visionRouter = Router();

// Calibration only needs spot identifiers/labels, never owner or booking data.
visionRouter.get(
  "/spots",
  requireVisionApiKey,
  asyncHandler(async (_req, res) => {
    const items = await prisma.parkingSpot.findMany({
      where: {
        isActive: true,
        area: { isActive: true, lot: { isActive: true } },
      },
      select: {
        id: true,
        code: true,
        area: {
          select: { code: true, name: true, lot: { select: { name: true } } },
        },
      },
      orderBy: [{ areaId: "asc" }, { code: "asc" }],
    });
    return res.json({ items });
  }),
);

const observationSchema = z.object({
  cameraId: z.string().trim().min(1).max(100),
  spotId: z.string().uuid(),
  occupancyStatus: z.enum(["EMPTY", "OCCUPIED", "UNKNOWN"]),
  confidence: z.number().min(0).max(1),
  timestamp: z.coerce.date(),
  metadata: z.record(z.unknown()).optional(),
  recognitionStatus: z
    .enum([
      "NOT_REQUESTED",
      "NO_VEHICLE",
      "UNREADABLE",
      "READ",
      "CAMERA_LOST",
      "AMBIGUOUS",
    ])
    .default("NOT_REQUESTED"),
  plateRaw: z.string().max(200).nullable().optional(),
  // Accepted for compatibility; always recomputed from plateRaw on the server.
  plateNormalized: z.string().max(200).nullable().optional(),
  vehicleConfidence: z.number().min(0).max(1).nullable().optional(),
  plateDetectionConfidence: z.number().min(0).max(1).nullable().optional(),
  associationConfidence: z.number().min(0).max(1).nullable().optional(),
  ocrConfidence: z.number().min(0).max(1).nullable().optional(),
  plateSamples: z.number().int().min(0).max(1000).default(0),
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

    const result = await retryVisionTransaction(() =>
      prisma.$transaction(
        async (tx) => {
          const data: Prisma.CameraObservationCreateManyInput[] = [];
          for (const item of observations) {
            const reservations = await tx.reservation.findMany({
              where: {
                spotId: item.spotId,
                status: { in: ["CONFIRMED", "CHECKED_IN"] },
                startsAt: { lte: item.timestamp },
                expiresAt: { gt: item.timestamp },
              },
              select: {
                id: true,
                spotId: true,
                status: true,
                startsAt: true,
                expiresAt: true,
                vehicle: { select: { plateNumber: true } },
              },
            });
            data.push({
              id: randomUUID(),
              cameraId: item.cameraId,
              spotId: item.spotId,
              occupancyStatus: item.occupancyStatus,
              confidence: item.confidence,
              observedAt: item.timestamp,
              recognitionStatus: item.recognitionStatus,
              plateRaw: item.plateRaw,
              vehicleConfidence: item.vehicleConfidence,
              plateDetectionConfidence: item.plateDetectionConfidence,
              associationConfidence: item.associationConfidence,
              ocrConfidence: item.ocrConfidence,
              plateSamples: item.plateSamples,
              ...matchReservation(item, reservations),
              ...(item.metadata
                ? { metadata: item.metadata as Prisma.InputJsonValue }
                : {}),
            });
          }
          const saved = await tx.cameraObservation.createMany({ data });
          const rows = await tx.cameraObservation.findMany({
            where: { id: { in: data.map((item) => item.id!) } },
            orderBy: { observedAt: "asc" },
          });
          let alertsChanged = false;
          for (const row of rows)
            alertsChanged =
              (await updateVisionAlerts(tx, row)) || alertsChanged;
          return { count: saved.count, alertsChanged };
        },
        { isolationLevel: "RepeatableRead" },
      ),
    );

    publishRealtime("vision");
    if (result.alertsChanged) publishRealtime("alerts");
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

    return res.json({
      items: items.map((item) => visibleObservation(item, req.user!.role)),
      page: page.page,
      pageSize: page.pageSize,
      total,
    });
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
      where: {
        ...(query.cameraId ? { cameraId: query.cameraId } : {}),
        observedAt: { lte: new Date(Date.now() + 30_000) },
      },
      include: observationInclude,
      distinct: ["cameraId", "spotId"],
      orderBy: [
        { cameraId: "asc" },
        { spotId: "asc" },
        { observedAt: "desc" },
        { receivedAt: "desc" },
        { id: "desc" },
      ],
    });
    return res.json({
      items: items.map((item) => visibleObservation(item, req.user!.role)),
    });
  }),
);

// Retain week-6 authenticated occupancy access, but do not expose another
// vehicle's plate, reservation link, confidence or arbitrary metadata to USER.
function visibleObservation<
  T extends {
    id: string;
    cameraId: string;
    spotId: string;
    occupancyStatus: unknown;
    confidence: number;
    observedAt: Date;
    receivedAt: Date;
    spot: unknown;
  },
>(item: T, role: string) {
  if (role === "ADMIN") return item;
  return {
    id: item.id,
    cameraId: item.cameraId,
    spotId: item.spotId,
    occupancyStatus: item.occupancyStatus,
    confidence: item.confidence,
    observedAt: item.observedAt,
    receivedAt: item.receivedAt,
    spot: item.spot,
  };
}
