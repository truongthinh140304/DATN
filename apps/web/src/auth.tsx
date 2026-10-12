import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ApiError,
  apiRequest,
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from "./api";
import type { User } from "./types";

type Credentials = { email: string; password: string };
type Registration = Credentials & { fullName: string };

type AuthContextValue = {
  user: User | null;
  checkingSession: boolean;
  login: (credentials: Credentials) => Promise<void>;
  register: (details: Registration) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(
    Boolean(getAccessToken()),
  );

  const logout = useCallback(() => {
    clearAccessToken();
    setUser(null);
  }, []);

  useEffect(() => {
    if (!getAccessToken()) return;
    apiRequest<{ user: User }>("/api/auth/me")
      .then((result) => setUser(result.user))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) logout();
      })
      .finally(() => setCheckingSession(false));
  }, [logout]);

  useEffect(() => {
    window.addEventListener("auth:expired", logout);
    return () => window.removeEventListener("auth:expired", logout);
  }, [logout]);
  const login = useCallback(async (credentials: Credentials) => {
    const result = await apiRequest<{ user: User; accessToken: string }>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify(credentials) },
    );
    setAccessToken(result.accessToken);
    const profile = await apiRequest<{ user: User }>("/api/auth/me");
    setUser(profile.user);
  }, []);

  const register = useCallback(async (details: Registration) => {
    const result = await apiRequest<{ user: User; accessToken: string }>(
      "/api/auth/register",
      { method: "POST", body: JSON.stringify(details) },
    );
    setAccessToken(result.accessToken);
    const profile = await apiRequest<{ user: User }>("/api/auth/me");
    setUser(profile.user);
  }, []);

  const value = useMemo(
    () => ({ user, checkingSession, login, register, logout }),
    [user, checkingSession, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
