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
});

export const env = schema.parse(process.env);
