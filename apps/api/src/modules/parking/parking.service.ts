import type { Prisma } from "@prisma/client";
import { AppError } from "../../utils/http.js";

export async function expireStaleReservations(
  tx: Prisma.TransactionClient,
  now: Date,
  where: Prisma.ReservationWhereInput = {},
) {
  await tx.reservation.updateMany({
    where: {
      ...where,
      status: { in: ["PENDING", "CONFIRMED"] },
      expiresAt: { lte: now },
    },
    data: { status: "EXPIRED" },
  });
}

export async function lockParkingLot(
  tx: Prisma.TransactionClient,
  lotId: string,
) {
  const rows = await tx.$queryRaw<
    Array<{ id: string; capacity: number; is_active: boolean }>
  >`SELECT id, capacity, is_active FROM parking_lots WHERE id = ${lotId}::uuid FOR UPDATE`;
  const lot = rows[0];
  if (!lot) {
    throw new AppError(404, "Parking lot not found");
  }
  return {
    id: lot.id,
    capacity: lot.capacity,
    isActive: lot.is_active,
  };
}

export async function getLotUsage(
  tx: Prisma.TransactionClient,
  lotId: string,
  capacity: number,
  now: Date,
) {
  const [activeReservations, activeSessions] = await Promise.all([
    tx.reservation.count({
      where: {
        lotId,
        status: { in: ["PENDING", "CONFIRMED"] },
        expiresAt: { gt: now },
      },
    }),
    tx.parkingSession.count({
      where: {
        lotId,
        status: "ACTIVE",
      },
    }),
  ]);
  const usedSlots = activeReservations + activeSessions;
  return {
    activeReservations,
    activeSessions,
    usedSlots,
    availableSlots: Math.max(0, capacity - usedSlots),
  };
}
