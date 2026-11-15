import type { Server as HttpServer } from "node:http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { realtimeEvents } from "./events.js";

export function attachRealtime(server: HttpServer) {
  const io = new Server(server, {
    transports: ["websocket"],
    maxHttpBufferSize: 16_384,
    cors: { origin: env.WEB_ORIGIN },
    allowRequest: (req, callback) =>
      callback(
        null,
        !req.headers.origin || req.headers.origin === env.WEB_ORIGIN,
      ),
  });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (typeof token !== "string") throw new Error("Missing token");
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
      if (
        typeof payload === "string" ||
        typeof payload.sub !== "string" ||
        typeof payload.exp !== "number"
      )
        throw new Error("Invalid token");
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, isActive: true },
      });
      if (!user?.isActive) throw new Error("Inactive user");
      socket.data.expiresAt = payload.exp * 1000;
      next();
    } catch {
      next(
        Object.assign(new Error("Authentication required"), {
          data: { code: "UNAUTHENTICATED" },
        }),
      );
    }
  });
  io.on("connection", (socket) => {
    // JWT expiry applies to long-lived connections too, not only the handshake.
    const expire = () => {
      socket.emit("auth:expired");
      socket.disconnect(true);
    };
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const remaining = socket.data.expiresAt - Date.now();
      if (remaining <= 0) {
        expire();
        return;
      }
      timer = setTimeout(schedule, Math.min(2_147_483_647, remaining));
      timer.unref();
    };
    schedule();
    socket.on("disconnect", () => clearTimeout(timer));
  });
  const send = (event: { scope: string; at: string }) =>
    io.emit("data:changed", event);
  realtimeEvents.on("change", send);
  server.once("close", () => realtimeEvents.off("change", send));
  return io;
}
