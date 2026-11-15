import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { signAccessToken } from "../src/middleware/auth.js";
import {
  createWeek10Fixture,
  cleanupWeek10Fixture,
  type Week10Fixture,
} from "./helpers/week10-fixture.js";

const run = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip;
let fixture: Week10Fixture;
let reservationId: string;
run("reservation plate verification for its owner", () => {
  beforeEach(async () => {
    fixture = await createWeek10Fixture(prisma);
    const result = await request(app)
      .post("/api/reservations")
      .set("Authorization", `Bearer ${signAccessToken(fixture.owner)}`)
      .send({ vehicleId: fixture.vehicle.id, spotId: fixture.spots[0].id });
    expect(result.status).toBe(201);
    reservationId = result.body.reservation.id;
  });
  afterEach(async () => {
    if (fixture) await cleanupWeek10Fixture(prisma, fixture);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const verify = (admin = false) =>
    request(app)
      .get(`/api/reservations/${reservationId}/verification`)
      .set(
        "Authorization",
        `Bearer ${signAccessToken(admin ? fixture.admin : fixture.owner)}`,
      );
  const ingest = (overrides: object = {}) =>
    request(app)
      .post("/api/vision/observations")
      .set("x-vision-api-key", env.VISION_API_KEY)
      .send({
        cameraId: fixture.cameraId,
        spotId: fixture.spots[0].id,
        timestamp: new Date().toISOString(),
        occupancyStatus: "OCCUPIED",
        confidence: 0.95,
        recognitionStatus: "READ",
        plateRaw: fixture.vehicle.plateNumber.toLowerCase(),
        ocrConfidence: 0.95,
        vehicleConfidence: 0.9,
        associationConfidence: 0.9,
        plateSamples: 3,
        ...overrides,
      });

  it("shows the expected plate while waiting, then matches normalized camera evidence without check-in", async () => {
    expect((await verify()).body).toMatchObject({
      expectedPlate: fixture.vehicle.plateNumber,
      matchStatus: "INSUFFICIENT",
      reason: "waiting_for_camera",
    });
    expect((await ingest()).status).toBe(202);
    expect((await verify()).body).toMatchObject({
      spotCode: "A01",
      expectedPlate: fixture.vehicle.plateNumber,
      matchStatus: "MATCH",
      observation: {
        plateNormalized: fixture.vehicle.plateNumber,
        plateHidden: false,
      },
    });
    expect(
      await prisma.parkingSession.count({
        where: { vehicleId: fixture.vehicle.id },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.cameraObservation.findFirstOrThrow({
          where: { cameraId: fixture.cameraId },
        })
      ).matchStatus,
    ).toBe("MATCH");
  });
  it("reports mismatch, hiding another plate from USER while letting ADMIN review it", async () => {
    expect(
      (await ingest({ plateRaw: fixture.otherVehicle.plateNumber })).status,
    ).toBe(202);
    const owner = await verify();
    expect(owner.body).toMatchObject({
      matchStatus: "MISMATCH",
      observation: { plateNormalized: null, plateHidden: true },
    });
    expect(JSON.stringify(owner.body)).not.toContain(
      fixture.otherVehicle.plateNumber,
    );
    expect((await verify(true)).body).toMatchObject({
      matchStatus: "MISMATCH",
      observation: { plateNormalized: fixture.otherVehicle.plateNumber },
    });
  });
  it("does not use observations from A02 to confirm the booking at A01", async () => {
    expect((await ingest({ spotId: fixture.spots[1].id })).status).toBe(202);
    expect((await verify()).body).toMatchObject({
      matchStatus: "INSUFFICIENT",
      reason: "waiting_for_camera",
    });
  });
  it("does not conclude from unreadable, weak, ambiguous, empty or lost-camera evidence", async () => {
    for (const override of [
      { recognitionStatus: "UNREADABLE", plateRaw: null },
      { ocrConfidence: 0.5 },
      { plateSamples: 1 },
      { recognitionStatus: "AMBIGUOUS" },
      { occupancyStatus: "EMPTY", recognitionStatus: "NO_VEHICLE" },
      { occupancyStatus: "UNKNOWN", recognitionStatus: "CAMERA_LOST" },
    ]) {
      expect((await ingest(override)).status).toBe(202);
      expect((await verify()).body.matchStatus).toBe("INSUFFICIENT");
    }
  });
  it("rejects authentication and access to another user's booking", async () => {
    expect(
      (
        await request(app).get(
          `/api/reservations/${reservationId}/verification`,
        )
      ).status,
    ).toBe(401);
    const other = await prisma.user.update({
      where: { id: fixture.admin.id },
      data: { role: "USER" },
    });
    expect(
      (
        await request(app)
          .get(`/api/reservations/${reservationId}/verification`)
          .set("Authorization", `Bearer ${signAccessToken(other)}`)
      ).status,
    ).toBe(403);
  });
  it("cannot confirm cancelled, expired or not-yet-started reservations", async () => {
    await ingest();
    for (const change of [
      { status: "CANCELLED" as const },
      { status: "CONFIRMED" as const, expiresAt: new Date(Date.now() - 1) },
      {
        startsAt: new Date(Date.now() + 60_000),
        expiresAt: new Date(Date.now() + 120_000),
      },
    ]) {
      await prisma.reservation.update({
        where: { id: reservationId },
        data: change,
      });
      expect((await verify()).body).toMatchObject({
        matchStatus: "INSUFFICIENT",
        reason: "reservation_not_effective",
        observation: null,
      });
    }
  });
  it("ignores pre-booking/future frames and stops showing MATCH when the latest camera evidence is stale", async () => {
    expect(
      (await ingest({ timestamp: new Date(Date.now() - 5000).toISOString() }))
        .status,
    ).toBe(202);
    expect(
      (
        await ingest({
          timestamp: new Date(Date.now() + 120_000).toISOString(),
        })
      ).status,
    ).toBe(202);
    expect((await verify()).body.reason).toBe("waiting_for_camera");
    const past = new Date(Date.now() - 120_000);
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { startsAt: past, createdAt: past },
    });
    await prisma.cameraObservation.updateMany({
      where: { cameraId: fixture.cameraId },
      data: { observedAt: new Date(Date.now() - 65_000) },
    });
    expect((await verify()).body).toMatchObject({
      matchStatus: "INSUFFICIENT",
      reason: "camera_observation_stale",
    });
  });
});
