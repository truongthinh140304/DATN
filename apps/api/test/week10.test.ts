import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { signAccessToken } from "../src/middleware/auth.js";
import { realtimeEvents } from "../src/realtime/events.js";
import {
  createWeek10Fixture,
  cleanupWeek10Fixture,
  type Week10Fixture,
} from "./helpers/week10-fixture.js";

const run = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip;
let fixture: Week10Fixture;
run("week10 cross-module regressions", () => {
  beforeEach(async () => {
    fixture = await createWeek10Fixture(prisma);
  });
  afterEach(async () => {
    if (fixture) await cleanupWeek10Fixture(prisma, fixture);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const reserve = (data: object = {}) =>
    request(app)
      .post("/api/reservations")
      .set("Authorization", `Bearer ${signAccessToken(fixture.owner)}`)
      .send({
        vehicleId: fixture.vehicle.id,
        spotId: fixture.spots[0].id,
        ...data,
      });

  it("rejects booking an inactive vehicle without reserving the spot", async () => {
    await prisma.vehicle.update({
      where: { id: fixture.vehicle.id },
      data: { isActive: false },
    });
    expect((await reserve()).status).toBe(409);
    expect(
      (
        await prisma.parkingSpot.findUniqueOrThrow({
          where: { id: fixture.spots[0].id },
        })
      ).status,
    ).toBe("AVAILABLE");
  });
  it("publishes parking changes for a successful nested reservation route", async () => {
    const events: unknown[] = [];
    const listener = (event: unknown) => {
      events.push(event);
    };
    realtimeEvents.on("change", listener);
    try {
      expect((await reserve()).status).toBe(201);
      expect(events).toContainEqual({
        scope: "parking",
        at: expect.any(String),
      });
    } finally {
      realtimeEvents.off("change", listener);
    }
  });
  it("rejects bookings into an inactive area or lot", async () => {
    await prisma.parkingArea.update({
      where: { id: fixture.areaId },
      data: { isActive: false },
    });
    expect((await reserve()).status).toBe(409);
    await prisma.parkingArea.update({
      where: { id: fixture.areaId },
      data: { isActive: true },
    });
    await prisma.parkingLot.update({
      where: { id: fixture.lotId },
      data: { isActive: false },
    });
    expect((await reserve()).status).toBe(409);
    expect(
      await prisma.reservation.count({
        where: { vehicleId: fixture.vehicle.id },
      }),
    ).toBe(0);
  });
  it("does not accept a newly created reservation that already expired", async () => {
    expect(
      (
        await reserve({
          startsAt: new Date(Date.now() - 120000).toISOString(),
          expiresAt: new Date(Date.now() - 60000).toISOString(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await prisma.parkingSpot.findUniqueOrThrow({
          where: { id: fixture.spots[0].id },
        })
      ).status,
    ).toBe("AVAILABLE");
  });
  it("allows only one of two concurrent reservations for the same parking spot", async () => {
    const responses = await Promise.all([
      reserve(),
      reserve({ vehicleId: fixture.otherVehicle.id }),
    ]);
    expect(responses.map((item) => item.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.reservation.count({
        where: { spotId: fixture.spots[0].id },
      }),
    ).toBe(1);
  });
  it("does not let a future-dated frame poison the live snapshot or suppress current warnings", async () => {
    const at = new Date();
    const base = {
      cameraId: fixture.cameraId,
      spotId: fixture.spots[0].id,
      occupancyStatus: "OCCUPIED",
      confidence: 0.9,
      recognitionStatus: "READ",
      plateRaw: fixture.vehicle.plateNumber,
      ocrConfidence: 0.95,
      vehicleConfidence: 0.95,
      associationConfidence: 0.9,
      plateSamples: 3,
    };
    const send = (timestamp: Date) =>
      request(app)
        .post("/api/vision/observations")
        .set("x-vision-api-key", env.VISION_API_KEY)
        .send({ ...base, timestamp: timestamp.toISOString() });
    expect((await send(new Date(at.getTime() + 120000))).status).toBe(202);
    expect((await send(at)).status).toBe(202);
    const latest = await request(app)
      .get(`/api/vision/observations/latest?cameraId=${fixture.cameraId}`)
      .set("Authorization", `Bearer ${signAccessToken(fixture.admin)}`);
    expect(latest.status).toBe(200);
    expect(latest.body.items[0].observedAt).toBe(at.toISOString());
    expect(
      await prisma.visionAlert.count({
        where: { cameraId: fixture.cameraId, type: "UNRESERVED_VEHICLE" },
      }),
    ).toBe(1);
    expect(
      await prisma.cameraObservation.count({
        where: { cameraId: fixture.cameraId },
      }),
    ).toBe(2);
  });
});
