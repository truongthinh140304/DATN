import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CalendarCheck2,
  Camera,
  CarFront,
  CheckCircle2,
  CircleParking,
  Clock3,
  History,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Warehouse,
  X,
} from "lucide-react";
import { ApiError, apiRequest, friendlyError } from "../api";
import { useAuth } from "../auth";
import { AdminPanel } from "../components/AdminPanel";
import { GateMonitor } from "../components/GateMonitor";
import { SessionOperations } from "../components/SessionOperations";
import { RealtimeStatus, useRealtimeRefresh } from "../realtime";
import type {
  ListResponse,
  ParkingLot,
  ParkingSession,
  PaymentStatus,
  Reservation,
  User,
  Vehicle,
} from "../types";

type View = "overview" | "reservations" | "history" | "gate" | "admin";

const navItems: Array<{
  id: View;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", label: "Tổng quan", icon: LayoutDashboard },
  { id: "reservations", label: "Đặt chỗ & Xe", icon: CalendarCheck2 },
  { id: "history", label: "Lịch sử", icon: History },
];

const adminNavItems: Array<{
  id: View;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "gate", label: "Cổng & Barie", icon: Camera },
  { id: "admin", label: "Quản trị", icon: ShieldCheck },
];

function initialView(): View {
  const raw = new URLSearchParams(window.location.search).get("view");
  if (raw === "vehicles") return "reservations";
  if (raw === "sessions") return "gate";
  const allowed: View[] = [
    "overview",
    "reservations",
    "history",
    "gate",
    "admin",
  ];
  return raw && allowed.includes(raw as View) ? (raw as View) : "overview";
}

function normalizePlateInput(value: string) {
  return value.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

export function DashboardPage() {
  const { user, logout } = useAuth();
  const [view, setView] = useState<View>(initialView);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [lots, setLots] = useState<ParkingLot[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [sessions, setSessions] = useState<ParkingSession[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [preferredLotId, setPreferredLotId] = useState("");

  const handleExpiredSession = useCallback(() => {
    logout();
    window.history.replaceState({}, "", "/login");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, [logout]);

  const loadData = useCallback(
    async (options?: { background?: boolean }) => {
      if (!user) return;
      if (!options?.background) setLoading(true);
      setError("");
      try {
        const [lotData, vehicleData, reservationData, sessionData] =
          await Promise.all([
            apiRequest<ListResponse<ParkingLot>>(
              "/api/parking/lots?pageSize=100",
            ),
            apiRequest<ListResponse<Vehicle>>("/api/vehicles?pageSize=100"),
            apiRequest<ListResponse<Reservation>>(
              "/api/reservations?pageSize=100",
            ),
            apiRequest<ListResponse<ParkingSession>>(
              "/api/sessions?pageSize=100",
            ),
          ]);
        setLots(lotData.items);
        setVehicles(vehicleData.items);
        setReservations(reservationData.items);
        setSessions(sessionData.items);
        if (user.role === "ADMIN") {
          const userData = await apiRequest<ListResponse<User>>(
            "/api/users?pageSize=100",
          );
          setUsers(userData.items);
        }
        setUpdatedAt(new Date());
      } catch (requestError) {
        if (requestError instanceof ApiError && requestError.status === 401) {
          handleExpiredSession();
          return;
        }
        setError(friendlyError(requestError));
      } finally {
        setLoading(false);
      }
    },
    [handleExpiredSession, user],
  );

  const refreshInBackground = useCallback(
    () => loadData({ background: true }),
    [loadData],
  );

  const refreshParking = useCallback(() => {
    void refreshInBackground();
  }, [refreshInBackground]);

  useRealtimeRefresh("parking", refreshParking);
  useRealtimeRefresh("gate", refreshParking);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if ((view === "admin" || view === "gate") && user?.role !== "ADMIN") {
      setView("overview");
      window.history.replaceState({}, "", "/dashboard");
    }
  }, [user?.role, view]);

  function changeView(next: View) {
    if ((next === "admin" || next === "gate") && user?.role !== "ADMIN") {
      return;
    }
    setView(next);
    setMenuOpen(false);
    const url = next === "overview" ? "/dashboard" : `/dashboard?view=${next}`;
    window.history.pushState({}, "", url);
  }

  function handleLogout() {
    logout();
    window.history.replaceState({}, "", "/login");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  if (!user) return null;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">
            <CircleParking aria-hidden />
          </span>
          <span>Smart Parking</span>
          <button
            className="icon-button mobile-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Đóng menu"
          >
            <X />
          </button>
        </div>
        <nav className="main-nav" aria-label="Điều hướng chính">
          {navItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={view === item.id}
              onClick={() => changeView(item.id)}
            />
          ))}
          {user.role === "ADMIN" && (
            <>
              <div className="nav-divider" aria-hidden />
              {adminNavItems.map((item) => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={view === item.id}
                  onClick={() => changeView(item.id)}
                />
              ))}
            </>
          )}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{initials(user.fullName)}</span>
          <span>
            <strong>{user.fullName}</strong>
            <small>
              {user.role === "ADMIN" ? "Quản trị viên" : "Người dùng"}
            </small>
          </span>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="sidebar-scrim"
          onClick={() => setMenuOpen(false)}
          aria-label="Đóng menu"
        />
      )}

      <main className="dashboard-main">
        <header className="dashboard-header">
          <button
            className="icon-button menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Mở menu"
          >
            <Menu />
          </button>
          <div>
            <p className="header-greeting">Xin chào, {user.fullName}</p>
            <p className="header-meta">
              {user.role === "ADMIN" ? "Quản trị viên" : "Người dùng"}
              {updatedAt && <> · Cập nhật lúc {formatTime(updatedAt)}</>}
              <RealtimeStatus />
            </p>
          </div>
          <div className="header-actions">
            <button
              className="icon-button refresh-button"
              onClick={() => void loadData()}
              disabled={loading}
              aria-label="Tải lại dữ liệu"
              title="Tải lại dữ liệu"
            >
              <RefreshCw className={loading ? "spin" : ""} />
            </button>
            <button
              className="secondary-button logout-button"
              onClick={handleLogout}
            >
              <LogOut aria-hidden /> <span>Đăng xuất</span>
            </button>
          </div>
        </header>

        <div className="dashboard-content">
          {loading && <LoadingState />}
          {!loading && error && (
            <ErrorState message={error} onRetry={() => void loadData()} />
          )}
          {!loading && !error && view === "overview" && (
            <Overview
              lots={lots}
              reservations={reservations}
              sessions={sessions}
              onChanged={refreshInBackground}
              onReserveLot={(lotId) => {
                setPreferredLotId(lotId);
                changeView("reservations");
              }}
              onNavigate={changeView}
            />
          )}
          {!loading && !error && view === "reservations" && (
            <ReservationsView
              vehicles={vehicles}
              lots={lots}
              reservations={reservations}
              sessions={sessions}
              preferredLotId={preferredLotId}
              onChanged={refreshInBackground}
            />
          )}
          {!loading && !error && view === "history" && (
            <HistoryView reservations={reservations} sessions={sessions} />
          )}
          {!loading && !error && view === "gate" && user.role === "ADMIN" && (
            <div className="gate-stack">
              <GateMonitor lots={lots} onDataChanged={refreshInBackground} />
              <SessionOperations
                vehicles={vehicles}
                lots={lots}
                reservations={reservations}
                sessions={sessions}
                onChanged={refreshInBackground}
              />
            </div>
          )}
          {!loading && !error && view === "admin" && user.role === "ADMIN" && (
            <AdminPanel
              currentUserId={user.id}
              users={users}
              lots={lots}
              onChanged={refreshInBackground}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: { id: View; label: string; icon: typeof LayoutDashboard };
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      <Icon aria-hidden />
      <span>{item.label}</span>
    </button>
  );
}

function Overview({
  lots,
  reservations,
  sessions,
  onChanged,
  onReserveLot,
  onNavigate,
}: {
  lots: ParkingLot[];
  reservations: Reservation[];
  sessions: ParkingSession[];
  onChanged: () => Promise<void>;
  onReserveLot: (lotId: string) => void;
  onNavigate: (view: View) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const activeLots = lots.filter((lot) => lot.isActive);
  const totalCapacity = activeLots.reduce((sum, lot) => sum + lot.capacity, 0);
  const totalAvailable = activeLots.reduce(
    (sum, lot) => sum + lot.availableSlots,
    0,
  );
  const totalReserved = activeLots.reduce(
    (sum, lot) => sum + lot.activeReservations,
    0,
  );
  const totalSessions = activeLots.reduce(
    (sum, lot) => sum + lot.activeSessions,
    0,
  );
  const activeTickets = reservations
    .filter((item) => ["PENDING", "CONFIRMED"].includes(item.status))
    .slice(0, 4);
  const activeSessions = sessions.filter((item) => item.status === "ACTIVE");

  async function cancelTicket(id: string) {
    setBusy(true);
    setMessage("");
    try {
      await apiRequest(`/api/reservations/${id}/cancel`, { method: "POST" });
      await onChanged();
    } catch (error) {
      setMessage(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle
        title="Tổng quan bãi đỗ"
        description="Theo dõi số chỗ trống tại bãi xe và tình trạng vé đặt trước theo biển số."
      />
      <section className="stats-grid" aria-label="Thống kê bãi xe">
        <StatCard
          label="Chỗ còn trống"
          value={totalAvailable}
          icon={CheckCircle2}
          tone="available"
        />
        <StatCard
          label="Tổng sức chứa"
          value={totalCapacity}
          icon={Warehouse}
          tone="neutral"
        />
        <StatCard
          label="Đang giữ chỗ"
          value={totalReserved}
          icon={Clock3}
          tone="reserved"
        />
        <StatCard
          label="Xe đang gửi"
          value={totalSessions}
          icon={CarFront}
          tone="occupied"
        />
      </section>
      <div className="overview-grid">
        <section className="content-section">
          <SectionHeader
            title="Bãi xe & Sức chứa"
            action="Đặt chỗ ngay"
            onAction={() => onNavigate("reservations")}
          />
          {lots.length ? (
            <div className="lot-capacity-grid">
              {lots.map((lot) => {
                const ratio =
                  lot.capacity > 0
                    ? Math.min(
                        100,
                        Math.round((lot.usedSlots / lot.capacity) * 100),
                      )
                    : 0;
                const full = lot.availableSlots <= 0;
                return (
                  <article className="lot-capacity-card" key={lot.id}>
                    <div className="gate-card-head">
                      <strong>{lot.name}</strong>
                      <span
                        className={`status-badge ${
                          !lot.isActive
                            ? "inactive"
                            : full
                              ? "occupied"
                              : "available"
                        }`}
                      >
                        {!lot.isActive
                          ? "Ngừng hoạt động"
                          : full
                            ? "Hết chỗ"
                            : `Còn ${lot.availableSlots}/${lot.capacity} chỗ`}
                      </span>
                    </div>
                    <small className="muted-caption">{lot.address}</small>
                    <div
                      className="lot-progress-track"
                      aria-label={`Mức sử dụng ${ratio}%`}
                    >
                      <div
                        className="lot-progress-fill"
                        style={{ width: `${ratio}%` }}
                      />
                    </div>
                    <div className="lot-card-footer">
                      <small>
                        Đang gửi: {lot.activeSessions} · Đã đặt:{" "}
                        {lot.activeReservations}
                      </small>
                      {lot.isActive && !full && (
                        <button
                          className="spot-action"
                          type="button"
                          onClick={() => onReserveLot(lot.id)}
                        >
                          Đặt chỗ bãi này
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Warehouse}
              title="Chưa có bãi xe"
              description="Quản trị viên cần tạo bãi xe và cấu hình sức chứa trước khi đặt chỗ."
            />
          )}
        </section>
        <section className="content-section">
          <SectionHeader
            title="Vé & Xe đang hoạt động"
            action="Quản lý"
            onAction={() => onNavigate("reservations")}
          />
          {message && (
            <p className="form-message" role="status">
              {message}
            </p>
          )}
          {activeSessions.length > 0 || activeTickets.length > 0 ? (
            <div className="gate-stack">
              {activeSessions.length > 0 && (
                <ActiveSessionList sessions={activeSessions} />
              )}
              {activeTickets.length > 0 && (
                <ReservationList
                  reservations={activeTickets}
                  onCancel={cancelTicket}
                  busy={busy}
                />
              )}
            </div>
          ) : (
            <EmptyState
              icon={CalendarCheck2}
              title="Chưa có vé hoặc xe đang gửi"
              description="Vào mục “Đặt chỗ & Xe” để nhập biển số và đăng ký chỗ đậu trước khi tới cổng."
            />
          )}
        </section>
      </div>
    </>
  );
}

function ReservationsView({
  vehicles,
  lots,
  reservations,
  sessions,
  preferredLotId,
  onChanged,
}: {
  vehicles: Vehicle[];
  lots: ParkingLot[];
  reservations: Reservation[];
  sessions: ParkingSession[];
  preferredLotId: string;
  onChanged: () => Promise<void>;
}) {
  const activeVehicles = vehicles.filter((item) => item.isActive);
  const availableLots = lots.filter(
    (lot) => lot.isActive && lot.availableSlots > 0,
  );

  const [plateMode, setPlateMode] = useState<"saved" | "new">(
    activeVehicles.length > 0 ? "saved" : "new",
  );
  const [vehicleId, setVehicleId] = useState(activeVehicles[0]?.id ?? "");
  const [newPlate, setNewPlate] = useState("");
  const [newVehicleType, setNewVehicleType] = useState<Vehicle["type"]>("CAR");
  const [lotId, setLotId] = useState(
    availableLots.some((lot) => lot.id === preferredLotId)
      ? preferredLotId
      : (availableLots[0]?.id ?? ""),
  );
  const [durationHours, setDurationHours] = useState("2");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (
      preferredLotId &&
      lots.some(
        (lot) =>
          lot.id === preferredLotId && lot.isActive && lot.availableSlots > 0,
      )
    ) {
      setLotId(preferredLotId);
    }
  }, [preferredLotId, lots]);

  const effectivePlateMode = activeVehicles.length === 0 ? "new" : plateMode;
  const effectiveVehicleId = activeVehicles.some((v) => v.id === vehicleId)
    ? vehicleId
    : (activeVehicles[0]?.id ?? "");
  const effectiveLotId = availableLots.some((l) => l.id === lotId)
    ? lotId
    : availableLots.some((l) => l.id === preferredLotId)
      ? preferredLotId
      : (availableLots[0]?.id ?? "");

  const activeReservations = reservations.filter((item) =>
    ["PENDING", "CONFIRMED"].includes(item.status),
  );
  const activeSessions = sessions.filter((item) => item.status === "ACTIVE");

  async function resolveVehicleForBooking(): Promise<{
    id: string;
    createdOrUpdated: boolean;
  }> {
    if (effectivePlateMode === "saved") {
      if (!effectiveVehicleId) {
        throw new Error("Vui lòng chọn phương tiện hoặc nhập biển số mới.");
      }
      return { id: effectiveVehicleId, createdOrUpdated: false };
    }

    const cleanedPlate = newPlate.trim().toUpperCase();
    const normalized = normalizePlateInput(cleanedPlate);
    if (!/^[A-Z0-9]{4,15}$/.test(normalized)) {
      throw new Error(
        "Biển số xe phải gồm 4–15 ký tự chữ hoặc số (ví dụ: 30A-12345).",
      );
    }

    const existing = vehicles.find(
      (item) => normalizePlateInput(item.plateNumber) === normalized,
    );
    if (existing) {
      if (!existing.isActive) {
        await apiRequest(`/api/vehicles/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ isActive: true, type: newVehicleType }),
        });
        return { id: existing.id, createdOrUpdated: true };
      }
      return { id: existing.id, createdOrUpdated: false };
    }

    const created = await apiRequest<{ vehicle: Vehicle }>("/api/vehicles", {
      method: "POST",
      body: JSON.stringify({
        plateNumber: cleanedPlate,
        type: newVehicleType,
      }),
    });
    return { id: created.vehicle.id, createdOrUpdated: true };
  }

  async function reserve(event: FormEvent) {
    event.preventDefault();
    if (!effectiveLotId) {
      setMessage("Hiện chưa có bãi xe còn chỗ trống.");
      return;
    }
    setBusy(true);
    setMessage("");
    let shouldRefresh = false;
    try {
      const resolved = await resolveVehicleForBooking();
      shouldRefresh = resolved.createdOrUpdated;
      const startsAt = new Date();
      const expiresAt = new Date(
        startsAt.getTime() + Number(durationHours) * 60 * 60 * 1000,
      );
      await apiRequest("/api/reservations", {
        method: "POST",
        body: JSON.stringify({
          vehicleId: resolved.id,
          lotId: effectiveLotId,
          startsAt: startsAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        }),
      });
      setMessage(
        "Đặt chỗ thành công. Khi xe tới cổng, camera sẽ quét biển số và mở barie tự động.",
      );
      setNewPlate("");
      setVehicleId(resolved.id);
      setPlateMode("saved");
      await onChanged();
    } catch (error) {
      if (shouldRefresh) {
        await onChanged();
      }
      setMessage(
        error instanceof Error && !("status" in error)
          ? error.message
          : friendlyError(error),
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    setMessage("");
    try {
      await apiRequest(`/api/reservations/${id}/cancel`, { method: "POST" });
      await onChanged();
    } catch (error) {
      setMessage(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle
        title="Đặt chỗ & Xe của tôi"
        description="Nhập trực tiếp biển số hoặc chọn xe đã lưu để giữ chỗ. Camera tại cổng sẽ mở barie khi khớp biển số."
      />
      <div className="two-column-content">
        <section className="content-section">
          <h2>Đăng ký giữ chỗ mới</h2>
          <form className="inline-form" onSubmit={(e) => void reserve(e)}>
            {activeVehicles.length > 0 && (
              <div
                className="segmented-control"
                role="tablist"
                aria-label="Cách chọn biển số"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectivePlateMode === "saved"}
                  className={effectivePlateMode === "saved" ? "active" : ""}
                  onClick={() => setPlateMode("saved")}
                >
                  Chọn xe đã lưu ({activeVehicles.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectivePlateMode === "new"}
                  className={effectivePlateMode === "new" ? "active" : ""}
                  onClick={() => setPlateMode("new")}
                >
                  Nhập biển số mới
                </button>
              </div>
            )}

            {effectivePlateMode === "saved" ? (
              <Select
                label="Phương tiện (biển số)"
                value={effectiveVehicleId}
                onChange={setVehicleId}
                options={activeVehicles.map((vehicle) => ({
                  value: vehicle.id,
                  label: vehicle.plateNumber,
                }))}
                allLabel="Chọn phương tiện"
              />
            ) : (
              <div className="form-split">
                <label>
                  <span>Biển số xe</span>
                  <input
                    value={newPlate}
                    onChange={(event) =>
                      setNewPlate(event.target.value.toUpperCase())
                    }
                    placeholder="30A-12345"
                    required
                  />
                </label>
                <Select
                  label="Loại xe"
                  value={newVehicleType}
                  onChange={(value) =>
                    setNewVehicleType(value as Vehicle["type"])
                  }
                  hideEmpty
                  allLabel=""
                  options={[
                    { value: "CAR", label: "Ô tô" },
                    { value: "MOTORBIKE", label: "Xe máy" },
                    { value: "OTHER", label: "Khác" },
                  ]}
                />
              </div>
            )}

            <Select
              label="Bãi xe"
              value={effectiveLotId}
              onChange={setLotId}
              options={availableLots.map((lot) => ({
                value: lot.id,
                label: `${lot.name} (còn ${lot.availableSlots}/${lot.capacity} chỗ)`,
              }))}
              allLabel="Chọn bãi xe còn chỗ"
            />

            <Select
              label="Thời hạn giữ chỗ"
              value={durationHours}
              onChange={setDurationHours}
              hideEmpty
              allLabel=""
              options={[
                { value: "1", label: "1 giờ kể từ bây giờ" },
                { value: "2", label: "2 giờ kể từ bây giờ" },
                { value: "4", label: "4 giờ kể từ bây giờ" },
                { value: "8", label: "8 giờ kể từ bây giờ" },
                { value: "24", label: "24 giờ kể từ bây giờ" },
              ]}
            />

            <div className="payment-note-box">
              <strong>Thanh toán:</strong> Đang ở chế độ đặt trực tiếp (chưa cần
              thanh toán online) — vé được xác nhận ngay sau khi gửi.
            </div>

            {message && (
              <p className="form-message" role="status">
                {message}
              </p>
            )}

            <button
              className="primary-button"
              disabled={busy || !availableLots.length}
            >
              {busy ? <LoaderCircle className="spin" /> : <CalendarCheck2 />}{" "}
              Xác nhận đặt chỗ
            </button>
          </form>

          {!availableLots.length && (
            <p className="inline-hint">Hiện chưa có bãi xe còn chỗ trống.</p>
          )}
        </section>

        <section className="content-section">
          <div className="section-header">
            <h2>Vé &amp; Xe đang hoạt động</h2>
            {activeSessions.length > 0 && (
              <span className="status-badge occupied">
                {activeSessions.length} xe đang trong bãi
              </span>
            )}
          </div>
          {activeSessions.length > 0 || activeReservations.length > 0 ? (
            <div className="gate-stack">
              {activeSessions.length > 0 && (
                <ActiveSessionList sessions={activeSessions} />
              )}
              {activeReservations.length > 0 && (
                <ReservationList
                  reservations={activeReservations}
                  onCancel={cancel}
                  busy={busy}
                />
              )}
            </div>
          ) : (
            <EmptyState
              icon={CalendarCheck2}
              title="Không có vé hoặc xe đang hoạt động"
              description="Vé đặt mới hoặc xe vừa qua cổng sẽ hiển thị ngay tại đây."
            />
          )}
        </section>
      </div>

      <VehiclesSection vehicles={vehicles} onChanged={onChanged} />
    </>
  );
}

function VehiclesSection({
  vehicles,
  onChanged,
}: {
  vehicles: Vehicle[];
  onChanged: () => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [plateNumber, setPlateNumber] = useState("");
  const [type, setType] = useState<Vehicle["type"]>("CAR");
  const [brand, setBrand] = useState("");
  const [color, setColor] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function editVehicle(vehicle: Vehicle) {
    setEditingId(vehicle.id);
    setPlateNumber(vehicle.plateNumber);
    setType(vehicle.type);
    setBrand(vehicle.brand ?? "");
    setColor(vehicle.color ?? "");
    setMessage("");
    setShowForm(true);
  }

  function resetForm() {
    setEditingId(null);
    setPlateNumber("");
    setType("CAR");
    setBrand("");
    setColor("");
  }

  async function saveVehicle(event: FormEvent) {
    event.preventDefault();
    if (normalizePlateInput(plateNumber).length < 4) {
      setMessage("Biển số cần ít nhất 4 ký tự chữ hoặc số.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await apiRequest(
        editingId ? `/api/vehicles/${editingId}` : "/api/vehicles",
        {
          method: editingId ? "PATCH" : "POST",
          body: JSON.stringify({
            plateNumber: plateNumber.trim().toUpperCase(),
            type,
            brand: brand.trim() || undefined,
            color: color.trim() || undefined,
          }),
        },
      );
      setMessage(
        editingId ? "Đã cập nhật phương tiện." : "Đã thêm phương tiện.",
      );
      resetForm();
      setShowForm(false);
      await onChanged();
    } catch (error) {
      setMessage(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content-section reservation-history-section">
      <div className="section-header">
        <div>
          <h2>Xe đã lưu ({vehicles.length})</h2>
          <small className="muted-caption">
            Biển số đã đăng ký để đặt chỗ nhanh hơn cho các lần sau.
          </small>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            if (showForm && editingId) resetForm();
            setShowForm((value) => !value);
            setMessage("");
          }}
        >
          {showForm ? <X aria-hidden /> : <Plus aria-hidden />}
          {showForm ? "Đóng form" : "Thêm xe"}
        </button>
      </div>

      {message && !showForm && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}

      {showForm && (
        <form
          className="inline-form vehicle-inline-form"
          onSubmit={(e) => void saveVehicle(e)}
        >
          <div className="form-split">
            <label>
              <span>Biển số xe</span>
              <input
                value={plateNumber}
                onChange={(event) =>
                  setPlateNumber(event.target.value.toUpperCase())
                }
                placeholder="30A-12345"
              />
            </label>
            <Select
              label="Loại xe"
              value={type}
              onChange={(value) => setType(value as Vehicle["type"])}
              hideEmpty
              options={[
                { value: "CAR", label: "Ô tô" },
                { value: "MOTORBIKE", label: "Xe máy" },
                { value: "OTHER", label: "Khác" },
              ]}
              allLabel=""
            />
          </div>
          <div className="form-split">
            <label>
              <span>Hãng xe (không bắt buộc)</span>
              <input
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
                placeholder="Toyota"
              />
            </label>
            <label>
              <span>Màu sắc (không bắt buộc)</span>
              <input
                value={color}
                onChange={(event) => setColor(event.target.value)}
                placeholder="Trắng"
              />
            </label>
          </div>
          {message && <p className="form-message">{message}</p>}
          <div className="form-actions">
            <button className="primary-button" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" />
              ) : editingId ? (
                <Pencil />
              ) : (
                <Plus />
              )}
              {editingId ? "Lưu thay đổi" : "Thêm phương tiện"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
            >
              Hủy
            </button>
          </div>
        </form>
      )}

      {vehicles.length ? (
        <div className="vehicle-list">
          {vehicles.map((vehicle) => (
            <div className="vehicle-row" key={vehicle.id}>
              <span className="vehicle-icon">
                <CarFront />
              </span>
              <span>
                <strong>{vehicle.plateNumber}</strong>
                <small>
                  {vehicleTypeLabel(vehicle.type)}
                  {vehicle.brand ? ` · ${vehicle.brand}` : ""}
                  {vehicle.color ? ` · ${vehicle.color}` : ""}
                </small>
              </span>
              <span
                className={`status-badge ${vehicle.isActive ? "available" : "inactive"}`}
              >
                {vehicle.isActive ? "Hoạt động" : "Ngừng"}
              </span>
              <button
                className="icon-button"
                type="button"
                onClick={() => editVehicle(vehicle)}
                aria-label={`Chỉnh sửa ${vehicle.plateNumber}`}
                title="Chỉnh sửa"
              >
                <Pencil />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={CarFront}
          title="Chưa có xe đã lưu"
          description="Khi bạn nhập biển số đặt chỗ ở trên, xe sẽ tự động được lưu tại đây."
        />
      )}
    </section>
  );
}

function HistoryView({
  reservations,
  sessions,
}: {
  reservations: Reservation[];
  sessions: ParkingSession[];
}) {
  const reservationHistory = reservations.filter(
    (item) => !["PENDING", "CONFIRMED"].includes(item.status),
  );

  return (
    <>
      <PageTitle
        title="Lịch sử gửi xe & Đặt chỗ"
        description="Theo dõi các phiên xe vào/ra bãi và những vé đặt trước đã xử lý."
      />
      <section className="content-section">
        <SectionHeader title="Phiên gửi xe" />
        {sessions.length ? (
          <div className="history-list">
            {sessions.map((session) => (
              <div className="history-row" key={session.id}>
                <span
                  className={`timeline-dot ${session.status === "ACTIVE" ? "active" : ""}`}
                />
                <span>
                  <strong>{session.vehicle.plateNumber}</strong>
                  <small>{session.lot.name}</small>
                </span>
                <span>
                  <strong>Vào: {formatDateTime(session.checkedInAt)}</strong>
                  <small>
                    {session.checkedOutAt
                      ? `Ra lúc ${formatDateTime(session.checkedOutAt)}`
                      : "Đang gửi trong bãi"}
                  </small>
                </span>
                <span
                  className={`status-badge ${session.status === "ACTIVE" ? "occupied" : "neutral"}`}
                >
                  {session.status === "ACTIVE" ? "Đang gửi" : "Đã hoàn tất"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={History}
            title="Chưa có lịch sử gửi xe"
            description="Dữ liệu xuất hiện sau khi xe qua cổng tự động hoặc được check-in."
          />
        )}
      </section>

      <section className="content-section reservation-history-section">
        <SectionHeader title="Lịch sử đặt chỗ" />
        {reservationHistory.length ? (
          <ReservationList reservations={reservationHistory} />
        ) : (
          <EmptyState
            icon={CalendarCheck2}
            title="Chưa có lịch sử đặt chỗ"
            description="Các vé đã sử dụng, đã hủy hoặc hết hạn sẽ hiển thị tại đây."
          />
        )}
      </section>
    </>
  );
}

function ActiveSessionList({ sessions }: { sessions: ParkingSession[] }) {
  return (
    <div className="reservation-list">
      {sessions.map((session) => (
        <div className="reservation-row" key={session.id}>
          <span className="vehicle-icon">
            <CarFront />
          </span>
          <span>
            <strong>
              {session.vehicle.plateNumber} · {session.lot.name}
            </strong>
            <small>Vào bãi lúc {formatDateTime(session.checkedInAt)}</small>
          </span>
          <span>
            <span className="status-badge occupied">Đang trong bãi</span>
            <small>Tự mở barie khi xe ra</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function ReservationList({
  reservations,
  onCancel,
  busy,
}: {
  reservations: Reservation[];
  onCancel?: (id: string) => void;
  busy?: boolean;
}) {
  return (
    <div className="reservation-list">
      {reservations.map((reservation) => (
        <div className="reservation-row" key={reservation.id}>
          <span className="reservation-icon">
            <CalendarCheck2 />
          </span>
          <span>
            <strong>
              {reservation.vehicle.plateNumber} · {reservation.lot.name}
            </strong>
            <small>
              {paymentStatusLabel(reservation.paymentStatus)} · Bắt đầu{" "}
              {formatDateTime(reservation.startsAt)}
            </small>
          </span>
          <span>
            <strong>{reservationStatusLabel(reservation.status)}</strong>
            <small>Hết hạn {formatDateTime(reservation.expiresAt)}</small>
          </span>
          {onCancel &&
            ["PENDING", "CONFIRMED"].includes(reservation.status) && (
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() => onCancel(reservation.id)}
              >
                Hủy
              </button>
            )}
        </div>
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof CircleParking;
  tone: string;
}) {
  return (
    <article className="stat-card">
      <span className={`stat-icon ${tone}`}>
        <Icon />
      </span>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </article>
  );
}

function PageTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="page-title">
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}

function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {action && (
        <button className="text-button" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  allLabel,
  hideEmpty = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
  hideEmpty?: boolean;
}) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {!hideEmpty && <option value="">{allLabel}</option>}
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof CircleParking;
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <Icon aria-hidden />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state">
      <LoaderCircle className="spin" />
      <strong>Đang tải dữ liệu</strong>
      <span>Vui lòng chờ trong giây lát.</span>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="error-state">
      <RefreshCw />
      <strong>Không thể tải dữ liệu</strong>
      <p>{message}</p>
      <button className="primary-button" onClick={onRetry}>
        <RefreshCw /> Thử lại
      </button>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function vehicleTypeLabel(type: Vehicle["type"]) {
  return { CAR: "Ô tô", MOTORBIKE: "Xe máy", OTHER: "Khác" }[type];
}

function paymentStatusLabel(status: PaymentStatus) {
  return {
    NOT_REQUIRED: "Chưa bật thu phí",
    UNPAID: "Chờ thanh toán",
    PAID: "Đã thanh toán",
  }[status];
}

function reservationStatusLabel(status: Reservation["status"]) {
  return {
    PENDING: "Đang chờ",
    CONFIRMED: "Đã xác nhận",
    CANCELLED: "Đã hủy",
    EXPIRED: "Hết hạn",
    CHECKED_IN: "Đã vào bãi",
    COMPLETED: "Hoàn tất",
  }[status];
}
