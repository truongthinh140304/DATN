import type {
  CameraObservation,
  Prisma,
  VisionAlertType,
} from "@prisma/client";
import { normalizePlate } from "./plate-matching.js";

type Booking = {
  id: string;
  spotId: string;
  spot: { code: string };
  vehicle: { plateNumber: string };
};
type ActiveSession = {
  spotId: string;
  spot: { code: string };
  vehicle: { plateNumber: string };
};
type Decision =
  | {
      type: VisionAlertType;
      expectedSpotId?: string;
      expectedSpotCode?: string;
      reservationId?: string;
    }
  | "CLEAR"
  | "UNKNOWN";

export function classifyAlert(
  observation: Pick<
    CameraObservation,
    "plateNormalized" | "spotId" | "matchStatus"
  >,
  bookings: Booking[],
  sessions: ActiveSession[],
): Decision {
  if (observation.matchStatus === "INSUFFICIENT") return "UNKNOWN";
  const matches = bookings.filter(
    (item) =>
      normalizePlate(item.vehicle.plateNumber) === observation.plateNormalized,
  );
  const active = sessions.filter(
    (item) =>
      normalizePlate(item.vehicle.plateNumber) === observation.plateNormalized,
  );
  if (matches.length > 1 || active.length > 1) return "UNKNOWN";
  if (matches.length && active.length && matches[0].spotId !== active[0].spotId)
    return "UNKNOWN";
  const expected = matches[0] ?? active[0];
  if (expected && expected.spotId !== observation.spotId)
    return {
      type: "WRONG_SPOT",
      expectedSpotId: expected.spotId,
      expectedSpotCode: expected.spot.code,
      reservationId: matches[0]?.id,
    };
  if (observation.matchStatus === "MISMATCH") return { type: "PLATE_MISMATCH" };
  if (observation.matchStatus === "NO_RESERVATION" && !active.length)
    return { type: "UNRESERVED_VEHICLE" };
  return "CLEAR";
}

export async function updateVisionAlerts(
  tx: Prisma.TransactionClient,
  observation: CameraObservation,
): Promise<boolean> {
  const age = Date.now() - observation.observedAt.getTime();
  if (
    observation.matchStatus === "INSUFFICIENT" ||
    !observation.plateNormalized ||
    age > 60_000 ||
    age < -30_000
  )
    return false;
  // Replay/out-of-order frames remain in recognition history but cannot open or
  // resolve live warnings over a newer observation (including camera loss).
  const latest = await tx.cameraObservation.findFirst({
    where: {
      cameraId: observation.cameraId,
      spotId: observation.spotId,
      observedAt: { lte: new Date(Date.now() + 30_000) },
    },
    orderBy: [{ observedAt: "desc" }, { receivedAt: "desc" }, { id: "desc" }],
  });
  if (
    !latest ||
    latest.observedAt > observation.observedAt ||
    latest.plateNormalized !== observation.plateNormalized
  )
    return false;
  const [bookings, sessions] = await Promise.all([
    tx.reservation.findMany({
      where: {
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
        startsAt: { lte: observation.observedAt },
        expiresAt: { gt: observation.observedAt },
      },
      select: {
        id: true,
        spotId: true,
        spot: { select: { code: true } },
        vehicle: { select: { plateNumber: true } },
      },
    }),
    tx.parkingSession.findMany({
      where: { status: "ACTIVE", checkedInAt: { lte: observation.observedAt } },
      select: {
        spotId: true,
        spot: { select: { code: true } },
        vehicle: { select: { plateNumber: true } },
      },
    }),
  ]);
  const decision = classifyAlert(observation, bookings, sessions);
  if (decision === "UNKNOWN") return false;
  const activeKey =
    decision === "CLEAR"
      ? null
      : JSON.stringify([
          observation.cameraId,
          observation.spotId,
          decision.type,
          observation.plateNormalized,
          decision.expectedSpotId ?? null,
        ]);
  const resolved = await tx.visionAlert.updateMany({
    where: {
      cameraId: observation.cameraId,
      ...(decision === "CLEAR"
        ? {
            OR: [
              { spotId: observation.spotId },
              {
                type: "WRONG_SPOT" as const,
                plateNormalized: observation.plateNormalized,
                expectedSpotId: observation.spotId,
              },
            ],
          }
        : { spotId: observation.spotId }),
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
      lastSeenAt: { lte: observation.observedAt },
      ...(activeKey ? { activeKey: { not: activeKey } } : {}),
    },
    data: {
      status: "RESOLVED",
      activeKey: null,
      resolvedAt: observation.observedAt,
    },
  });
  if (decision === "CLEAR") return resolved.count > 0;
  await tx.visionAlert.upsert({
    where: { activeKey: activeKey! },
    create: {
      activeKey,
      type: decision.type,
      cameraId: observation.cameraId,
      spotId: observation.spotId,
      expectedSpotId: decision.expectedSpotId,
      expectedSpotCode: decision.expectedSpotCode,
      plateNormalized: observation.plateNormalized,
      expectedPlate: observation.expectedPlate,
      reservationId: decision.reservationId ?? observation.reservationId,
      observationId: observation.id,
      firstSeenAt: observation.observedAt,
      lastSeenAt: observation.observedAt,
    },
    update: {
      lastSeenAt: observation.observedAt,
      observationId: observation.id,
      occurrences: { increment: 1 },
    },
  });
  return true;
}
