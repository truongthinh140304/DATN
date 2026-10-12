import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

export async function auditLog(input: {
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: unknown;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  await db.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata:
        input.metadata === undefined ? undefined : (input.metadata as object),
    },
  });
}
