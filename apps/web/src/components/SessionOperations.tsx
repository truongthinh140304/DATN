import { useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { apiRequest, friendlyError } from "../api";
import type {
  ParkingLot,
  ParkingSession,
  Reservation,
  Vehicle,
} from "../types";

type Props = {
  vehicles: Vehicle[];
  lots: ParkingLot[];
  reservations: Reservation[];
  sessions: ParkingSession[];
  onChanged: () => Promise<void>;
};

export function SessionOperations({
  vehicles,
  lots,
  reservations,
  sessions,
  onChanged,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState("reservation");
  const [reservationId, setReservationId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [lotId, setLotId] = useState("");
  const [confirmedExit, setConfirmedExit] = useState<Record<string, boolean>>(
    {},
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const now = Date.now();
  const validReservations = reservations.filter(
    (item) =>
      item.status === "CONFIRMED" &&
      new Date(item.startsAt).getTime() <= now &&
      now < new Date(item.expiresAt).getTime(),
  );
  const activeSessions = sessions.filter((item) => item.status === "ACTIVE");

  async function checkIn(event: FormEvent) {
    event.preventDefault();
    setBusy("in");
    setError("");
    setSuccess("");
    try {
      const reservation = validReservations.find(
        (item) => item.id === reservationId,
      );
      if (mode === "reservation" && !reservation) {
        throw new Error("Chọn đặt chỗ đang có hiệu lực.");
      }
      const body =
        reservation && mode === "reservation"
          ? {
              reservationId: reservation.id,
              vehicleId: reservation.vehicle.id,
              lotId: reservation.lot.id,
            }
          : { vehicleId, lotId };
      await apiRequest("/api/sessions/check-in", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSuccess("Đã xác nhận xe vào bãi.");
      setReservationId("");
      setLotId("");
      await onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error && !("status" in cause)
          ? cause.message
          : friendlyError(cause),
      );
    } finally {
      setBusy("");
    }
  }

  async function checkOut(session: ParkingSession) {
    if (!confirmedExit[session.id]) return;
    setBusy(session.id);
    setError("");
    setSuccess("");
    try {
      await apiRequest(`/api/sessions/${session.id}/check-out`, {
        method: "POST",
      });
      setSuccess(`Đã xác nhận xe ${session.vehicle.plateNumber} ra khỏi bãi.`);
      await onChanged();
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy("");
    }
  }

  return (
    <section
      className="content-section backup-ops-section"
      aria-label="Xác nhận xe vào và ra bãi thủ công"
    >
      <div className="section-header">
        <div>
          <h2>Dự phòng vào / ra thủ công</h2>
          <small className="muted-caption">
            Chỉ dùng khi cần check-in / check-out tay lúc camera hoặc barie bảo
            trì ({activeSessions.length} xe đang gửi).
          </small>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          {expanded ? "Thu gọn" : "Mở thao tác thủ công"}
        </button>
      </div>

      {expanded && (
        <div className="backup-ops-body">
          {error && (
            <p className="form-alert" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="admin-message" role="status">
              {success}
            </p>
          )}

          <div className="two-column-content">
            <form
              className="inline-form"
              onSubmit={(event) => void checkIn(event)}
            >
              <h3 className="subcard-title">Xác nhận xe vào</h3>
              <label className="select-field">
                <span>Hình thức</span>
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value)}
                >
                  <option value="reservation">Theo vé đặt chỗ trước</option>
                  <option value="walkin">Vào trực tiếp chưa đặt chỗ</option>
                </select>
              </label>

              {mode === "reservation" ? (
                <label className="select-field">
                  <span>Đặt chỗ hiệu lực</span>
                  <select
                    required
                    value={reservationId}
                    onChange={(event) => setReservationId(event.target.value)}
                  >
                    <option value="">Chọn vé đặt chỗ</option>
                    {validReservations.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.vehicle.plateNumber} · {item.lot.name} · đến{" "}
                        {new Date(item.expiresAt).toLocaleString("vi-VN")}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="select-field">
                    <span>Phương tiện</span>
                    <select
                      required
                      value={vehicleId}
                      onChange={(event) => setVehicleId(event.target.value)}
                    >
                      <option value="">Chọn xe</option>
                      {vehicles
                        .filter((item) => item.isActive)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.plateNumber}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="select-field">
                    <span>Bãi xe còn chỗ</span>
                    <select
                      required
                      value={lotId}
                      onChange={(event) => setLotId(event.target.value)}
                    >
                      <option value="">Chọn bãi xe</option>
                      {lots
                        .filter(
                          (item) => item.isActive && item.availableSlots > 0,
                        )
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} (còn {item.availableSlots}/
                            {item.capacity} chỗ)
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              )}

              <button
                className="primary-button"
                type="submit"
                disabled={Boolean(busy)}
              >
                {busy === "in" ? "Đang lưu…" : "Xác nhận xe đã vào bãi"}
              </button>
            </form>

            <div>
              <h3 className="subcard-title">Xe đang gửi trong bãi</h3>
              {!activeSessions.length ? (
                <p className="muted-caption">
                  Không có phiên gửi xe đang hoạt động.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Biển số / Bãi xe</th>
                        <th>Giờ vào</th>
                        <th>Xác nhận ra bãi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeSessions.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <span className="plate-chip">
                              {item.vehicle.plateNumber}
                            </span>
                            <small className="cell-subline">
                              {item.lot.name}
                            </small>
                          </td>
                          <td>
                            {new Date(item.checkedInAt).toLocaleString("vi-VN")}
                          </td>
                          <td>
                            <div className="checkout-cell">
                              <label className="status-toggle">
                                <input
                                  type="checkbox"
                                  checked={Boolean(confirmedExit[item.id])}
                                  onChange={(event) =>
                                    setConfirmedExit((value) => ({
                                      ...value,
                                      [item.id]: event.target.checked,
                                    }))
                                  }
                                />
                                <span>Xe đã rời bãi</span>
                              </label>
                              <button
                                className="secondary-button"
                                type="button"
                                disabled={
                                  !confirmedExit[item.id] || Boolean(busy)
                                }
                                onClick={() => void checkOut(item)}
                              >
                                {busy === item.id
                                  ? "Đang lưu…"
                                  : "Xác nhận check-out"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
