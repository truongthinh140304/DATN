import { useCallback, useEffect, useState } from "react";
import { apiRequest, friendlyError } from "../api";
import { useRealtimeRefresh } from "../realtime";
import type { ListResponse } from "../types";

type Alert = {
  id: string;
  type: string;
  status: string;
  cameraId: string;
  spot: { code: string };
  expectedSpotCode: string | null;
  plateNormalized: string;
  expectedPlate: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
};
const kinds: Record<string, string> = {
  WRONG_SPOT: "Xe ở sai ô",
  PLATE_MISMATCH: "Biển số khác đặt chỗ",
  UNRESERVED_VEHICLE: "Xe chưa có đặt chỗ hoặc phiên gửi xe hợp lệ",
};
const statuses: Record<string, string> = {
  OPEN: "Cần kiểm tra",
  ACKNOWLEDGED: "Đã tiếp nhận",
  RESOLVED: "Đã hết cảnh báo",
};

export function VisionAlerts() {
  const [items, setItems] = useState<Alert[]>([]);
  const [history, setHistory] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try {
      const data = await apiRequest<ListResponse<Alert>>(
        `/api/vision/alerts?page=${page}&pageSize=20${history ? "&status=ALL" : ""}`,
      );
      setItems(data.items);
      setTotal(data.total);
      setError("");
    } catch (cause) {
      setError(friendlyError(cause));
    }
  }, [page, history]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtimeRefresh("alerts", load);
  async function acknowledge(id: string) {
    setBusy(id);
    try {
      await apiRequest(`/api/vision/alerts/${id}/acknowledge`, {
        method: "POST",
      });
      await load();
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel camera-panel" aria-label="Cảnh báo vị trí đỗ">
      <h2>Cảnh báo vị trí đỗ</h2>
      <p>
        Chỉ cảnh báo từ biển số đã đọc ổn định và gán ô rõ ràng. Cảnh báo không
        tự thay đổi phiên gửi xe.
      </p>
      <div className="camera-pagination">
        <button
          className="secondary-button"
          onClick={() => {
            setHistory(!history);
            setPage(1);
          }}
        >
          {history
            ? "Xem cảnh báo đang hoạt động"
            : "Xem toàn bộ lịch sử cảnh báo"}
        </button>
        <button className="secondary-button" onClick={() => void load()}>
          Tải lại cảnh báo
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!items.length && !error && <p>Không có cảnh báo trong danh sách này.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Cảnh báo / Trạng thái</th>
              <th>Xe / Vị trí</th>
              <th>Thời gian</th>
              <th>Xử lý</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className={`alert-${item.status.toLowerCase()}`}
              >
                <td>
                  <strong>{kinds[item.type]}</strong>
                  <br />
                  {statuses[item.status]}
                  <br />
                  <small>{item.cameraId}</small>
                </td>
                <td>
                  {item.plateNormalized}
                  <br />Ô quan sát: {item.spot.code}
                  {item.expectedSpotCode && (
                    <>
                      <br />Ô dự kiến: {item.expectedSpotCode}
                    </>
                  )}
                  {item.expectedPlate && (
                    <>
                      <br />
                      Biển đặt chỗ: {item.expectedPlate}
                    </>
                  )}
                </td>
                <td>
                  Lần đầu: {new Date(item.firstSeenAt).toLocaleString("vi-VN")}
                  <br />
                  Gần nhất: {new Date(item.lastSeenAt).toLocaleString("vi-VN")}
                  <br />
                  {item.occurrences} lần quan sát
                </td>
                <td>
                  {item.status === "OPEN" && (
                    <button
                      className="secondary-button"
                      disabled={Boolean(busy)}
                      onClick={() => void acknowledge(item.id)}
                    >
                      {busy === item.id ? "Đang lưu…" : "Đã tiếp nhận"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="camera-pagination">
        <button
          className="secondary-button"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Trước
        </button>
        <span>
          Trang {page} · {total} cảnh báo
        </span>
        <button
          className="secondary-button"
          disabled={page * 20 >= total}
          onClick={() => setPage(page + 1)}
        >
          Sau
        </button>
      </div>
    </section>
  );
}
