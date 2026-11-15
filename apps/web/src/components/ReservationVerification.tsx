import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, friendlyError } from "../api";
import { RealtimeStatus, useRealtimeRefresh } from "../realtime";
import type { Reservation } from "../types";

type Verification = {
  reservationId: string;
  spotCode: string;
  expectedPlate: string;
  matchStatus: string;
  reason: string;
  observation: null | {
    observedAt: string;
    recognitionStatus: string;
    plateNormalized: string | null;
    plateHidden: boolean;
    ocrConfidence: number | null;
    plateSamples: number;
  };
};
const reasons: Record<string, string> = {
  waiting_for_camera: "Đang chờ camera quan sát xe tại đúng ô đã đặt.",
  reservation_not_effective:
    "Lượt đặt chưa bắt đầu, đã hết hạn hoặc đã kết thúc.",
  camera_observation_stale:
    "Camera chưa cập nhật trong hơn 60 giây. Chưa thể xác nhận xe hiện tại.",
  occupancy_or_reading_unknown:
    "Chưa thấy xe, chưa đọc rõ biển số hoặc chưa xác định đúng ô.",
  weak_or_unstable_evidence:
    "Đang chờ biển số rõ hơn và đủ ít nhất 3 mẫu ổn định.",
  plate_matches_reservation:
    "Biển camera đọc trùng với xe đã đặt tại đúng ô và thời gian.",
  plate_differs_from_reservation:
    "Biển camera đọc khác biển đã đặt tại ô này. Cần quản trị viên kiểm tra.",
  multiple_effective_reservations:
    "Có nhiều lượt đặt cùng hiệu lực. Cần quản trị viên kiểm tra.",
};

export function ReservationVerification({
  reservations,
}: {
  reservations: Reservation[];
}) {
  const [selected, setSelected] = useState("");
  const id = reservations.some((item) => item.id === selected)
    ? selected
    : reservations[0]?.id || "";
  const [data, setData] = useState<Verification | null>(null);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    if (!id) {
      setData(null);
      return;
    }
    try {
      const value = await apiRequest<Verification>(
        `/api/reservations/${id}/verification`,
      );
      if (request === sequence.current) {
        setData(value);
        setError("");
      }
    } catch (cause) {
      if (request === sequence.current) {
        setError(friendlyError(cause));
        setData(null);
      }
    }
  }, [id]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      sequence.current++;
      window.clearInterval(timer);
    };
  }, [load]);
  const refresh = useCallback(() => {
    void load();
  }, [load]);
  useRealtimeRefresh("vision", refresh);
  useRealtimeRefresh("parking", refresh);
  const current = data?.reservationId === id ? data : null;
  return (
    <section
      className="content-section verification-panel"
      aria-label="Xác minh xe đã đặt"
    >
      <div className="section-heading">
        <div>
          <h2>Xác minh xe đã đặt</h2>
          <RealtimeStatus />
        </div>
        <button
          className="secondary-button"
          onClick={() => void load()}
          disabled={!id}
        >
          Tải lại xác minh
        </button>
      </div>
      {reservations.length ? (
        <label className="select-field">
          <span>Lượt đặt cần xác minh</span>
          <select
            value={id}
            onChange={(event) => {
              setSelected(event.target.value);
              setError("");
            }}
          >
            {reservations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.spot.code} · {item.vehicle.plateNumber}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>
          Hãy đặt chỗ với phương tiện của bạn để theo dõi đối chiếu biển số.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {current && (
        <>
          <div className="verification-comparison">
            <div>
              <small>Ô đã đặt</small>
              <strong>{current.spotCode}</strong>
            </div>
            <div>
              <small>Biển đã đặt</small>
              <strong>{current.expectedPlate}</strong>
            </div>
            <div>
              <small>Biển camera đọc</small>
              <strong>
                {current.observation?.plateNormalized ||
                  (current.observation?.plateHidden
                    ? "Đã ẩn biển khác"
                    : "Chưa đọc rõ")}
              </strong>
            </div>
          </div>
          <p
            role="status"
            className={`verification-result verification-${current.matchStatus.toLowerCase()}`}
          >
            {current.matchStatus === "MATCH"
              ? "Khớp đặt chỗ — đúng xe, đúng ô"
              : current.matchStatus === "MISMATCH"
                ? "Không khớp biển số đã đặt"
                : "Chưa đủ thông tin để xác nhận"}
          </p>
          <p>
            {reasons[current.reason] ||
              "Chưa thể đối chiếu. Cần kiểm tra camera và lượt đặt."}
          </p>
          {current.observation && (
            <p>
              Quan sát:{" "}
              {new Date(current.observation.observedAt).toLocaleString("vi-VN")}{" "}
              · OCR:{" "}
              {current.observation.ocrConfidence === null
                ? "—"
                : `${Math.round(current.observation.ocrConfidence * 100)}%`}{" "}
              · {current.observation.plateSamples} mẫu
            </p>
          )}
        </>
      )}
      <p className="inline-hint">
        Kết quả do backend đối chiếu. Khớp biển số không tự check-in/check-out.
      </p>
    </section>
  );
}
