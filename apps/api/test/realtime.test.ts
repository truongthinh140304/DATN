import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import jwt from "jsonwebtoken";
import { io as client, type Socket } from "socket.io-client";

const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }));
vi.mock("../src/config/prisma.js", () => ({ prisma: db }));
import { env } from "../src/config/env.js";
import { attachRealtime } from "../src/realtime/server.js";
import { publishRealtime } from "../src/realtime/events.js";

const http = createServer();
const io = attachRealtime(http);
const sockets: Socket[] = [];
let url = "";
function next(socket: Socket, event: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No ${event} event`)),
      4000,
    );
    socket.once(event, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}
function connect(token?: string, origin = env.WEB_ORIGIN) {
  const socket = client(url, {
    transports: ["websocket"],
    auth: { token },
    extraHeaders: { Origin: origin },
    reconnection: false,
    autoConnect: false,
    forceNew: true,
  });
  sockets.push(socket);
  return socket;
}
const token = () =>
  jwt.sign({ sub: "socket-user" }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
beforeAll(async () => {
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.disconnect();
});
afterAll(async () => {
  await new Promise<void>((resolve) => io.close(() => resolve()));
});

describe("authenticated WebSocket updates", () => {
  it("rejects missing, invalid and expired tokens", async () => {
    for (const value of [
      undefined,
      "bad",
      jwt.sign({ sub: "socket-user", exp: 1 }, env.JWT_ACCESS_SECRET),
    ]) {
      const socket = connect(value);
      const failed = next(socket, "connect_error");
      socket.connect();
      expect(await failed).toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    }
  });
  it("rejects inactive users and foreign browser origins", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "socket-user",
      isActive: false,
    });
    const inactive = connect(token());
    const failed = next(inactive, "connect_error");
    inactive.connect();
    expect(await failed).toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    db.user.findUnique.mockResolvedValue({ id: "socket-user", isActive: true });
    const foreign = connect(token(), "https://untrusted.example");
    const blocked = next(foreign, "connect_error");
    foreign.connect();
    expect(await blocked).toBeInstanceOf(Error);
  });
  it("delivers only invalidations over websocket and reconnects with valid auth", async () => {
    db.user.findUnique.mockResolvedValue({ id: "socket-user", isActive: true });
    const socket = connect(token());
    const connected = next(socket, "connect");
    socket.connect();
    await connected;
    expect(socket.io.engine.transport.name).toBe("websocket");
    for (const scope of ["vision", "parking", "alerts"] as const) {
      const incoming = next(socket, "data:changed");
      publishRealtime(scope);
      expect(await incoming).toEqual({ scope, at: expect.any(String) });
    }
    socket.disconnect();
    const reconnected = next(socket, "connect");
    socket.connect();
    await reconnected;
    const incoming = next(socket, "data:changed");
    publishRealtime("vision");
    expect(await incoming).toMatchObject({ scope: "vision" });
  });
  it("disconnects an already connected socket when its JWT expires", async () => {
    db.user.findUnique.mockResolvedValue({ id: "socket-user", isActive: true });
    const expiring = jwt.sign(
      { sub: "socket-user", exp: Math.floor(Date.now() / 1000) + 2 },
      env.JWT_ACCESS_SECRET,
    );
    const socket = connect(expiring);
    const connected = next(socket, "connect");
    socket.connect();
    await connected;
    const expired = next(socket, "auth:expired");
    const disconnected = next(socket, "disconnect");
    await expired;
    await disconnected;
    expect(socket.connected).toBe(false);
  });
});
