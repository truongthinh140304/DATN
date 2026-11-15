import { describe, expect, it } from "vitest";
import {
  matchReservation,
  normalizePlate,
  type MatchObservation,
  type MatchReservation,
} from "../src/modules/vision/plate-matching.js";

const time = new Date("2026-10-29T09:00:00Z");
const observation: MatchObservation = {
  spotId: "spot-a",
  timestamp: time,
  occupancyStatus: "OCCUPIED",
  recognitionStatus: "READ",
  plateRaw: "30a–123.45",
  ocrConfidence: 0.9,
  vehicleConfidence: 0.9,
  associationConfidence: 0.8,
  plateSamples: 3,
};
const reservation: MatchReservation = {
  id: "reservation-a",
  spotId: "spot-a",
  status: "CONFIRMED",
  startsAt: new Date("2026-10-29T08:00:00Z"),
  expiresAt: new Date("2026-10-29T10:00:00Z"),
  vehicle: { plateNumber: "30A-12345" },
};

describe("plate matching on the backend", () => {
  it("compares the example 51H2342 at A01, without treating the same plate at A02 as a match", () => {
    const booking = {
      ...reservation,
      spotId: "A01",
      vehicle: { plateNumber: "51H2342" },
    };
    const reading = { ...observation, spotId: "A01", plateRaw: "51h-23.42" };
    expect(matchReservation(reading, [booking]).matchStatus).toBe("MATCH");
    expect(
      matchReservation({ ...reading, plateRaw: "51H9999" }, [booking])
        .matchStatus,
    ).toBe("MISMATCH");
    expect(
      matchReservation({ ...reading, spotId: "A02" }, [booking]).matchStatus,
    ).toBe("NO_RESERVATION");
  });
  it("normalizes separators without guessing ambiguous characters", () => {
    expect(normalizePlate(" 30a–123.45\n")).toBe("30A12345");
    expect(normalizePlate("30a-OI123")).toBe("30AOI123");
    expect(normalizePlate("30A@12345")).toBe("30A@12345");
  });
  it("matches and snapshots the reservation at the observation time", () => {
    expect(matchReservation(observation, [reservation])).toMatchObject({
      matchStatus: "MATCH",
      reservationId: reservation.id,
      plateNormalized: "30A12345",
    });
  });
  it("reports mismatch", () => {
    expect(
      matchReservation({ ...observation, plateRaw: "51B-99999" }, [reservation])
        .matchStatus,
    ).toBe("MISMATCH");
  });
  it("reports no reservation for wrong spot, expired, future, cancelled and completed bookings", () => {
    const invalid = [
      { ...reservation, spotId: "other" },
      { ...reservation, expiresAt: time },
      { ...reservation, startsAt: new Date(time.getTime() + 1) },
      { ...reservation, status: "EXPIRED" },
      { ...reservation, status: "CANCELLED" },
      { ...reservation, status: "COMPLETED" },
      { ...reservation, status: "PENDING" },
    ];
    for (const candidate of invalid)
      expect(matchReservation(observation, [candidate]).matchStatus).toBe(
        "NO_RESERVATION",
      );
    expect(matchReservation(observation, []).matchStatus).toBe(
      "NO_RESERVATION",
    );
    expect(
      matchReservation({ ...observation, timestamp: reservation.startsAt }, [
        reservation,
      ]).matchStatus,
    ).toBe("MATCH");
  });
  it("does not conclude from unknown, lost camera, empty spot or weak OCR/association", () => {
    const uncertain = [
      { recognitionStatus: "CAMERA_LOST" },
      { recognitionStatus: "UNREADABLE" },
      { recognitionStatus: "AMBIGUOUS" },
      { occupancyStatus: "EMPTY" },
      { occupancyStatus: "UNKNOWN" },
      { ocrConfidence: 0.5 },
      { associationConfidence: 0.2 },
      { vehicleConfidence: null },
      { plateSamples: 2 },
      { plateRaw: "30A-OI123" },
      { plateRaw: null },
    ];
    for (const fields of uncertain)
      expect(
        matchReservation({ ...observation, ...fields }, [reservation])
          .matchStatus,
      ).toBe("INSUFFICIENT");
    expect(
      matchReservation(observation, [
        reservation,
        { ...reservation, id: "second" },
      ]).matchStatus,
    ).toBe("INSUFFICIENT");
  });
});
