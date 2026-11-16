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
import { gateRouter } from "./modules/gate/gate.routes.js";
import { publishRealtime } from "./realtime/events.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(rateLimit({ windowMs: 60_000, limit: env.HTTP_RATE_LIMIT_MAX }));
app.use((req, res, next) => {
  const path = req.originalUrl.split("?")[0];
  res.once("finish", () => {
    if (
      ["POST", "PATCH", "DELETE"].includes(req.method) &&
      res.statusCode >= 200 &&
      res.statusCode < 300 &&
      /^\/api\/(parking|reservations|sessions|vehicles|users)(\/|$)/.test(path)
    )
      publishRealtime("parking");
  });
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "smart-parking-api" });
});

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/vehicles", vehiclesRouter);
app.use("/api/parking", parkingRouter);
app.use("/api/reservations", reservationsRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/gate", gateRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { message: "Route not found" } });
});

app.use(errorHandler);
