import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  parkingSpot: { findMany: vi.fn() },
  reservation: { findMany: vi.fn() },
  cameraObservation: { createMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  user: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("../src/config/prisma.js", () => ({ prisma: db }));
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { signAccessToken } from "../src/middleware/auth.js";
import { realtimeEvents } from "../src/realtime/events.js";

const spotId = "00000000-0000-4000-8000-000000000001";
const payload = {
  cameraId: "test-camera",
  spotId,
  timestamp: "2026-10-29T09:00:00Z",
  occupancyStatus: "OCCUPIED",
  confidence: 0.8,
  recognitionStatus: "READ",
  plateRaw: "30a-123.45",
  plateNormalized: "FAKE",
  ocrConfidence: 0.9,
  associationConfidence: 0.9,
  vehicleConfidence: 0.9,
  plateSamples: 3,
  matchStatus: "MATCH",
  reservationId: "client-forged",
};

beforeEach(() => {
  vi.clearAllMocks();
  db.parkingSpot.findMany.mockResolvedValue([{ id: spotId }]);
  db.reservation.findMany.mockResolvedValue([]);
  db.cameraObservation.findMany.mockResolvedValue([]);
  db.cameraObservation.createMany.mockImplementation(async ({ data }) => ({
    count: data.length,
  }));
  db.$transaction.mockImplementation(async (callback) => callback(db));
});

describe("Vision REST contract", () => {
  it("publishes realtime changes only after the transaction commits", async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    db.$transaction.mockImplementation(async (callback) => {
      entered();
      await gate;
      return callback(db);
    });
    const listener = vi.fn();
    realtimeEvents.on("change", listener);
    try {
      const response = request(app)
        .post("/api/vision/observations")
        .set("x-vision-api-key", env.VISION_API_KEY)
        .send(payload)
        .then((value) => value);
      await started;
      expect(listener).not.toHaveBeenCalled();
      release();
      expect((await response).status).toBe(202);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        scope: "vision",
        at: expect.any(String),
      });
    } finally {
      release();
      realtimeEvents.off("change", listener);
    }
  });
  it("does not publish a realtime success for a rolled-back transaction", async () => {
    db.$transaction.mockRejectedValueOnce(new Error("fixture rollback"));
    const listener = vi.fn();
    realtimeEvents.on("change", listener);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await request(app)
        .post("/api/vision/observations")
        .set("x-vision-api-key", env.VISION_API_KEY)
        .send(payload);
      expect(response.status).toBe(500);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      realtimeEvents.off("change", listener);
    }
  });
  it("requires the service key and returns only active calibration spot identifiers", async () => {
    expect((await request(app).get("/api/vision/spots")).status).toBe(401);
    expect(db.parkingSpot.findMany).not.toHaveBeenCalled();
    const response = await request(app)
      .get("/api/vision/spots")
      .set("x-vision-api-key", env.VISION_API_KEY);
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([{ id: spotId }]);
    expect(db.parkingSpot.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        isActive: true,
        area: { isActive: true, lot: { isActive: true } },
      },
      select: { id: true, code: true },
    });
    expect(db.reservation.findMany).not.toHaveBeenCalled();
  });
  it("rejects absent and wrong API keys before reading the DB", async () => {
    for (const key of [undefined, "wrong"] as const) {
      const req = request(app).post("/api/vision/observations");
      if (key) req.set("x-vision-api-key", key);
      expect((await req.send(payload)).status).toBe(401);
    }
    expect(db.parkingSpot.findMany).not.toHaveBeenCalled();
  });
  it("computes normalized text and match on server and queries exact spot/time", async () => {
    const result = await request(app)
      .post("/api/vision/observations")
      .set("x-vision-api-key", env.VISION_API_KEY)
      .send(payload);
    expect(result.status).toBe(202);
    expect(
      db.cameraObservation.createMany.mock.calls[0][0].data[0],
    ).toMatchObject({
      plateNormalized: "30A12345",
      matchStatus: "NO_RESERVATION",
      reservationId: null,
    });
    expect(db.reservation.findMany.mock.calls[0][0].where).toMatchObject({
      spotId,
      startsAt: { lte: new Date(payload.timestamp) },
      expiresAt: { gt: new Date(payload.timestamp) },
    });
  });
  it("accepts legacy observations conservatively and rejects invalid confidence/unknown spot", async () => {
    const send = (body: object) =>
      request(app)
        .post("/api/vision/observations")
        .set("x-vision-api-key", env.VISION_API_KEY)
        .send(body);
    expect(
      (
        await send({
          cameraId: "old",
          spotId,
          timestamp: payload.timestamp,
          occupancyStatus: "EMPTY",
          confidence: 1,
        })
      ).status,
    ).toBe(202);
    expect(
      db.cameraObservation.createMany.mock.calls[0][0].data[0],
    ).toMatchObject({
      recognitionStatus: "NOT_REQUESTED",
      matchStatus: "INSUFFICIENT",
    });
    expect((await send({ ...payload, ocrConfidence: 1.5 })).status).toBe(400);
    db.parkingSpot.findMany.mockResolvedValue([]);
    expect((await send(payload)).status).toBe(400);
  });
  it("protects reads and redacts plates, reservation info and metadata for ordinary users", async () => {
    expect((await request(app).get("/api/vision/observations")).status).toBe(
      401,
    );
    const row = {
      id: "obs",
      cameraId: "c",
      spotId,
      occupancyStatus: "OCCUPIED",
      confidence: 0.8,
      observedAt: new Date(),
      receivedAt: new Date(),
      spot: { id: spotId, code: "A01" },
      plateRaw: "30A-12345",
      expectedPlate: "51B12345",
      reservationId: "secret",
      metadata: { owner: "secret" },
    };
    db.cameraObservation.findMany.mockResolvedValue([row]);
    db.cameraObservation.count.mockResolvedValue(1);
    for (const role of ["USER", "ADMIN"] as const) {
      const user = {
        id: "test-user",
        email: "test@example.com",
        role,
        isActive: true,
      };
      db.user.findUnique.mockResolvedValue(user);
      const token = signAccessToken(user);
      for (const path of [
        "/api/vision/observations",
        "/api/vision/observations/latest",
      ]) {
        const result = await request(app)
          .get(path)
          .set("Authorization", `Bearer ${token}`);
        expect(result.status).toBe(200);
        expect(result.body.items[0].plateRaw).toBe(
          role === "ADMIN" ? row.plateRaw : undefined,
        );
        expect(result.body.items[0].metadata).toEqual(
          role === "ADMIN" ? row.metadata : undefined,
        );
        expect(result.body.items[0].spot.code).toBe("A01");
      }
    }
  });
});
