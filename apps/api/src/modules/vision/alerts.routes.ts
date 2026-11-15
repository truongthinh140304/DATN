import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { AppError, asyncHandler, pagination } from "../../utils/http.js";
import { listQuery, uuidParam } from "../../utils/schemas.js";
import { publishRealtime } from "../../realtime/events.js";

export const alertsRouter = Router();
alertsRouter.use(requireAuth, requireRole("ADMIN"));
alertsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuery
      .extend({
        status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "ALL"]).optional(),
        cameraId: z.string().trim().optional(),
      })
      .parse(req.query);
    const page = pagination(query);
    const where = {
      ...(query.status === "ALL"
        ? {}
        : {
            status: query.status ? query.status : { not: "RESOLVED" as const },
          }),
      ...(query.cameraId ? { cameraId: query.cameraId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.visionAlert.findMany({
        where,
        include: { spot: { select: { id: true, code: true } } },
        orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
        skip: page.skip,
        take: page.take,
      }),
      prisma.visionAlert.count({ where }),
    ]);
    res.json({ items, total, page: page.page, pageSize: page.pageSize });
  }),
);
alertsRouter.post(
  "/:id/acknowledge",
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const alert = await prisma.$transaction(async (tx) => {
      const current = await tx.visionAlert.findUniqueOrThrow({ where: { id } });
      if (current.status === "RESOLVED")
        throw new AppError(409, "Alert is already resolved");
      const changed = await tx.visionAlert.updateMany({
        where: { id, status: "OPEN" },
        data: {
          status: "ACKNOWLEDGED",
          acknowledgedAt: new Date(),
          acknowledgedBy: req.user!.id,
        },
      });
      if (changed.count)
        await tx.auditLog.create({
          data: {
            actorId: req.user!.id,
            action: "VISION_ALERT_ACKNOWLEDGED",
            entityType: "VisionAlert",
            entityId: id,
          },
        });
      return tx.visionAlert.findUniqueOrThrow({ where: { id } });
    });
    publishRealtime("alerts");
    res.json({ alert });
  }),
);
