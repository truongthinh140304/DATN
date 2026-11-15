import { EventEmitter } from "node:events";

export type RealtimeScope = "vision" | "parking" | "alerts";
export const realtimeEvents = new EventEmitter();

// Deliberately send invalidations only: personal/recognition data still goes
// through the authenticated, role-filtered REST endpoints after every commit.
export function publishRealtime(scope: RealtimeScope) {
  realtimeEvents.emit("change", { scope, at: new Date().toISOString() });
}
