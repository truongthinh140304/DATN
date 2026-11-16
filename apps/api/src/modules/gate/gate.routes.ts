import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireVisionApiKey } from "../../middleware/vision-auth.js";
import { publishRealtime } from "../../realtime/events.js";
import { asyncHandler, pagination } from "../../utils/http.js";
import { listQuery } from "../../utils/schemas.js";
import { retryTransaction } from "../../utils/transaction-retry.js";
import {
  listHardwareStatuses,
  processGateScan,
  touchHardwareScan,
  updateHardwareStatus,
} from "./gate.service.js";

export const gateRouter = Router();

const scanBodySchema = z.object({
  gateId: z.string().trim().min(1).max(100),
  lotId: z.string().uuid().optional(),
  plateRaw: z.string().trim().min(1).max(100),
  ocrConfidence: z.number().min(0).max(1),
  vehicleConfidence: z.number().min(0).max(1).nullable().optional(),
  plateSamples: z.number().int().min(0).max(100).default(1),
  timestamp: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const heartbeatSchema = z.object({
  gateId: z.string().trim().min(1).max(100),
  lotId: z.string().uuid().nullable().optional(),
  cameraConnected: z.boolean(),
  arduinoConnected: z.boolean(),
  arduinoPort: z.string().trim().max(64).nullable().optional(),
});

const claimCommandSchema = z.object({
  gateId: z.string().trim().min(1).max(100),
});

const manualOpenSchema = z.object({
  gateId: z.string().trim().min(1).max(100).default("main-gate-01"),
  lotId: z.string().uuid().optional(),
  durationMs: z.coerce.number().int().min(1000).max(30_000).default(5000),
  reason: z.string().trim().max(200).optional(),
});

// Vision/Gate Python service routes (protected by x-vision-api-key).
gateRouter.get(
  "/lots",
  requireVisionApiKey,
  asyncHandler(async (_req, res) => {
    const items = await prisma.parkingLot.findMany({
      where: { isActive: true },
      select: { id: true, name: true, address: true, capacity: true },
      orderBy: { createdAt: "asc" },
    });
    return res.json({ items });
  }),
);

gateRouter.post(
  "/heartbeat",
  requireVisionApiKey,
  asyncHandler(async (req, res) => {
    const body = heartbeatSchema.parse(req.body);
    updateHardwareStatus({
      gateId: body.gateId,
      lotId: body.lotId ?? null,
      cameraConnected: body.cameraConnected,
      arduinoConnected: body.arduinoConnected,
      arduinoPort: body.arduinoPort ?? null,
    });
    return res.json({ ok: true });
  }),
);

gateRouter.post(
  "/scan",
  requireVisionApiKey,
  asyncHandler(async (req, res) => {
    const body = scanBodySchema.parse(req.body);
    const outcome = await retryTransaction(() =>
      prisma.$transaction(
        (tx) =>
          processGateScan(tx, body, {
            reentryCooldownSeconds: env.GATE_REENTRY_COOLDOWN_SECONDS,
            minOcrConfidence: env.GATE_OCR_MIN_CONFIDENCE,
            minPlateSamples: env.GATE_MIN_PLATE_SAMPLES,
          }),
        { isolationLevel: "RepeatableRead" },
      ),
    );
    touchHardwareScan(
      body.gateId,
      outcome.lotId,
      outcome.plateNormalized || null,
    );
    publishRealtime("gate");
    if (outcome.businessMutated) {
      publishRealtime("parking");
    }
    return res.status(200).json(outcome);
  }),
);

gateRouter.post(
  "/commands/claim",
  requireVisionApiKey,
  asyncHandler(async (req, res) => {
    const { gateId } = claimCommandSchema.parse(req.body);
    const now = new Date();
    const command = await prisma.$transaction(async (tx) => {
      await tx.gateCommand.updateMany({
        where: { gateId, status: "PENDING", expiresAt: { lte: now } },
        data: { status: "EXPIRED" },
      });
      const pending = await tx.gateCommand.findFirst({
        where: { gateId, status: "PENDING", expiresAt: { gt: now } },
        orderBy: { createdAt: "asc" },
      });
      if (!pending) return null;
      const claimed = await tx.gateCommand.updateMany({
        where: { id: pending.id, status: "PENDING" },
        data: { status: "EXECUTED", executedAt: now },
      });
      return claimed.count === 1 ? pending : null;
    });
    return res.json({ command });
  }),
);

// Web dashboard routes (protected by JWT).
gateRouter.get(
  "/events",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = listQuery
      .extend({
        gateId: z.string().trim().optional(),
        decision: z.enum(["ALLOW", "DENY", "COOLDOWN"]).optional(),
      })
      .parse(req.query);
    const page = pagination(query);

    let ownerPlates: string[] | undefined;
    if (req.user!.role !== "ADMIN") {
      const vehicles = await prisma.vehicle.findMany({
        where: { ownerId: req.user!.id },
        select: { plateNormalized: true },
      });
      ownerPlates = vehicles.map((item) => item.plateNormalized);
      if (!ownerPlates.length) {
        return res.json({
          items: [],
          page: page.page,
          pageSize: page.pageSize,
          total: 0,
        });
      }
    }

    const where = {
      ...(query.gateId ? { gateId: query.gateId } : {}),
      ...(query.decision ? { decision: query.decision } : {}),
      ...(ownerPlates ? { plateNormalized: { in: ownerPlates } } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.gateEvent.findMany({
        where,
        include: { lot: { select: { id: true, name: true } } },
        skip: page.skip,
        take: page.take,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      }),
      prisma.gateEvent.count({ where }),
    ]);

    return res.json({ items, page: page.page, pageSize: page.pageSize, total });
  }),
);

gateRouter.get(
  "/status",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (_req, res) => {
    const [latestEvent, pendingCommands] = await Promise.all([
      prisma.gateEvent.findFirst({
        include: { lot: { select: { id: true, name: true } } },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      }),
      prisma.gateCommand.count({
        where: { status: "PENDING", expiresAt: { gt: new Date() } },
      }),
    ]);
    return res.json({
      gates: listHardwareStatuses(),
      latestEvent,
      pendingCommands,
    });
  }),
);

gateRouter.post(
  "/manual-open",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = manualOpenSchema.parse(req.body);
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const command = await tx.gateCommand.create({
        data: {
          gateId: body.gateId,
          lotId: body.lotId ?? null,
          command: "OPEN",
          durationMs: body.durationMs,
          status: "PENDING",
          requestedBy: req.user!.id,
          expiresAt: new Date(now.getTime() + 15_000),
        },
      });
      const event = await tx.gateEvent.create({
        data: {
          gateId: body.gateId,
          lotId: body.lotId ?? null,
          direction: "UNKNOWN",
          source: "MANUAL",
          decision: "ALLOW",
          barrierAction: "OPEN",
          reason: body.reason || "manual_override",
          actorId: req.user!.id,
          occurredAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          action: "GATE_MANUAL_OPEN",
          entityType: "GateCommand",
          entityId: command.id,
          metadata: {
            gateId: body.gateId,
            lotId: body.lotId ?? null,
            durationMs: body.durationMs,
          },
        },
      });
      return { command, event };
    });
    publishRealtime("gate");
    return res.status(201).json(result);
  }),
);
