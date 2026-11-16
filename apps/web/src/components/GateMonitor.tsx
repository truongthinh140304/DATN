import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest, friendlyError } from "../api";
import { RealtimeStatus, useRealtimeRefresh } from "../realtime";
import type {
  GateEvent,
  GateStatusResponse,
  ListResponse,
  ParkingLot,
} from "../types";

type Props = {
  lots: ParkingLot[];
  onDataChanged?: () => Promise<void>;
};

const directionLabels: Record<GateEvent["direction"], string> = {
  ENTRY: "Xe vào",
  EXIT: "Xe ra",
  UNKNOWN: "Thủ công / Khác",
};

const decisionLabels: Record<GateEvent["decision"], string> = {
  ALLOW: "Cho qua",
  DENY: "Từ chối",
  COOLDOWN: "Chờ chống lặp",
};

const reasonLabels: Record<string, string> = {
  valid_reservation_entry: "Khớp vé đặt trước — mở barie cho xe vào",
  active_session_exit: "Xe đang gửi trong bãi — mở barie cho xe ra",
  no_valid_reservation: "Xe chưa có vé đặt chỗ còn hiệu lực",
  reservation_not_started: "Vé đặt chỗ chưa tới giờ hiệu lực",
  reservation_not_confirmed: "Vé đặt chỗ chưa được xác nhận",
  reservation_expired: "Vé đặt chỗ đã hết hạn",
  vehicle_not_registered: "Biển số chưa được đăng ký trong hệ thống",
  vehicle_inactive: "Phương tiện hoặc tài khoản đang bị khóa",
  payment_required: "Vé đặt chỗ chưa hoàn tất thanh toán",
  lot_inactive: "Bãi xe đã ngừng hoạt động",
  wrong_lot: "Xe đang đặt hoặc gửi ở bãi xe khác",
  reentry_cooldown: "Xe vừa qua cổng (trong thời gian chống lặp lại)",
  invalid_plate_format: "Biển số chưa đúng định dạng biển xe hợp lệ",
  weak_ocr_evidence: "Độ tin cậy OCR thấp hoặc chưa đủ mẫu ổn định",
  reservation_state_conflict:
    "Trạng thái đặt chỗ vừa thay đổi, vui lòng thử lại",
  session_state_conflict: "Phiên gửi xe vừa thay đổi, vui lòng thử lại",
  manual_override: "Mở barie thủ công bởi quản trị viên",
};

function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN");
}

function formatConfidence(value?: number | null) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}

export function GateMonitor({ lots, onDataChanged }: Props) {
  const [status, setStatus] = useState<GateStatusResponse | null>(null);
  const [events, setEvents] = useState<GateEvent[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [decisionFilter, setDecisionFilter] = useState<"" | "ALLOW" | "DENY">(
    "",
  );
  const [gateId, setGateId] = useState("main-gate-01");
  const [lotId, setLotId] = useState(lots[0]?.id ?? "");
  const [reason, setReason] = useState("Kiểm tra / mở cổng khẩn cấp");
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (!lotId && lots.length > 0) setLotId(lots[0].id);
  }, [lotId, lots]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const decisionQuery = decisionFilter
        ? `&decision=${encodeURIComponent(decisionFilter)}`
        : "";
      const [statusData, eventsData] = await Promise.all([
        apiRequest<GateStatusResponse>("/api/gate/status"),
        apiRequest<ListResponse<GateEvent>>(
          `/api/gate/events?page=${page}&pageSize=15${decisionQuery}`,
        ),
      ]);
      setStatus(statusData);
      setEvents(eventsData.items);
      setTotal(eventsData.total);
      if (
        statusData.gates.length > 0 &&
        !statusData.gates.some((g) => g.gateId === gateId)
      ) {
        setGateId(statusData.gates[0].gateId);
      }
      setError("");
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setLoading(false);
    }
  }, [page, decisionFilter, gateId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefresh("gate", load);

  async function manualOpen(event: FormEvent) {
    event.preventDefault();
    setOpening(true);
    setError("");
    setFeedback("");
    try {
      await apiRequest("/api/gate/manual-open", {
        method: "POST",
        body: JSON.stringify({
          gateId: gateId.trim() || "main-gate-01",
          lotId: lotId || undefined,
          durationMs: 5000,
          reason: reason.trim() || "manual_override",
        }),
      });
      setFeedback(
        "Đã gửi lệnh mở barie (5 giây). Tiến trình cổng sẽ thực thi ngay.",
      );
      await load();
      if (onDataChanged) await onDataChanged();
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setOpening(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 15));

  return (
    <section className="gate-stack" aria-label="Giám sát cổng và barie">
      <div className="page-title">
        <h1>Cổng &amp; Barie tự động</h1>
        <p>
          Theo dõi kết nối Webcam và Arduino Uno R3, điều khiển barie thủ công
          và xem nhật ký quét biển số realtime.
        </p>
      </div>

      <div className="content-section">
        <div className="section-header">
          <div>
            <h2>Trạng thái phần cứng &amp; Mở cổng</h2>
            {status && (
              <small className="muted-caption">
                Lệnh barie đang chờ thực thi: {status.pendingCommands}
              </small>
            )}
          </div>
          <RealtimeStatus />
        </div>

        {error && (
          <p className="form-alert gate-alert" role="alert">
            {error}
          </p>
        )}
        {feedback && (
          <p className="admin-message gate-alert" role="status">
            {feedback}
          </p>
        )}

        <div className="gate-hardware-grid">
          {status?.gates.length ? (
            status.gates.map((gate) => (
              <div className="gate-hardware-card" key={gate.gateId}>
                <div className="gate-card-head">
                  <strong>Cổng: {gate.gateId}</strong>
                  <span
                    className={`status-badge ${
                      gate.cameraConnected ? "available" : "inactive"
                    }`}
                  >
                    Camera: {gate.cameraConnected ? "Đang bật" : "Mất tín hiệu"}
                  </span>
                  <span
                    className={`status-badge ${
                      gate.arduinoConnected ? "available" : "occupied"
                    }`}
                  >
                    Arduino:{" "}
                    {gate.arduinoConnected
                      ? `Đã nối${gate.arduinoPort ? ` (${gate.arduinoPort})` : ""}`
                      : "Chế độ mô phỏng / chưa nối"}
                  </span>
                </div>
                <small className="muted-caption">
                  Nhịp cuối: {formatTime(gate.lastHeartbeatAt)} · Quét gần nhất:{" "}
                  {formatTime(gate.lastScanAt)}
                  {gate.lastPlate ? ` · Biển số: ${gate.lastPlate}` : ""}
                </small>
              </div>
            ))
          ) : (
            <div className="gate-hardware-card">
              <strong>Chưa nhận tín hiệu từ tiến trình cổng Python</strong>
              <small className="muted-caption">
                Chạy <code>npm run gate:run</code> trên laptop kết nối Webcam
                &amp; Arduino Uno R3 để kích hoạt cổng tự động.
              </small>
            </div>
          )}
        </div>

        <form className="gate-manual-form" onSubmit={(e) => void manualOpen(e)}>
          <label>
            <span>Mã cổng</span>
            <input
              value={gateId}
              onChange={(e) => setGateId(e.target.value)}
              placeholder="main-gate-01"
            />
          </label>
          <label>
            <span>Bãi xe</span>
            <select value={lotId} onChange={(e) => setLotId(e.target.value)}>
              <option value="">Tất cả / Mặc định</option>
              {lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.name} ({lot.availableSlots}/{lot.capacity} trống)
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Ghi chú mở cổng</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Lý do mở barie thủ công"
            />
          </label>
          <button className="primary-button" type="submit" disabled={opening}>
            {opening ? "Đang gửi lệnh…" : "Mở barie thủ công (5s)"}
          </button>
        </form>
      </div>

      <div className="content-section">
        <div className="section-header gate-events-header">
          <div>
            <h2>Nhật ký quét biển số tại cổng</h2>
            <small className="muted-caption">{total} sự kiện đã ghi nhận</small>
          </div>
          <div className="gate-toolbar">
            <select
              aria-label="Lọc kết quả quét cổng"
              value={decisionFilter}
              onChange={(e) => {
                setDecisionFilter(e.target.value as "" | "ALLOW" | "DENY");
                setPage(1);
              }}
            >
              <option value="">Tất cả lượt quét</option>
              <option value="ALLOW">Chỉ lượt cho qua</option>
              <option value="DENY">Chỉ lượt bị từ chối</option>
            </select>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? "Đang tải…" : "Làm mới"}
            </button>
          </div>
        </div>

        {!events.length ? (
          <p className="muted-caption">Chưa có sự kiện nào tại cổng.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Thời gian / Cổng</th>
                  <th>Biển số &amp; OCR</th>
                  <th>Hướng &amp; Quyết định</th>
                  <th>Chi tiết xử lý</th>
                </tr>
              </thead>
              <tbody>
                {events.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{formatTime(item.occurredAt)}</strong>
                      <small className="cell-subline">
                        {item.gateId}
                        {item.lot ? ` · ${item.lot.name}` : ""}
                      </small>
                    </td>
                    <td>
                      <span className="plate-chip">
                        {item.plateNormalized || item.plateRaw || "—"}
                      </span>
                      {item.plateRaw &&
                      item.plateNormalized &&
                      item.plateRaw !== item.plateNormalized ? (
                        <small className="cell-subline">
                          Raw: {item.plateRaw}
                        </small>
                      ) : null}
                      <small className="cell-subline">
                        OCR: {formatConfidence(item.ocrConfidence)} · Mẫu:{" "}
                        {item.plateSamples ?? "—"}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`status-badge ${
                          item.decision === "ALLOW"
                            ? "available"
                            : item.decision === "DENY"
                              ? "occupied"
                              : "neutral"
                        }`}
                      >
                        {decisionLabels[item.decision]}
                      </span>
                      <small className="cell-subline">
                        {directionLabels[item.direction]} ·{" "}
                        {item.barrierAction === "OPEN"
                          ? "Mở barie"
                          : "Giữ đóng"}
                      </small>
                    </td>
                    <td>
                      <span>{reasonLabels[item.reason] ?? item.reason}</span>
                      <small className="cell-subline">
                        Nguồn:{" "}
                        {item.source === "MANUAL" ? "Thủ công" : "Camera"}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="gate-pagination">
            <button
              className="secondary-button"
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Trang trước
            </button>
            <span className="muted-caption">
              Trang {page} / {totalPages} ({total} sự kiện)
            </span>
            <button
              className="secondary-button"
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Trang sau
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
