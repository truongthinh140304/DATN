export function normalizePlate(raw: string): string {
  return raw
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s.\-\u2010-\u2015]/gu, "");
}

export function plausiblePlate(plate: string): boolean {
  return /^[0-9]{2}[A-Z]{1,2}[0-9]{4,6}$/.test(plate);
}

export type MatchObservation = {
  spotId: string;
  timestamp: Date;
  occupancyStatus: string;
  recognitionStatus?: string;
  plateRaw?: string | null;
  ocrConfidence?: number | null;
  associationConfidence?: number | null;
  vehicleConfidence?: number | null;
  plateSamples?: number;
};

export type MatchReservation = {
  id: string;
  spotId: string;
  status: string;
  startsAt: Date;
  expiresAt: Date;
  vehicle: { plateNumber: string };
};

export function matchReservation(
  observation: MatchObservation,
  reservations: MatchReservation[],
) {
  const plateNormalized = observation.plateRaw
    ? normalizePlate(observation.plateRaw)
    : null;
  const insufficient = (matchReason: string) => ({
    plateNormalized,
    matchStatus: "INSUFFICIENT" as const,
    matchReason,
    reservationId: null,
    expectedPlate: null,
  });
  if (
    observation.occupancyStatus !== "OCCUPIED" ||
    observation.recognitionStatus !== "READ"
  )
    return insufficient("occupancy_or_reading_unknown");
  if (
    !plateNormalized ||
    !plausiblePlate(plateNormalized) ||
    (observation.ocrConfidence ?? 0) < 0.7 ||
    (observation.vehicleConfidence ?? 0) < 0.35 ||
    (observation.associationConfidence ?? 0) < 0.6 ||
    (observation.plateSamples ?? 0) < 3
  )
    return insufficient("weak_or_unstable_evidence");
  const candidates = reservations.filter(
    (reservation) =>
      reservation.spotId === observation.spotId &&
      ["CONFIRMED", "CHECKED_IN"].includes(reservation.status) &&
      reservation.startsAt <= observation.timestamp &&
      observation.timestamp < reservation.expiresAt,
  );
  if (!candidates.length)
    return {
      plateNormalized,
      matchStatus: "NO_RESERVATION" as const,
      matchReason: "no_effective_reservation_at_observation",
      reservationId: null,
      expectedPlate: null,
    };
  if (candidates.length !== 1)
    return insufficient("multiple_effective_reservations");
  const reservation = candidates[0];
  const expectedPlate = normalizePlate(reservation.vehicle.plateNumber);
  if (!plausiblePlate(expectedPlate))
    return insufficient("reservation_plate_not_supported");
  const matches = expectedPlate === plateNormalized;
  return {
    plateNormalized,
    matchStatus: matches ? ("MATCH" as const) : ("MISMATCH" as const),
    matchReason: matches
      ? "plate_matches_reservation"
      : "plate_differs_from_reservation",
    reservationId: reservation.id,
    expectedPlate,
  };
}
