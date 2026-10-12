import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/http.js";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

type TokenPayload = { sub: string; email: string; role: UserRole };

export function signAccessToken(user: AuthUser) {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"],
  };
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    env.JWT_ACCESS_SECRET,
    options,
  );
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : undefined;
  if (!token) return next(new AppError(401, "Authentication required"));

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as TokenPayload;
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!user || !user.isActive)
      return next(new AppError(401, "Invalid account"));
    req.user = { id: user.id, email: user.email, role: user.role };
    return next();
  } catch {
    return next(new AppError(401, "Invalid token"));
  }
}

export function requireRole(role: UserRole) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError(401, "Authentication required"));
    if (req.user.role !== role)
      return next(new AppError(403, "Insufficient permission"));
    return next();
  };
}
