import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/config/prisma.js";

const runDbTests =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip;

const testEmails = ["user-test@example.com", "admin-test@example.com"];

async function cleanupTestData() {
  await prisma.gateCommand.deleteMany({
    where: { gateId: "gate-test-01" },
  });
  await prisma.gateEvent.deleteMany({
    where: { gateId: "gate-test-01" },
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
        { lot: { name: "Lot Test" } },
      ],
    },
  });
  await prisma.vehicle.deleteMany({
    where: { plateNormalized: { in: ["30A99999", "30A88888"] } },
  });
  await prisma.parkingLot.deleteMany({ where: { name: "Lot Test" } });
  await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
}

runDbTests("smart parking gate barrier API", () => {
  let userToken = "";
  let adminToken = "";
  let vehicleId1 = "";
  let vehicleId2 = "";
  let lotId = "";

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

  it("creates vehicles with unique normalized plates and lot capacity", async () => {
    const v1 = await request(app)
      .post("/api/vehicles")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ plateNumber: "30a-999.99", type: "CAR" });
    expect(v1.status).toBe(201);
    expect(v1.body.vehicle.plateNormalized).toBe("30A99999");
    vehicleId1 = v1.body.vehicle.id;

    const duplicate = await request(app)
      .post("/api/vehicles")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ plateNumber: "30A99999", type: "CAR" });
    expect(duplicate.status).toBe(409);

    const v2 = await request(app)
      .post("/api/vehicles")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ plateNumber: "30A-88888", type: "CAR" });
    expect(v2.status).toBe(201);
    vehicleId2 = v2.body.vehicle.id;

    const lot = await request(app)
      .post("/api/parking/lots")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Lot Test", address: "Campus Gate", capacity: 1 });
    expect(lot.status).toBe(201);
    expect(lot.body.lot.capacity).toBe(1);
    lotId = lot.body.lot.id;
  });

  it("enforces lot capacity atomically on reservations", async () => {
    const first = await request(app)
      .post("/api/reservations")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ vehicleId: vehicleId1, lotId });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/reservations")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ vehicleId: vehicleId2, lotId });
    expect(second.status).toBe(409);
  });

  it("authenticates gate camera and automates entry, cooldown, and exit", async () => {
    const unauth = await request(app).post("/api/gate/scan").send({
      gateId: "gate-test-01",
      lotId,
      plateRaw: "30A-99999",
      ocrConfidence: 0.95,
      plateSamples: 3,
    });
    expect(unauth.status).toBe(401);

    const denyOther = await request(app)
      .post("/api/gate/scan")
      .set("x-vision-api-key", env.VISION_API_KEY)
      .send({
        gateId: "gate-test-01",
        lotId,
        plateRaw: "30A-88888",
        ocrConfidence: 0.95,
        plateSamples: 3,
      });
    expect(denyOther.status).toBe(200);
    expect(denyOther.body.decision).toBe("DENY");
    expect(denyOther.body.barrierAction).toBe("STAY_CLOSED");

    const entryTime = new Date();
    const allowEntry = await request(app)
      .post("/api/gate/scan")
      .set("x-vision-api-key", env.VISION_API_KEY)
      .send({
        gateId: "gate-test-01",
        lotId,
        plateRaw: "30A-99999",
        ocrConfidence: 0.95,
        plateSamples: 3,
        timestamp: entryTime.toISOString(),
      });
    expect(allowEntry.status).toBe(200);
    expect(allowEntry.body).toMatchObject({
      direction: "ENTRY",
      decision: "ALLOW",
      barrierAction: "OPEN",
      businessMutated: true,
    });

    const cooldown = await request(app)
      .post("/api/gate/scan")
      .set("x-vision-api-key", env.VISION_API_KEY)
      .send({
        gateId: "gate-test-01",
        lotId,
        plateRaw: "30A-99999",
        ocrConfidence: 0.95,
        plateSamples: 3,
        timestamp: new Date(entryTime.getTime() + 3000).toISOString(),
      });
    expect(cooldown.status).toBe(200);
    expect(cooldown.body.decision).toBe("COOLDOWN");
    expect(cooldown.body.barrierAction).toBe("STAY_CLOSED");

    const allowExit = await request(app)
      .post("/api/gate/scan")
      .set("x-vision-api-key", env.VISION_API_KEY)
      .send({
        gateId: "gate-test-01",
        lotId,
        plateRaw: "30A-99999",
        ocrConfidence: 0.95,
        plateSamples: 3,
        timestamp: new Date(
          entryTime.getTime() + (env.GATE_REENTRY_COOLDOWN_SECONDS + 5) * 1000,
        ).toISOString(),
      });
    expect(allowExit.status).toBe(200);
    expect(allowExit.body).toMatchObject({
      direction: "EXIT",
      decision: "ALLOW",
      barrierAction: "OPEN",
      businessMutated: true,
    });
  });

  it("queues and claims manual barrier open commands", async () => {
    const manual = await request(app)
      .post("/api/gate/manual-open")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ gateId: "gate-test-01", lotId, durationMs: 5000 });
    expect(manual.status).toBe(201);

    const claim1 = await request(app)
      .post("/api/gate/commands/claim")
      .set("x-vision-api-key", env.VISION_API_KEY)
      .send({ gateId: "gate-test-01" });
    expect(claim1.status).toBe(200);
    expect(claim1.body.command.command).toBe("OPEN");

    const claim2 = await request(app)
      .post("/api/gate/commands/claim")
      .set("x-vision-api-key", env.VISION_API_KEY)
      .send({ gateId: "gate-test-01" });
    expect(claim2.status).toBe(200);
    expect(claim2.body.command).toBeNull();
  });
});
