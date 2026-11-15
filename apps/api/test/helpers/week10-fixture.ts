import { randomBytes, randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";

export async function createWeek10Fixture(db: PrismaClient) {
  const runId = randomUUID();
  const password = randomBytes(18).toString("hex") + "Aa1!";
  const passwordHash = await bcrypt.hash(password, 4);
  return db.$transaction(async (tx) => {
    const owner = await tx.user.create({
      data: {
        email: `w10-owner-${runId}@example.com`,
        fullName: "Week10 fixture owner",
        passwordHash,
      },
    });
    const admin = await tx.user.create({
      data: {
        email: `w10-admin-${runId}@example.com`,
        fullName: "Week10 fixture admin",
        role: "ADMIN",
        passwordHash,
      },
    });
    const vehicle = await tx.vehicle.create({
      data: {
        ownerId: owner.id,
        plateNumber: `99W${randomInt(100000, 1000000)}`,
        type: "CAR",
      },
    });
    const otherVehicle = await tx.vehicle.create({
      data: {
        ownerId: owner.id,
        plateNumber: vehicle.plateNumber.replace("W", "X"),
        type: "CAR",
      },
    });
    const lot = await tx.parkingLot.create({
      data: {
        name: `Week10 fixture ${runId}`,
        address: "CONTROLLED TEST FIXTURE",
        areas: {
          create: {
            code: "W10",
            name: `Week10 ${runId}`,
            spots: {
              create: ["A01", "A02", "A03", "A04"].map((code) => ({ code })),
            },
          },
        },
      },
      include: { areas: { include: { spots: { orderBy: { code: "asc" } } } } },
    });
    return {
      runId,
      cameraId: `week10-${runId}`,
      password,
      owner,
      admin,
      vehicle,
      otherVehicle,
      lotId: lot.id,
      areaId: lot.areas[0].id,
      spots: lot.areas[0].spots,
    };
  });
}

export type Week10Fixture = Awaited<ReturnType<typeof createWeek10Fixture>>;

export async function cleanupWeek10Fixture(
  db: PrismaClient,
  fixture: Week10Fixture,
) {
  // All predicates use the UUIDs from this run; no seed/development records.
  await db.$transaction(async (tx) => {
    await tx.visionAlert.deleteMany({ where: { cameraId: fixture.cameraId } });
    await tx.cameraObservation.deleteMany({
      where: { cameraId: fixture.cameraId },
    });
    await tx.auditLog.deleteMany({
      where: { actorId: { in: [fixture.owner.id, fixture.admin.id] } },
    });
    await tx.parkingSession.deleteMany({
      where: { spot: { area: { lotId: fixture.lotId } } },
    });
    await tx.reservation.deleteMany({
      where: { spot: { area: { lotId: fixture.lotId } } },
    });
    await tx.parkingLot.delete({ where: { id: fixture.lotId } });
    await tx.vehicle.deleteMany({
      where: { ownerId: { in: [fixture.owner.id, fixture.admin.id] } },
    });
    await tx.user.deleteMany({
      where: { id: { in: [fixture.owner.id, fixture.admin.id] } },
    });
  });
}
