import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  normalizePlate,
  plausiblePlate,
} from "../src/modules/gate/plate-utils.js";
import {
  processGateScan,
  type GateScanConfig,
} from "../src/modules/gate/gate.service.js";

const baseConfig: GateScanConfig = {
  reentryCooldownSeconds: 15,
  minOcrConfidence: 0.65,
  minPlateSamples: 2,
};

function makeMockTx() {
  let eventCounter = 0;
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi
      .fn()
      .mockResolvedValue([{ id: "lot-1", capacity: 10, is_active: true }]),
    reservation: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    vehicle: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    parkingSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: "session-1" }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: "audit-1" }),
    },
    gateEvent: {
      create: vi.fn().mockImplementation(async () => ({
        id: `event-${++eventCounter}`,
      })),
    },
  };
  return tx;
}

describe("plate utilities", () => {
  it("normalizes dashes, dots, spaces, and case", () => {
    expect(normalizePlate(" 30a-123.45 ")).toBe("30A12345");
    expect(normalizePlate("51F\u2013678.90")).toBe("51F67890");
  });

  it("validates Vietnamese plate patterns", () => {
    expect(plausiblePlate("30A12345")).toBe(true);
    expect(plausiblePlate("51AB12345")).toBe(true);
    expect(plausiblePlate("29C1234")).toBe(true);
    expect(plausiblePlate("INVALID")).toBe(false);
    expect(plausiblePlate("12")).toBe(false);
  });
});

describe("gate barrier scan decision engine", () => {
  it("denies invalid plate format without opening barrier", async () => {
    const tx = makeMockTx();
    const outcome = await processGateScan(
      tx as unknown as Prisma.TransactionClient,
      {
        gateId: "main-gate-01",
        plateRaw: "BAD-PLATE",
        ocrConfidence: 0.99,
        plateSamples: 3,
      },
      baseConfig,
    );
    expect(outcome).toMatchObject({
      direction: "UNKNOWN",
      decision: "DENY",
      barrierAction: "STAY_CLOSED",
      reason: "invalid_plate_format",
      businessMutated: false,
    });
  });

  it("denies weak OCR confidence or too few frames", async () => {
    const tx = makeMockTx();
    const outcome = await processGateScan(
      tx as unknown as Prisma.TransactionClient,
      {
        gateId: "main-gate-01",
        plateRaw: "30A-12345",
        ocrConfidence: 0.45,
        plateSamples: 1,
      },
      baseConfig,
    );
    expect(outcome).toMatchObject({
      direction: "UNKNOWN",
      decision: "DENY",
      barrierAction: "STAY_CLOSED",
      reason: "weak_ocr_evidence",
      businessMutated: false,
    });
  });

  it("denies unregistered plate at gate entry", async () => {
    const tx = makeMockTx();
    const outcome = await processGateScan(
      tx as unknown as Prisma.TransactionClient,
      {
        gateId: "main-gate-01",
        plateRaw: "30A-12345",
        ocrConfidence: 0.92,
        plateSamples: 3,
      },
      baseConfig,
    );
    expect(outcome).toMatchObject({
      direction: "ENTRY",
      decision: "DENY",
      barrierAction: "STAY_CLOSED",
      reason: "vehicle_not_registered",
      plateNormalized: "30A12345",
    });
  });

  it("allows entry and opens barrier when confirmed reservation matches plate", async () => {
    const tx = makeMockTx();
    const now = new Date("2026-11-15T10:00:00.000Z");
    tx.vehicle.findUnique.mockResolvedValue({
      id: "veh-1",
      ownerId: "user-1",
      isActive: true,
      owner: { id: "user-1", isActive: true },
    });
    tx.reservation.findMany.mockResolvedValue([
      {
        id: "res-1",
        lotId: "lot-1",
        status: "CONFIRMED",
        paymentStatus: "NOT_REQUIRED",
        startsAt: new Date("2026-11-15T09:30:00.000Z"),
        expiresAt: new Date("2026-11-15T12:00:00.000Z"),
      },
    ]);

    const outcome = await processGateScan(
      tx as unknown as Prisma.TransactionClient,
      {
        gateId: "main-gate-01",
        lotId: "lot-1",
        plateRaw: "30a-123.45",
        ocrConfidence: 0.94,
        plateSamples: 2,
        timestamp: now,
      },
      baseConfig,
    );

    expect(outcome).toMatchObject({
      direction: "ENTRY",
      decision: "ALLOW",
      barrierAction: "OPEN",
      reason: "valid_reservation_entry",
      plateNormalized: "30A12345",
      lotId: "lot-1",
      reservationId: "res-1",
      sessionId: "session-1",
      businessMutated: true,
    });
    expect(tx.parkingSession.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("blocks unpaid reservations with payment_required", async () => {
    const tx = makeMockTx();
    const now = new Date("2026-11-15T10:00:00.000Z");
    tx.vehicle.findUnique.mockResolvedValue({
      id: "veh-1",
      ownerId: "user-1",
      isActive: true,
      owner: { id: "user-1", isActive: true },
    });
    tx.reservation.findMany.mockResolvedValue([
      {
        id: "res-1",
        lotId: "lot-1",
        status: "CONFIRMED",
        paymentStatus: "UNPAID",
        startsAt: new Date("2026-11-15T09:30:00.000Z"),
        expiresAt: new Date("2026-11-15T12:00:00.000Z"),
      },
    ]);

    const outcome = await processGateScan(
      tx as unknown as Prisma.TransactionClient,
      {
        gateId: "main-gate-01",
        plateRaw: "30A-12345",
        ocrConfidence: 0.94,
        plateSamples: 2,
        timestamp: now,
      },
      baseConfig,
    );

    expect(outcome).toMatchObject({
      direction: "ENTRY",
      decision: "DENY",
      barrierAction: "STAY_CLOSED",
      reason: "payment_required",
      businessMutated: false,
    });
    expect(tx.parkingSession.create).not.toHaveBeenCalled();
  });

  it("applies reentry cooldown before allowing shared-gate exit check-out", async () => {
    const tx = makeMockTx();
    const checkedInAt = new Date("2026-11-15T10:00:00.000Z");
    tx.vehicle.findUnique.mockResolvedValue({
      id: "veh-1",
      ownerId: "user-1",
      isActive: true,
      owner: { id: "user-1", isActive: true },
    });
    tx.parkingSession.findFirst.mockResolvedValue({
      id: "session-1",
      lotId: "lot-1",
      reservationId: "res-1",
      checkedInAt,
      lot: { id: "lot-1", name: "Lot A" },
    });

    const tooSoon = await processGateScan(
      tx as unknown as Prisma.TransactionClient,
      {
        gateId: "main-gate-01",
        plateRaw: "30A-12345",
        ocrConfidence: 0.91,
        plateSamples: 3,
        timestamp: new Date(checkedInAt.getTime() + 5_000),
      },
      baseConfig,
    );
    expect(tooSoon).toMatchObject({
      direction: "EXIT",
      decision: "COOLDOWN",
      barrierAction: "STAY_CLOSED",
      reason: "reentry_cooldown",
      businessMutated: false,
    });

    const exiting = await processGateScan(
      tx as unknown as Prisma.TransactionClient,
      {
        gateId: "main-gate-01",
        plateRaw: "30A-12345",
        ocrConfidence: 0.91,
        plateSamples: 3,
        timestamp: new Date(checkedInAt.getTime() + 20_000),
      },
      baseConfig,
    );
    expect(exiting).toMatchObject({
      direction: "EXIT",
      decision: "ALLOW",
      barrierAction: "OPEN",
      reason: "active_session_exit",
      sessionId: "session-1",
      businessMutated: true,
    });
    expect(tx.parkingSession.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.reservation.updateMany).toHaveBeenCalledWith({
      where: {
        id: "res-1",
        status: "CHECKED_IN",
      },
      data: {
        status: "COMPLETED",
        completedAt: expect.any(Date),
      },
    });
  });
});
