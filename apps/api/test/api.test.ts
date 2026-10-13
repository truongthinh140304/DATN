import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

const runDbTests =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip;

const testEmails = ["user-test@example.com", "admin-test@example.com"];

async function cleanupTestData() {
  await prisma.cameraObservation.deleteMany({
    where: { cameraId: "test-camera" },
  });
  await prisma.auditLog.deleteMany({
    where: { actor: { email: { in: testEmails } } },
  });
  await prisma.parkingSession.deleteMany({
    where: { user: { email: { in: testEmails } } },
  });
  await prisma.reservation.deleteMany({
    where: {
      OR: [
        { user: { email: { in: testEmails } } },
        { spot: { area: { lot: { name: "Lot Test" } } } },
      ],
    },
  });
  await prisma.vehicle.deleteMany({ where: { plateNumber: "30A-99999" } });
  await prisma.parkingLot.deleteMany({ where: { name: "Lot Test" } });
  await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
}

runDbTests("smart parking API", () => {
  let userToken = "";
  let adminToken = "";
  let vehicleId = "";
  let spotId = "";

  beforeAll(cleanupTestData);
  afterAll(cleanupTestData);

  it("registers normal users without admin self-grant", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "user-test@example.com",
      password: "User12345!",
      fullName: "User Test",
      role: "ADMIN",
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("USER");
    userToken = res.body.accessToken;
  });

  it("requires admin role for user management", async () => {
    const forbidden = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${userToken}`);
    expect(forbidden.status).toBe(403);

    await request(app).post("/api/auth/register").send({
      email: "admin-test@example.com",
      password: "Admin12345!",
      fullName: "Admin Seed",
    });
    await prisma.user.update({
      where: { email: "admin-test@example.com" },
      data: { role: "ADMIN" },
    });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin-test@example.com", password: "Admin12345!" });
    adminToken = login.body.accessToken;

    const ok = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
  });

  it("creates vehicle and parking structure", async () => {
    const vehicle = await request(app)
      .post("/api/vehicles")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ plateNumber: "30A-99999", type: "CAR" });
    expect(vehicle.status).toBe(201);
    vehicleId = vehicle.body.vehicle.id;

    const lot = await request(app)
      .post("/api/parking/lots")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Lot Test", address: "Campus" });
    const area = await request(app)
      .post("/api/parking/areas")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ lotId: lot.body.lot.id, code: "B", name: "Area B" });
    const spot = await request(app)
      .post("/api/parking/spots")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ areaId: area.body.area.id, code: "B01" });
    expect(spot.status).toBe(201);
    spotId = spot.body.spot.id;
  });

  it("authenticates and stores camera observations without changing spot status", async () => {
    const observation = {
      cameraId: "test-camera",
      spotId,
      occupancyStatus: "OCCUPIED",
      confidence: 0.91,
      timestamp: new Date().toISOString(),
    };

    const unauthorized = await request(app)
      .post("/api/vision/observations")
      .send(observation);
    expect(unauthorized.status).toBe(401);

    const accepted = await request(app)
      .post("/api/vision/observations")
      .set("x-vision-api-key", "change_me_vision_service_key")
      .send(observation);
    expect(accepted.status).toBe(202);
    expect(accepted.body.accepted).toBe(1);

    const spot = await prisma.parkingSpot.findUniqueOrThrow({
      where: { id: spotId },
    });
    expect(spot.status).toBe("AVAILABLE");
  });

  it("prevents two valid reservations on the same spot", async () => {
    const first = await request(app)
      .post("/api/reservations")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ vehicleId, spotId });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/reservations")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ vehicleId, spotId });
    expect(second.status).toBe(409);
  });
});
