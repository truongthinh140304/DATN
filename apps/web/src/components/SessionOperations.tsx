import { useState, type FormEvent } from "react";
import { apiRequest, friendlyError } from "../api";
import type {
  ParkingSession,
  ParkingSpot,
  Reservation,
  Vehicle,
} from "../types";

type Props = {
  vehicles: Vehicle[];
  spots: ParkingSpot[];
  reservations: Reservation[];
  sessions: ParkingSession[];
  onChanged: () => Promise<void>;
};

export function SessionOperations({
  vehicles,
  spots,
  reservations,
  sessions,
  onChanged,
}: Props) {
  const [mode, setMode] = useState("reservation");
  const [reservationId, setReservationId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [spotId, setSpotId] = useState("");
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
      if (mode === "reservation" && !reservation)
        throw new Error("Chọn đặt chỗ đang có hiệu lực.");
      const body =
        reservation && mode === "reservation"
          ? {
              reservationId: reservation.id,
              vehicleId: reservation.vehicle.id,
              spotId: reservation.spot.id,
            }
          : { vehicleId, spotId };
      await apiRequest("/api/sessions/check-in", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSuccess("Đã xác nhận xe vào bãi.");
      setReservationId("");
      setSpotId("");
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
      className="panel camera-panel"
      aria-label="Xác nhận xe vào và ra bãi"
    >
      <h1>Xe vào / ra bãi</h1>
      <p>
        Chỉ xác nhận sau khi kiểm tra xe thực tế. Xe mất khỏi vùng camera chưa
        chứng minh đã rời bãi.
      </p>
      {error && <p role="alert">{error}</p>}
      {success && <p role="status">{success}</p>}
      <form className="session-form" onSubmit={(event) => void checkIn(event)}>
        <h2>Xác nhận xe vào</h2>
        <label>
          Hình thức
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="reservation">Có đặt chỗ</option>
            <option value="walkin">Vào trực tiếp, chưa đặt chỗ</option>
          </select>
        </label>
        {mode === "reservation" ? (
          <label>
            Đặt chỗ hiệu lực
            <select
              required
              value={reservationId}
              onChange={(event) => setReservationId(event.target.value)}
            >
              <option value="">Chọn đặt chỗ</option>
              {validReservations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.vehicle.plateNumber} · {item.spot.area?.code}/
                  {item.spot.code} · đến{" "}
                  {new Date(item.expiresAt).toLocaleString("vi-VN")}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              Phương tiện
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
            <label>
              Ô đỗ trống
              <select
                required
                value={spotId}
                onChange={(event) => setSpotId(event.target.value)}
              >
                <option value="">Chọn ô</option>
                {spots
                  .filter(
                    (item) => item.isActive && item.status === "AVAILABLE",
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.area?.code}/{item.code}
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
      <h2>Xe đang gửi</h2>
      {!activeSessions.length && (
        <p>Không có phiên gửi xe đang hoạt động trong danh sách.</p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Biển số / Ô</th>
              <th>Giờ vào</th>
              <th>Xác nhận ra bãi</th>
            </tr>
          </thead>
          <tbody>
            {activeSessions.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.vehicle.plateNumber} · {item.spot.code}
                </td>
                <td>{new Date(item.checkedInAt).toLocaleString("vi-VN")}</td>
                <td>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(confirmedExit[item.id])}
                      onChange={(event) =>
                        setConfirmedExit((value) => ({
                          ...value,
                          [item.id]: event.target.checked,
                        }))
                      }
                    />{" "}
                    Đã kiểm tra xe thực sự rời bãi
                  </label>
                  <br />
                  <button
                    className="secondary-button"
                    disabled={!confirmedExit[item.id] || Boolean(busy)}
                    onClick={() => void checkOut(item)}
                  >
                    {busy === item.id ? "Đang lưu…" : "Xác nhận check-out"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
