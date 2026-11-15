import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, friendlyError } from "../api";
import type { ListResponse } from "../types";
import { useRealtimeRefresh, RealtimeStatus } from "../realtime";

type Observation = {
  id: string;
  cameraId: string;
  spotId: string;
  spot: { code: string };
  observedAt: string;
  occupancyStatus: string;
  recognitionStatus: string;
  plateRaw: string | null;
  plateNormalized: string | null;
  confidence: number;
  vehicleConfidence: number | null;
  plateDetectionConfidence: number | null;
  associationConfidence: number | null;
  ocrConfidence: number | null;
  plateSamples: number;
  matchStatus: string;
  matchReason: string;
  expectedPlate: string | null;
  metadata?: { plateMode?: string };
};

const labels: Record<string, string> = {
  MATCH: "Khớp đặt chỗ",
  MISMATCH: "Không khớp",
  NO_RESERVATION: "Không có đặt chỗ hiệu lực",
  INSUFFICIENT: "Chưa đủ thông tin",
  NOT_REQUESTED: "Chưa bật OCR",
  NO_VEHICLE: "Không phát hiện xe",
  UNREADABLE: "Chưa đọc rõ biển số",
  READ: "Đã đọc ổn định",
  CAMERA_LOST: "Mất tín hiệu camera",
  AMBIGUOUS: "Chưa xác định xe/ô",
  EMPTY: "Không phát hiện xe",
  OCCUPIED: "Có xe",
  UNKNOWN: "Chưa xác định",
};
const percent = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

const reasons: Record<string, string> = {
  legacy_observation: "Quan sát cũ chưa có OCR",
  occupancy_or_reading_unknown: "Chưa xác định rõ xe hoặc biển số",
  weak_or_unstable_evidence: "Độ tin cậy thấp hoặc chưa đủ mẫu ổn định",
  no_effective_reservation_at_observation:
    "Không có đặt chỗ hiệu lực tại lúc quan sát",
  multiple_effective_reservations:
    "Có nhiều đặt chỗ cùng hiệu lực, cần kiểm tra",
  reservation_plate_not_supported:
    "Biển số đặt chỗ chưa thuộc định dạng được hỗ trợ",
  plate_matches_reservation: "Biển số trùng với xe đã đặt đúng ô và thời gian",
  plate_differs_from_reservation: "Biển số khác xe đã đặt đúng ô và thời gian",
};

export function CameraObservations() {
  const [items, setItems] = useState<Observation[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState(true);
  const [cameraInput, setCameraInput] = useState("");
  const [cameraFilter, setCameraFilter] = useState("");
  const [newHistory, setNewHistory] = useState(false);
  const requestSequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const cameraQuery = cameraFilter
        ? `&cameraId=${encodeURIComponent(cameraFilter)}`
        : "";
      if (latest) {
        const data = await apiRequest<{ items: Observation[] }>(
          `/api/vision/observations/latest?${cameraQuery.slice(1)}`,
        );
        if (request !== requestSequence.current) return;
        setItems(data.items);
        setTotal(data.items.length);
      } else {
        const data = await apiRequest<ListResponse<Observation>>(
          `/api/vision/observations?page=${page}&pageSize=20${cameraQuery}`,
        );
        if (request !== requestSequence.current) return;
        setItems(data.items);
        setTotal(data.total);
      }
    } catch (cause) {
      if (request === requestSequence.current) setError(friendlyError(cause));
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, [page, latest, cameraFilter]);
  useEffect(() => {
    void load();
    return () => {
      requestSequence.current++;
    };
  }, [load]);
  const onVisionChange = useCallback(() => {
    if (latest) void load();
    else setNewHistory(true);
  }, [latest, load]);
  useRealtimeRefresh("vision", onVisionChange);
  return (
    <section className="panel camera-panel" aria-label="Lịch sử Camera AI">
      <div className="section-heading">
        <div>
          <h2>Camera AI · Biển số và đặt chỗ</h2>
          <RealtimeStatus />
          <p>
            Quan sát mới nhất tự cập nhật; lịch sử giữ nguyên trang đang xem.
          </p>
          <p>
            Không tự check-in/check-out. Không phát hiện xe chưa chứng minh ô
            trống; xe rời ô chưa chứng minh đã rời bãi.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => {
            setNewHistory(false);
            void load();
          }}
        >
          {loading ? "Đang tải…" : "Tải lại camera"}
        </button>
      </div>
      <div className="camera-pagination">
        <button
          className={latest ? "primary-button" : "secondary-button"}
          disabled={loading}
          onClick={() => {
            setLatest(true);
            setPage(1);
          }}
        >
          Mới nhất theo ô
        </button>
        <button
          className={!latest ? "primary-button" : "secondary-button"}
          disabled={loading}
          onClick={() => {
            setLatest(false);
            setPage(1);
          }}
        >
          Lịch sử
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setCameraFilter(cameraInput.trim());
          }}
        >
          <label>
            Camera{" "}
            <input
              aria-label="Lọc theo camera"
              value={cameraInput}
              placeholder="usb-parking-camera"
              onChange={(event) => setCameraInput(event.target.value)}
            />
          </label>
          <button className="secondary-button" disabled={loading} type="submit">
            Lọc
          </button>
        </form>
      </div>
      {error && <p role="alert">{error}</p>}
      {!latest && newHistory && (
        <p role="status">
          Có lịch sử nhận diện mới. Nhấn Tải lại camera để xem.
        </p>
      )}
      {!error && !loading && !items.length && (
        <p>Chưa có quan sát. Chạy Vision Service sau khi migrate database.</p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian / Camera</th>
              <th>Ô / Quan sát</th>
              <th>Biển camera đọc</th>
              <th>Biển đã đặt</th>
              <th>Độ tin cậy</th>
              <th>Đối chiếu</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  {new Date(item.observedAt).toLocaleString("vi-VN")}
                  {latest &&
                    Date.now() - new Date(item.observedAt).getTime() >
                      60_000 && <p>Quan sát cũ · kiểm tra camera và tải lại</p>}
                  <br />
                  {item.cameraId}
                </td>
                <td>
                  {item.spot.code}
                  <br />
                  {labels[item.occupancyStatus]}
                  <br />
                  {labels[item.recognitionStatus]}
                </td>
                <td>
                  <span style={{ whiteSpace: "pre-line" }}>
                    {item.plateRaw || "—"}
                  </span>
                  <br />
                  <strong>{item.plateNormalized || "—"}</strong>
                  {item.metadata?.plateMode === "manual" && (
                    <p>Vùng chọn thủ công · thử nghiệm</p>
                  )}
                </td>
                <td>
                  <strong>{item.expectedPlate || "—"}</strong>
                </td>
                <td>
                  Ô: {percent(item.confidence)}
                  <br />
                  Xe: {percent(item.vehicleConfidence)}
                  <br />
                  Vùng biển: {percent(item.plateDetectionConfidence)}
                  <br />
                  Gán ô: {percent(item.associationConfidence)}
                  <br />
                  OCR: {percent(item.ocrConfidence)} · {item.plateSamples} mẫu
                </td>
                <td>
                  <span
                    className={`status-badge ${item.matchStatus === "MATCH" ? "available" : item.matchStatus === "MISMATCH" ? "occupied" : "neutral"}`}
                  >
                    {labels[item.matchStatus]}
                  </span>
                  <br />
                  <small>
                    {reasons[item.matchReason] || "Cần kiểm tra thêm"}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!latest && (
        <div className="camera-pagination">
          <button
            className="secondary-button"
            disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            Trước
          </button>
          <span>
            Trang {page} · {total} quan sát
          </span>
          <button
            className="secondary-button"
            disabled={page * 20 >= total || loading}
            onClick={() => setPage(page + 1)}
          >
            Sau
          </button>
        </div>
      )}
    </section>
  );
}
