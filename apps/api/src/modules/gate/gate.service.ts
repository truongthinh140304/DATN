import type {
  BarrierAction,
  GateDecision,
  GateDirection,
  Prisma,
} from "@prisma/client";
import {
  expireStaleReservations,
  lockParkingLot,
} from "../parking/parking.service.js";
import { normalizePlate, plausiblePlate } from "./plate-utils.js";

export type GateScanInput = {
  gateId: string;
  lotId?: string;
  plateRaw: string;
  ocrConfidence: number;
  vehicleConfidence?: number | null;
  plateSamples: number;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
};

export type GateScanConfig = {
  reentryCooldownSeconds: number;
  minOcrConfidence: number;
  minPlateSamples: number;
};

export type GateScanOutcome = {
  direction: GateDirection;
  decision: GateDecision;
  barrierAction: BarrierAction;
  reason: string;
  plateNormalized: string;
  lotId: string | null;
  reservationId: string | null;
  sessionId: string | null;
  eventId: string;
  businessMutated: boolean;
};

export type GateHardwareStatus = {
  gateId: string;
  lotId: string | null;
  cameraConnected: boolean;
  arduinoConnected: boolean;
  arduinoPort: string | null;
  lastHeartbeatAt: string;
  lastScanAt: string | null;
  lastPlate: string | null;
};

const hardwareStatusMap = new Map<string, GateHardwareStatus>();

export function updateHardwareStatus(
  status: Omit<
    GateHardwareStatus,
    "lastHeartbeatAt" | "lastScanAt" | "lastPlate"
  > & {
    lastHeartbeatAt?: string;
    lastScanAt?: string | null;
    lastPlate?: string | null;
  },
) {
  const existing = hardwareStatusMap.get(status.gateId);
  hardwareStatusMap.set(status.gateId, {
    ...existing,
    ...status,
    lastHeartbeatAt: status.lastHeartbeatAt ?? new Date().toISOString(),
    lastScanAt: status.lastScanAt ?? existing?.lastScanAt ?? null,
    lastPlate: status.lastPlate ?? existing?.lastPlate ?? null,
  });
}

export function touchHardwareScan(
  gateId: string,
  lotId: string | null,
  plateNormalized: string | null,
) {
  const existing = hardwareStatusMap.get(gateId);
  const nowIso = new Date().toISOString();
  hardwareStatusMap.set(gateId, {
    gateId,
    lotId: lotId ?? existing?.lotId ?? null,
    cameraConnected: existing?.cameraConnected ?? true,
    arduinoConnected: existing?.arduinoConnected ?? false,
    arduinoPort: existing?.arduinoPort ?? null,
    lastHeartbeatAt: nowIso,
    lastScanAt: nowIso,
    lastPlate: plateNormalized ?? existing?.lastPlate ?? null,
  });
}

export function listHardwareStatuses(): GateHardwareStatus[] {
  return [...hardwareStatusMap.values()];
}

export async function processGateScan(
  tx: Prisma.TransactionClient,
  input: GateScanInput,
  config: GateScanConfig,
): Promise<GateScanOutcome> {
  const now = input.timestamp ?? new Date();
  const plateNormalized = normalizePlate(input.plateRaw);

  const recordEvent = async (params: {
    lotId?: string | null;
    direction: GateDirection;
    decision: GateDecision;
    barrierAction: BarrierAction;
    reason: string;
    reservationId?: string | null;
    sessionId?: string | null;
    businessMutated?: boolean;
  }): Promise<GateScanOutcome> => {
    const event = await tx.gateEvent.create({
      data: {
        gateId: input.gateId,
        lotId: params.lotId ?? input.lotId ?? null,
        direction: params.direction,
        source: "CAMERA",
        decision: params.decision,
        barrierAction: params.barrierAction,
        reason: params.reason,
        plateRaw: input.plateRaw,
        plateNormalized: plateNormalized || null,
        ocrConfidence: input.ocrConfidence,
        plateSamples: input.plateSamples,
        reservationId: params.reservationId ?? null,
        sessionId: params.sessionId ?? null,
        occurredAt: now,
        ...(input.metadata
          ? { metadata: input.metadata as Prisma.InputJsonValue }
          : {}),
      },
    });
    return {
      direction: params.direction,
      decision: params.decision,
      barrierAction: params.barrierAction,
      reason: params.reason,
      plateNormalized,
      lotId: params.lotId ?? input.lotId ?? null,
      reservationId: params.reservationId ?? null,
      sessionId: params.sessionId ?? null,
      eventId: event.id,
      businessMutated: Boolean(params.businessMutated),
    };
  };

  if (!plateNormalized || !plausiblePlate(plateNormalized)) {
    return recordEvent({
      direction: "UNKNOWN",
      decision: "DENY",
      barrierAction: "STAY_CLOSED",
      reason: "invalid_plate_format",
    });
  }

  if (
    input.ocrConfidence < config.minOcrConfidence ||
    input.plateSamples < config.minPlateSamples
  ) {
    return recordEvent({
      direction: "UNKNOWN",
      decision: "DENY",
      barrierAction: "STAY_CLOSED",
      reason: "weak_ocr_evidence",
    });
  }

  await expireStaleReservations(tx, now);

  const vehicle = await tx.vehicle.findUnique({
    where: { plateNormalized },
    include: { owner: { select: { id: true, isActive: true } } },
  });
  if (!vehicle) {
    return recordEvent({
      direction: "ENTRY",
      decision: "DENY",
      barrierAction: "STAY_CLOSED",
      reason: "vehicle_not_registered",
    });
  }
  if (!vehicle.isActive || !vehicle.owner.isActive) {
    return recordEvent({
      direction: "ENTRY",
      decision: "DENY",
      barrierAction: "STAY_CLOSED",
      reason: "vehicle_inactive",
    });
  }

  const activeSession = await tx.parkingSession.findFirst({
    where: { vehicleId: vehicle.id, status: "ACTIVE" },
    include: { lot: true },
  });

  if (activeSession) {
    const elapsedSeconds =
      (now.getTime() - activeSession.checkedInAt.getTime()) / 1000;
    if (elapsedSeconds < config.reentryCooldownSeconds) {
      return recordEvent({
        lotId: activeSession.lotId,
        direction: "EXIT",
        decision: "COOLDOWN",
        barrierAction: "STAY_CLOSED",
        reason: "reentry_cooldown",
        reservationId: activeSession.reservationId,
        sessionId: activeSession.id,
      });
    }

    if (input.lotId && activeSession.lotId !== input.lotId) {
      return recordEvent({
        lotId: input.lotId,
        direction: "EXIT",
        decision: "DENY",
        barrierAction: "STAY_CLOSED",
        reason: "wrong_lot",
        reservationId: activeSession.reservationId,
        sessionId: activeSession.id,
      });
    }

    const claimedSession = await tx.parkingSession.updateMany({
      where: { id: activeSession.id, status: "ACTIVE" },
      data: { status: "COMPLETED", checkedOutAt: now },
    });
    if (claimedSession.count !== 1) {
      return recordEvent({
        lotId: activeSession.lotId,
        direction: "EXIT",
        decision: "DENY",
        barrierAction: "STAY_CLOSED",
        reason: "session_state_conflict",
        sessionId: activeSession.id,
      });
    }

    if (activeSession.reservationId) {
      await tx.reservation.updateMany({
        where: {
          id: activeSession.reservationId,
          status: "CHECKED_IN",
        },
        data: { status: "COMPLETED", completedAt: now },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: vehicle.ownerId,
        action: "GATE_AUTO_CHECK_OUT",
        entityType: "ParkingSession",
        entityId: activeSession.id,
        metadata: {
          gateId: input.gateId,
          plateNormalized,
          lotId: activeSession.lotId,
        },
      },
    });

    return recordEvent({
      lotId: activeSession.lotId,
      direction: "EXIT",
      decision: "ALLOW",
      barrierAction: "OPEN",
      reason: "active_session_exit",
      reservationId: activeSession.reservationId,
      sessionId: activeSession.id,
      businessMutated: true,
    });
  }

  // Entry flow: locate a valid confirmed reservation for this vehicle.
  const bookings = await tx.reservation.findMany({
    where: {
      vehicleId: vehicle.id,
      status: { in: ["PENDING", "CONFIRMED"] },
    },
    orderBy: { startsAt: "asc" },
  });

  const effective = bookings.find(
    (item) =>
      item.status === "CONFIRMED" &&
      item.startsAt <= now &&
      item.expiresAt > now &&
      (!input.lotId || item.lotId === input.lotId),
  );

  if (!effective) {
    let reason = "no_valid_reservation";
    if (
      input.lotId &&
      bookings.some(
        (item) =>
          item.status === "CONFIRMED" &&
          item.startsAt <= now &&
          item.expiresAt > now &&
          item.lotId !== input.lotId,
      )
    ) {
      reason = "wrong_lot";
    } else if (bookings.some((item) => item.startsAt > now)) {
      reason = "reservation_not_started";
    } else if (bookings.some((item) => item.status === "PENDING")) {
      reason = "reservation_not_confirmed";
    } else {
      const recentlyExpired = await tx.reservation.findFirst({
        where: { vehicleId: vehicle.id, status: "EXPIRED" },
        orderBy: { expiresAt: "desc" },
      });
      if (recentlyExpired) reason = "reservation_expired";
    }

    return recordEvent({
      direction: "ENTRY",
      decision: "DENY",
      barrierAction: "STAY_CLOSED",
      reason,
    });
  }

  if (effective.paymentStatus === "UNPAID") {
    return recordEvent({
      lotId: effective.lotId,
      direction: "ENTRY",
      decision: "DENY",
      barrierAction: "STAY_CLOSED",
      reason: "payment_required",
      reservationId: effective.id,
    });
  }

  const lot = await lockParkingLot(tx, effective.lotId);
  if (!lot.isActive) {
    return recordEvent({
      lotId: effective.lotId,
      direction: "ENTRY",
      decision: "DENY",
      barrierAction: "STAY_CLOSED",
      reason: "lot_inactive",
      reservationId: effective.id,
    });
  }

  const claimed = await tx.reservation.updateMany({
    where: {
      id: effective.id,
      status: "CONFIRMED",
      startsAt: { lte: now },
      expiresAt: { gt: now },
    },
    data: { status: "CHECKED_IN", checkedInAt: now },
  });
  if (claimed.count !== 1) {
    return recordEvent({
      lotId: effective.lotId,
      direction: "ENTRY",
      decision: "DENY",
      barrierAction: "STAY_CLOSED",
      reason: "reservation_state_conflict",
      reservationId: effective.id,
    });
  }

  const session = await tx.parkingSession.create({
    data: {
      userId: vehicle.ownerId,
      vehicleId: vehicle.id,
      lotId: effective.lotId,
      reservationId: effective.id,
      checkedInAt: now,
      notes: `Cổng ${input.gateId}`,
    },
  });

  await tx.auditLog.create({
    data: {
      actorId: vehicle.ownerId,
      action: "GATE_AUTO_CHECK_IN",
      entityType: "ParkingSession",
      entityId: session.id,
      metadata: {
        gateId: input.gateId,
        plateNormalized,
        lotId: effective.lotId,
        reservationId: effective.id,
      },
    },
  });

  return recordEvent({
    lotId: effective.lotId,
    direction: "ENTRY",
    decision: "ALLOW",
    barrierAction: "OPEN",
    reason: "valid_reservation_entry",
    reservationId: effective.id,
    sessionId: session.id,
    businessMutated: true,
  });
}
