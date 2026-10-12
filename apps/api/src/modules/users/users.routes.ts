import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { AppError, asyncHandler, pagination } from "../../utils/http.js";
import { listQuery, uuidParam } from "../../utils/schemas.js";

export const usersRouter = Router();

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const createUserSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(100),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional(),
  role: z.enum(["USER", "ADMIN"]).default("USER"),
  isActive: z.boolean().default(true),
});

const updateUserSchema = createUserSchema
  .omit({ password: true })
  .partial()
  .extend({
    password: z.string().min(8).max(100).optional(),
  });

usersRouter.use(requireAuth, requireRole("ADMIN"));

usersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuery.parse(req.query);
    const page = pagination(query);
    const where = query.q
      ? {
          OR: [
            { email: { contains: query.q, mode: "insensitive" as const } },
            { fullName: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: userSelect,
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where }),
    ]);
    return res.json({ items, page: page.page, pageSize: page.pageSize, total });
  }),
);

usersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createUserSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, 12);
    const { password: _password, ...userData } = body;
    const user = await prisma.user.create({
      data: { ...userData, passwordHash },
      select: userSelect,
    });
    return res.status(201).json({ user });
  }),
);

usersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    if (id === req.user!.id && req.body.role && req.body.role !== "ADMIN") {
      throw new AppError(400, "Admin cannot demote own account");
    }
    const body = updateUserSchema.parse(req.body);
    const passwordHash = body.password
      ? await bcrypt.hash(body.password, 12)
      : undefined;
    const { password: _password, ...userData } = body;
    const user = await prisma.user.update({
      where: { id },
      data: { ...userData, ...(passwordHash ? { passwordHash } : {}) },
      select: userSelect,
    });
    return res.json({ user });
  }),
);
