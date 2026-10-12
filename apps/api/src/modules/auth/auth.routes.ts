import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { requireAuth, signAccessToken } from "../../middleware/auth.js";
import { AppError, asyncHandler } from "../../utils/http.js";
import { auditLog } from "../audit/audit.service.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(100),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional(),
});

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1),
});

const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, 12);
    const { password: _password, ...userData } = body;
    const user = await prisma.user.create({
      data: { ...userData, passwordHash, role: "USER" },
      select: publicUserSelect,
    });
    await auditLog({
      actorId: user.id,
      action: "AUTH_REGISTER",
      entityType: "User",
      entityId: user.id,
    });
    return res.status(201).json({ user, accessToken: signAccessToken(user) });
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !user.isActive) throw new AppError(401, "Invalid credentials");
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw new AppError(401, "Invalid credentials");
    const publicUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
    };
    return res.json({ user: publicUser, accessToken: signAccessToken(user) });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: publicUserSelect,
    });
    return res.json({ user });
  }),
);
