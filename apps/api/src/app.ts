import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { errorHandler } from "./utils/http.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { vehiclesRouter } from "./modules/vehicles/vehicles.routes.js";
import { parkingRouter } from "./modules/parking/parking.routes.js";
import { reservationsRouter } from "./modules/reservations/reservations.routes.js";
import { sessionsRouter } from "./modules/sessions/sessions.routes.js";
import { visionRouter } from "./modules/vision/vision.routes.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(rateLimit({ windowMs: 60_000, limit: 120 }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "smart-parking-api" });
});

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/vehicles", vehiclesRouter);
app.use("/api/parking", parkingRouter);
app.use("/api/reservations", reservationsRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/vision", visionRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { message: "Route not found" } });
});

app.use(errorHandler);
