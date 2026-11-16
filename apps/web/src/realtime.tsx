import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { io } from "socket.io-client";
import { API_BASE_URL, getAccessToken } from "./api";
import { useAuth } from "./auth";

type Scope = "gate" | "parking";
const initial = { gate: 0, parking: 0 };
const Context = createContext({ status: "offline", revision: initial });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const token = getAccessToken();
  const [status, setStatus] = useState("offline");
  const [revision, setRevision] = useState(initial);
  useEffect(() => {
    if (!user || !token) {
      setStatus("offline");
      setRevision(initial);
      return;
    }
    setStatus("connecting");
    const socket = io(API_BASE_URL, {
      transports: ["websocket"],
      auth: { token },
      reconnection: true,
      reconnectionDelayMax: 5000,
    });
    socket.on("connect", () => {
      setStatus("connected");
      // Every reconnect refetches REST snapshots; missed events are not replayed.
      setRevision((value) => ({
        gate: value.gate + 1,
        parking: value.parking + 1,
      }));
    });
    socket.on("disconnect", () => setStatus("offline"));
    socket.on("connect_error", (error) => {
      setStatus("offline");
      if (
        (error as Error & { data?: { code?: string } }).data?.code ===
        "UNAUTHENTICATED"
      )
        window.dispatchEvent(new Event("auth:expired"));
    });
    socket.on("auth:expired", () =>
      window.dispatchEvent(new Event("auth:expired")),
    );
    socket.on("data:changed", (event: { scope?: Scope }) => {
      if (event.scope && ["gate", "parking"].includes(event.scope))
        setRevision((value) => ({
          ...value,
          [event.scope!]: value[event.scope!] + 1,
        }));
    });
    return () => {
      socket.disconnect();
    };
  }, [user?.id, token]);
  return (
    <Context.Provider value={{ status, revision }}>{children}</Context.Provider>
  );
}

export function useRealtimeRefresh(scope: Scope, refresh: () => void) {
  const value = useContext(Context).revision[scope];
  useEffect(() => {
    if (!value) return;
    const timer = window.setTimeout(refresh, 300);
    return () => window.clearTimeout(timer);
  }, [value, refresh]);
}

export function RealtimeStatus() {
  const { status } = useContext(Context);
  return (
    <span className={`realtime-badge ${status}`} role="status">
      {status === "connected"
        ? "● Trực tiếp"
        : status === "connecting"
          ? "Đang kết nối trực tiếp…"
          : "Mất kết nối trực tiếp · có thể tải lại"}
    </span>
  );
}
