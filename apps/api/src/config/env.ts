import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(20),
  JWT_ACCESS_EXPIRES_IN: z.string().default("1d"),
  VISION_API_KEY: z.string().min(20).default("change_me_vision_service_key"),
  HTTP_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(120),
  GATE_REENTRY_COOLDOWN_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(3600)
    .default(15),
  GATE_OCR_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.65),
  GATE_MIN_PLATE_SAMPLES: z.coerce.number().int().min(1).max(20).default(2),
});

export const env = schema.parse(process.env);
