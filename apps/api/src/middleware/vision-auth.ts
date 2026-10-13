import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { AppError } from "../utils/http.js";

export function requireVisionApiKey(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const provided = req.header("x-vision-api-key");
  if (!provided) return next(new AppError(401, "Vision API key required"));

  const actualBuffer = Buffer.from(env.VISION_API_KEY);
  const providedBuffer = Buffer.from(provided);
  if (
    actualBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(actualBuffer, providedBuffer)
  ) {
    return next(new AppError(401, "Invalid vision API key"));
  }

  return next();
}
