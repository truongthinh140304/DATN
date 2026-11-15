export const API_BASE_URL =
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
  const businessMessages: Record<string, string> = {
    "Cannot create an already expired reservation":
      "Thời gian kết thúc đặt chỗ phải còn hiệu lực.",
    "Reservation is not valid for check-in":
      "Đặt chỗ chưa tới giờ, đã hết hạn hoặc không còn hiệu lực để check-in.",
    "Vehicle is inactive": "Phương tiện đã ngừng hoạt động.",
    "Parking location is inactive": "Ô đỗ, khu hoặc bãi xe đã ngừng hoạt động.",
    "Vehicle or spot has an active reservation; select the reservation":
      "Xe hoặc ô đã có đặt chỗ; hãy chọn lượt đặt tương ứng.",
    "Session is already completed": "Phiên gửi xe đã được check-out.",
    "Session has already changed":
      "Phiên gửi xe vừa thay đổi. Vui lòng tải lại.",
    "Reservation has already changed":
      "Đặt chỗ vừa được xử lý ở phiên khác. Vui lòng tải lại.",
  };
  if (businessMessages[error.message]) return businessMessages[error.message];
  if (error.status === 409)
    return "Thông tin đã tồn tại hoặc vị trí không còn trống.";
  if (error.status === 400)
    return "Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.";
  return error.message;
}
