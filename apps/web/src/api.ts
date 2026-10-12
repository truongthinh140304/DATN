const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const TOKEN_KEY = "smart-parking.access-token";

type ApiErrorBody = {
  error?: {
    message?: string;
    details?: unknown;
  };
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function getAccessToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearAccessToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(
      0,
      "Không thể kết nối máy chủ. Hãy kiểm tra API và thử lại.",
    );
  }

  const body = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/auth/login") {
      window.dispatchEvent(new Event("auth:expired"));
    }
    throw new ApiError(
      response.status,
      body.error?.message ?? "Yêu cầu không thể hoàn tất.",
      body.error?.details,
    );
  }
  return body;
}

export function friendlyError(error: unknown) {
  if (!(error instanceof ApiError))
    return "Đã có lỗi xảy ra. Vui lòng thử lại.";
  if (error.status === 401) return "Email hoặc mật khẩu không chính xác.";
  if (error.status === 409)
    return "Thông tin đã tồn tại hoặc vị trí không còn trống.";
  if (error.status === 400)
    return "Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.";
  return error.message;
}
