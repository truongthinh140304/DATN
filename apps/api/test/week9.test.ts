import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { signAccessToken } from "../src/middleware/auth.js";

const run = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip;
const suffix = randomUUID();
const cameraId = `week9-test-${suffix}`;
let userId = "",
  adminId = "",
  lotId = "",
  vehicleId = "",
  otherVehicleId = "",
  spotA = "",
  spotB = "",
  userToken = "",
  adminToken = "";
const plate = `99Z${Math.floor(100000 + Math.random() * 899999)}`;
const otherPlate = plate.replace("Z", "Y");
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
async function cleanOperations() {
  await prisma.visionAlert.deleteMany({ where: { cameraId } });
  await prisma.cameraObservation.deleteMany({ where: { cameraId } });
  await prisma.auditLog.deleteMany({
    where: { actorId: { in: [userId, adminId].filter(Boolean) } },
  });
  if (!lotId) return;
  await prisma.parkingSession.deleteMany({
    where: { spot: { area: { lotId } } },
  });
  await prisma.reservation.deleteMany({ where: { spot: { area: { lotId } } } });
  await prisma.parkingSpot.updateMany({
    where: { area: { lotId } },
    data: { status: "AVAILABLE", isActive: true },
  });
  await prisma.vehicle.updateMany({
    where: { id: { in: [vehicleId, otherVehicleId] } },
    data: { isActive: true },
  });
}
async function booking(overrides: object = {}) {
  const result = await request(app)
    .post("/api/reservations")
    .set(auth(userToken))
    .send({
      vehicleId,
      spotId: spotA,
      startsAt: new Date(Date.now() - 600_000).toISOString(),
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      ...overrides,
    });
  expect(result.status).toBe(201);
  return result.body.reservation;
}
function observation(spotId = spotB, overrides: object = {}) {
  return {
    cameraId,
    spotId,
    timestamp: new Date().toISOString(),
    occupancyStatus: "OCCUPIED",
    confidence: 0.9,
    recognitionStatus: "READ",
    plateRaw: plate,
    ocrConfidence: 0.95,
    vehicleConfidence: 0.9,
    associationConfidence: 0.9,
    plateSamples: 3,
    ...overrides,
  };
}
const ingest = (body: object) =>
  request(app)
    .post("/api/vision/observations")
    .set("x-vision-api-key", env.VISION_API_KEY)
    .send(body);
const alerts = () =>
  prisma.visionAlert.findMany({
    where: { cameraId },
    orderBy: { firstSeenAt: "asc" },
  });

run("week 9 PostgreSQL business and warning lifecycle", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `w9-user-${suffix}@example.com`,
        fullName: "Week9 fixture",
        passwordHash: "not-a-login",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: `w9-admin-${suffix}@example.com`,
        fullName: "Week9 fixture admin",
        passwordHash: "not-a-login",
        role: "ADMIN",
      },
    });
    userId = user.id;
    adminId = admin.id;
    userToken = signAccessToken(user);
    adminToken = signAccessToken(admin);
    const lot = await prisma.parkingLot.create({
      data: {
        name: `Week9 test ${suffix}`,
        address: "Test fixture",
        areas: {
          create: {
            code: "W9",
            name: "Test",
            spots: { create: [{ code: "T01" }, { code: "T02" }] },
          },
        },
      },
      include: { areas: { include: { spots: { orderBy: { code: "asc" } } } } },
    });
    lotId = lot.id;
    [spotA, spotB] = lot.areas[0].spots.map((item) => item.id);
    vehicleId = (
      await prisma.vehicle.create({
        data: { ownerId: userId, plateNumber: plate, type: "CAR" },
      })
    ).id;
    otherVehicleId = (
      await prisma.vehicle.create({
        data: { ownerId: userId, plateNumber: otherPlate, type: "CAR" },
      })
    ).id;
  });
  beforeEach(cleanOperations);
  afterAll(async () => {
    await cleanOperations();
    if (lotId) await prisma.parkingLot.delete({ where: { id: lotId } });
    await prisma.vehicle.deleteMany({
      where: { ownerId: { in: [userId, adminId].filter(Boolean) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userId, adminId].filter(Boolean) } },
    });
    await prisma.$disconnect();
  });
  it("protects alert history and acknowledgement from ordinary users", async () => {
    expect((await request(app).get("/api/vision/alerts")).status).toBe(401);
    expect(
      (await request(app).get("/api/vision/alerts").set(auth(userToken)))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/vision/alerts/${randomUUID()}/acknowledge`)
          .set(auth(userToken))
      ).status,
    ).toBe(403);
  });
  it("deduplicates wrong-spot warnings, preserves acknowledgement, and resolves after return to the expected bay", async () => {
    const reservation = await booking();
    expect((await ingest(observation())).status).toBe(202);
    let rows = await alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "WRONG_SPOT",
      expectedSpotId: spotA,
      reservationId: reservation.id,
      status: "OPEN",
    });
    const alertId = rows[0].id;
    expect(
      (
        await request(app)
          .post(`/api/vision/alerts/${alertId}/acknowledge`)
          .set(auth(adminToken))
      ).status,
    ).toBe(200);
    expect((await ingest(observation())).status).toBe(202);
    rows = await alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: alertId,
      status: "ACKNOWLEDGED",
      occurrences: 2,
    });
    expect(
      (await prisma.parkingSpot.findUniqueOrThrow({ where: { id: spotB } }))
        .status,
    ).toBe("AVAILABLE");
    expect(
      await prisma.parkingSession.count({
        where: { spotId: { in: [spotA, spotB] } },
      }),
    ).toBe(0);
    expect((await ingest(observation(spotA))).status).toBe(202);
    expect((await alerts())[0].status).toBe("RESOLVED");
    const history = await request(app)
      .get(`/api/vision/alerts?status=ALL&cameraId=${cameraId}`)
      .set(auth(adminToken));
    expect(history.status).toBe(200);
    expect(history.body.items).toHaveLength(1);
  });
  it("retains warnings on unknown/empty frames, and resolves a mismatch only with confident corrected evidence", async () => {
    await booking();
    expect(
      (await ingest(observation(spotA, { plateRaw: otherPlate }))).status,
    ).toBe(202);
    expect((await alerts())[0].type).toBe("PLATE_MISMATCH");
    await ingest(
      observation(spotA, {
        occupancyStatus: "EMPTY",
        recognitionStatus: "NO_VEHICLE",
        plateRaw: null,
      }),
    );
    await ingest(
      observation(spotA, {
        occupancyStatus: "UNKNOWN",
        recognitionStatus: "CAMERA_LOST",
        plateRaw: null,
      }),
    );
    expect((await alerts())[0].status).toBe("OPEN");
    await ingest(observation(spotA));
    expect((await alerts())[0].status).toBe("RESOLVED");
  });
  it("keeps weak, stale, future and out-of-order recognition in history without opening live alerts", async () => {
    await ingest(observation(spotB, { ocrConfidence: 0.4 }));
    await ingest(
      observation(spotB, {
        timestamp: new Date(Date.now() - 120_000).toISOString(),
      }),
    );
    await ingest(
      observation(spotB, {
        timestamp: new Date(Date.now() + 120_000).toISOString(),
      }),
    );
    await ingest(
      observation(spotB, {
        timestamp: new Date(Date.now() - 5000).toISOString(),
      }),
    );
    expect(await alerts()).toHaveLength(0);
    expect(await prisma.cameraObservation.count({ where: { cameraId } })).toBe(
      4,
    );
  });
  it("warns for unreserved vehicles but accepts a matching active walk-in session", async () => {
    await ingest(observation());
    expect((await alerts())[0].type).toBe("UNRESERVED_VEHICLE");
    const entered = await request(app)
      .post("/api/sessions/check-in")
      .set(auth(userToken))
      .send({ vehicleId, spotId: spotB });
    expect(entered.status).toBe(201);
    await ingest(observation());
    expect((await alerts())[0].status).toBe("RESOLVED");
  });
  it("rejects future, expired, inactive and unauthorized check-ins without partial mutations", async () => {
    const future = await booking({
      startsAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(
      (
        await request(app)
          .post("/api/sessions/check-in")
          .set(auth(userToken))
          .send({ vehicleId, spotId: spotA, reservationId: future.id })
      ).status,
    ).toBe(409);
    await prisma.reservation.update({
      where: { id: future.id },
      data: {
        startsAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    expect(
      (
        await request(app)
          .post("/api/sessions/check-in")
          .set(auth(userToken))
          .send({ vehicleId, spotId: spotA, reservationId: future.id })
      ).status,
    ).toBe(409);
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { isActive: false },
    });
    expect(
      (
        await request(app)
          .post("/api/sessions/check-in")
          .set(auth(userToken))
          .send({ vehicleId, spotId: spotB })
      ).status,
    ).toBe(409);
    expect(
      (await prisma.parkingSpot.findUniqueOrThrow({ where: { id: spotA } }))
        .status,
    ).toBe("RESERVED");
    expect(await prisma.parkingSession.count({ where: { vehicleId } })).toBe(0);
  });
  it("allows only one concurrent reserved check-in and one concurrent check-out, with audit logs", async () => {
    const reservation = await booking();
    const enter = () =>
      request(app)
        .post("/api/sessions/check-in")
        .set(auth(userToken))
        .send({ vehicleId, spotId: spotA, reservationId: reservation.id });
    const results = await Promise.all([enter(), enter()]);
    expect(results.map((item) => item.status).sort()).toEqual([201, 409]);
    const session = results.find((item) => item.status === 201)!.body.session;
    const exit = () =>
      request(app)
        .post(`/api/sessions/${session.id}/check-out`)
        .set(auth(userToken))
        .send({});
    expect(
      (await Promise.all([exit(), exit()])).map((item) => item.status).sort(),
    ).toEqual([200, 409]);
    expect(
      await prisma.auditLog.count({
        where: { actorId: userId, entityId: session.id },
      }),
    ).toBe(2);
    expect(
      (await prisma.parkingSpot.findUniqueOrThrow({ where: { id: spotA } }))
        .status,
    ).toBe("AVAILABLE");
  });
  it("rolls back the losing walk-in when one vehicle tries two spots concurrently", async () => {
    const enter = (spotId: string) =>
      request(app)
        .post("/api/sessions/check-in")
        .set(auth(userToken))
        .send({ vehicleId, spotId });
    const results = await Promise.all([enter(spotA), enter(spotB)]);
    expect(results.map((item) => item.status).sort()).toEqual([201, 409]);
    expect(await prisma.parkingSession.count({ where: { vehicleId } })).toBe(1);
    expect(
      await prisma.parkingSpot.count({
        where: { id: { in: [spotA, spotB] }, status: "AVAILABLE" },
      }),
    ).toBe(1);
  });
  it("preserves an inactive parking spot on check-out", async () => {
    const entered = await request(app)
      .post("/api/sessions/check-in")
      .set(auth(userToken))
      .send({ vehicleId, spotId: spotB });
    expect(entered.status).toBe(201);
    await prisma.parkingSpot.update({
      where: { id: spotB },
      data: { isActive: false, status: "INACTIVE" },
    });
    expect(
      (
        await request(app)
          .post(`/api/sessions/${entered.body.session.id}/check-out`)
          .set(auth(userToken))
          .send({})
      ).status,
    ).toBe(200);
    expect(
      (await prisma.parkingSpot.findUniqueOrThrow({ where: { id: spotB } }))
        .status,
    ).toBe("INACTIVE");
  });
  it("serializes concurrent warning ingests without duplicate live alerts", async () => {
    await booking();
    // Same observation time isolates write contention. Different timestamps may
    // arrive in reverse order; stale frames correctly do not increment alerts.
    const payload = observation();
    const result = await Promise.all([ingest(payload), ingest(payload)]);
    expect(result.map((item) => item.status)).toEqual([202, 202]);
    const rows = await alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0].occurrences).toBe(2);
  });
  it("does not let concurrent cancellation free a checked-in parking spot", async () => {
    const reservation = await booking();
    const [entered, cancelled] = await Promise.all([
      request(app)
        .post("/api/sessions/check-in")
        .set(auth(userToken))
        .send({ vehicleId, spotId: spotA, reservationId: reservation.id }),
      request(app)
        .post(`/api/reservations/${reservation.id}/cancel`)
        .set(auth(userToken))
        .send({}),
    ]);
    expect([entered.status, cancelled.status]).toEqual(
      entered.status === 201 ? [201, 409] : [409, 200],
    );
    expect(
      (await prisma.parkingSpot.findUniqueOrThrow({ where: { id: spotA } }))
        .status,
    ).toBe(entered.status === 201 ? "OCCUPIED" : "AVAILABLE");
    expect(
      await prisma.parkingSession.count({
        where: { vehicleId, status: "ACTIVE" },
      }),
    ).toBe(entered.status === 201 ? 1 : 0);
  });
});
