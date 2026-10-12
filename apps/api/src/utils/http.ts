import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next);
  };

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof AppError) {
    return res
      .status(error.statusCode)
      .json({ error: { message: error.message, details: error.details } });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      error: { message: "Invalid request", details: error.flatten() },
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return res.status(409).json({
        error: {
          message: "Unique constraint violation",
          details: error.meta,
        },
      });
    }
    if (error.code === "P2025") {
      return res.status(404).json({ error: { message: "Record not found" } });
    }
  }

  console.error(error);
  return res.status(500).json({ error: { message: "Internal server error" } });
}

export function pagination(query: Record<string, unknown>) {
  const page = Math.max(Number(query.page ?? 1), 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize ?? 20), 1), 100);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
