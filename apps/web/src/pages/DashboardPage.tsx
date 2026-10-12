import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CalendarCheck2,
  CarFront,
  CheckCircle2,
  CircleParking,
  Clock3,
  History,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MapPinned,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { ApiError, apiRequest, friendlyError } from "../api";
import { useAuth } from "../auth";
import { AdminPanel } from "../components/AdminPanel";
import type {
  ListResponse,
  ParkingArea,
  ParkingLot,
  ParkingSession,
  ParkingSpot,
  Reservation,
  SpotStatus,
  User,
  Vehicle,
} from "../types";

type View =
  "overview" | "spots" | "reservations" | "vehicles" | "history" | "admin";

const statusMeta: Record<SpotStatus, { label: string; className: string }> = {
  AVAILABLE: { label: "Trống", className: "available" },
  RESERVED: { label: "Đã đặt", className: "reserved" },
  OCCUPIED: { label: "Đang có xe", className: "occupied" },
  INACTIVE: { label: "Ngừng hoạt động", className: "inactive" },
};

const navItems: Array<{
  id: View;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", label: "Tổng quan", icon: LayoutDashboard },
  { id: "spots", label: "Vị trí đỗ", icon: CircleParking },
  { id: "reservations", label: "Đặt chỗ", icon: CalendarCheck2 },
  { id: "vehicles", label: "Phương tiện", icon: CarFront },
  { id: "history", label: "Lịch sử", icon: History },
];

function initialView(): View {
  const value = new URLSearchParams(window.location.search).get(
    "view",
  ) as View | null;
  return value && [...navItems.map((item) => item.id), "admin"].includes(value)
    ? value
    : "overview";
}

export function DashboardPage() {
  const { user, logout } = useAuth();
  const [view, setView] = useState<View>(initialView);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [lots, setLots] = useState<ParkingLot[]>([]);
  const [areas, setAreas] = useState<ParkingArea[]>([]);
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [sessions, setSessions] = useState<ParkingSession[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [preferredSpotId, setPreferredSpotId] = useState("");

  const handleExpiredSession = useCallback(() => {
    logout();
    window.history.replaceState({}, "", "/login");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, [logout]);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const requests = [
        apiRequest<ListResponse<ParkingLot>>("/api/parking/lots?pageSize=100"),
        apiRequest<ListResponse<ParkingArea>>(
          "/api/parking/areas?pageSize=100",
        ),
        apiRequest<ListResponse<ParkingSpot>>(
          "/api/parking/spots?pageSize=100",
        ),
        apiRequest<ListResponse<Vehicle>>("/api/vehicles?pageSize=100"),
        apiRequest<ListResponse<Reservation>>("/api/reservations?pageSize=100"),
        apiRequest<ListResponse<ParkingSession>>("/api/sessions?pageSize=100"),
      ] as const;
      const [
        lotData,
        areaData,
        spotData,
        vehicleData,
        reservationData,
        sessionData,
      ] = await Promise.all(requests);
      setLots(lotData.items);
      setAreas(areaData.items);
      setSpots(spotData.items);
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
  }, [handleExpiredSession, user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (view === "admin" && user?.role !== "ADMIN") {
      setView("overview");
      window.history.replaceState({}, "", "/dashboard");
    }
  }, [user?.role, view]);
  function changeView(next: View) {
    if (next === "admin" && user?.role !== "ADMIN") return;
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
            <NavButton
              item={{ id: "admin", label: "Quản trị", icon: ShieldCheck }}
              active={view === "admin"}
              onClick={() => changeView("admin")}
            />
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
              spots={spots}
              reservations={reservations}
              sessions={sessions}
              onNavigate={changeView}
            />
          )}
          {!loading && !error && view === "spots" && (
            <SpotsView
              lots={lots}
              areas={areas}
              spots={spots}
              onReserve={(spotId) => {
                setPreferredSpotId(spotId);
                changeView("reservations");
              }}
            />
          )}
          {!loading && !error && view === "reservations" && (
            <ReservationsView
              vehicles={vehicles}
              spots={spots}
              reservations={reservations}
              preferredSpotId={preferredSpotId}
              onChanged={loadData}
            />
          )}
          {!loading && !error && view === "vehicles" && (
            <VehiclesView vehicles={vehicles} onChanged={loadData} />
          )}
          {!loading && !error && view === "history" && (
            <HistoryView sessions={sessions} />
          )}
          {!loading && !error && view === "admin" && user.role === "ADMIN" && (
            <AdminPanel
              currentUserId={user.id}
              users={users}
              lots={lots}
              areas={areas}
              spots={spots}
              onChanged={loadData}
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
  spots,
  reservations,
  sessions,
  onNavigate,
}: {
  spots: ParkingSpot[];
  reservations: Reservation[];
  sessions: ParkingSession[];
  onNavigate: (view: View) => void;
}) {
  const counts = countSpots(spots);
  const recent = reservations.slice(0, 4);
  return (
    <>
      <PageTitle
        title="Tổng quan bãi đỗ"
        description="Tình trạng vận hành hiện tại từ hệ thống."
      />
      <section className="stats-grid" aria-label="Thống kê vị trí đỗ">
        <StatCard
          label="Tổng vị trí"
          value={spots.length}
          icon={CircleParking}
          tone="neutral"
        />
        <StatCard
          label="Còn trống"
          value={counts.AVAILABLE}
          icon={CheckCircle2}
          tone="available"
        />
        <StatCard
          label="Đã đặt"
          value={counts.RESERVED}
          icon={Clock3}
          tone="reserved"
        />
        <StatCard
          label="Đang có xe"
          value={counts.OCCUPIED}
          icon={CarFront}
          tone="occupied"
        />
      </section>
      <div className="overview-grid">
        <section className="content-section">
          <SectionHeader
            title="Sơ đồ vị trí"
            action="Xem tất cả"
            onAction={() => onNavigate("spots")}
          />
          {spots.length ? (
            <SpotGrid spots={spots.slice(0, 12)} />
          ) : (
            <EmptyState
              icon={CircleParking}
              title="Chưa có vị trí đỗ"
              description="Dữ liệu vị trí sẽ xuất hiện sau khi quản trị viên thiết lập bãi xe."
            />
          )}
        </section>
        <section className="content-section">
          <SectionHeader
            title="Đặt chỗ gần đây"
            action="Quản lý"
            onAction={() => onNavigate("reservations")}
          />
          {recent.length ? (
            <ReservationList reservations={recent} />
          ) : (
            <EmptyState
              icon={CalendarCheck2}
              title="Chưa có lượt đặt chỗ"
              description="Các lượt đặt của bạn sẽ được hiển thị tại đây."
            />
          )}
        </section>
      </div>
      {sessions.some((item) => item.status === "ACTIVE") && (
        <div className="active-session-note">
          <CarFront aria-hidden />
          <span>
            Bạn đang có{" "}
            {sessions.filter((item) => item.status === "ACTIVE").length} lượt
            gửi xe hoạt động.
          </span>
        </div>
      )}
    </>
  );
}

function SpotsView({
  lots,
  areas,
  spots,
  onReserve,
}: {
  lots: ParkingLot[];
  areas: ParkingArea[];
  spots: ParkingSpot[];
  onReserve: (spotId: string) => void;
}) {
  const [lotId, setLotId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [status, setStatus] = useState<SpotStatus | "">("");
  const visibleAreas = lotId
    ? areas.filter((area) => area.lotId === lotId)
    : areas;
  const filtered = spots.filter(
    (spot) =>
      (!lotId || spot.area.lot.id === lotId) &&
      (!areaId || spot.areaId === areaId) &&
      (!status || spot.status === status),
  );
  return (
    <>
      <PageTitle
        title="Vị trí đỗ"
        description="Theo dõi trạng thái từng vị trí theo bãi và khu vực."
      />
      <div className="filter-bar">
        <Select
          label="Bãi xe"
          value={lotId}
          onChange={(value) => {
            setLotId(value);
            setAreaId("");
          }}
          options={lots.map((lot) => ({ value: lot.id, label: lot.name }))}
          allLabel="Tất cả bãi xe"
        />
        <Select
          label="Khu vực"
          value={areaId}
          onChange={setAreaId}
          options={visibleAreas.map((area) => ({
            value: area.id,
            label: `${area.code} · ${area.name}`,
          }))}
          allLabel="Tất cả khu vực"
        />
        <Select
          label="Trạng thái"
          value={status}
          onChange={(value) => setStatus(value as SpotStatus | "")}
          options={Object.entries(statusMeta).map(([value, meta]) => ({
            value,
            label: meta.label,
          }))}
          allLabel="Tất cả trạng thái"
        />
      </div>
      <div className="spot-legend">
        {Object.entries(statusMeta).map(([key, meta]) => (
          <span key={key}>
            <i className={meta.className} />
            {meta.label}
          </span>
        ))}
      </div>
      <section className="content-section spot-section">
        <div className="result-count">{filtered.length} vị trí phù hợp</div>
        {filtered.length ? (
          <SpotGrid spots={filtered} detailed onReserve={onReserve} />
        ) : (
          <EmptyState
            icon={MapPinned}
            title="Không tìm thấy vị trí"
            description="Hãy thay đổi bộ lọc để xem các vị trí khác."
          />
        )}
      </section>
    </>
  );
}

function ReservationsView({
  vehicles,
  spots,
  reservations,
  preferredSpotId,
  onChanged,
}: {
  vehicles: Vehicle[];
  spots: ParkingSpot[];
  reservations: Reservation[];
  preferredSpotId: string;
  onChanged: () => Promise<void>;
}) {
  const availableSpots = spots.filter(
    (spot) => spot.status === "AVAILABLE" && spot.isActive,
  );
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [spotId, setSpotId] = useState(
    availableSpots.some((spot) => spot.id === preferredSpotId)
      ? preferredSpotId
      : (availableSpots[0]?.id ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const activeReservations = reservations.filter((item) =>
    ["PENDING", "CONFIRMED"].includes(item.status),
  );
  const reservationHistory = reservations.filter(
    (item) => !["PENDING", "CONFIRMED"].includes(item.status),
  );

  async function reserve(event: FormEvent) {
    event.preventDefault();
    if (!vehicleId || !spotId) {
      setMessage("Vui lòng chọn phương tiện và vị trí trống.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await apiRequest("/api/reservations", {
        method: "POST",
        body: JSON.stringify({ vehicleId, spotId }),
      });
      setMessage("Đặt chỗ thành công.");
      await onChanged();
    } catch (error) {
      setMessage(friendlyError(error));
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
        title="Đặt chỗ"
        description="Chọn phương tiện và một vị trí đang trống."
      />
      <div className="two-column-content">
        <section className="content-section">
          <h2>Tạo lượt đặt mới</h2>
          <form className="inline-form" onSubmit={reserve}>
            <Select
              label="Phương tiện"
              value={vehicleId}
              onChange={setVehicleId}
              options={vehicles.map((vehicle) => ({
                value: vehicle.id,
                label: vehicle.plateNumber,
              }))}
              allLabel="Chọn phương tiện"
            />
            <Select
              label="Vị trí"
              value={spotId}
              onChange={setSpotId}
              options={availableSpots.map((spot) => ({
                value: spot.id,
                label: `${spot.code} · ${spot.area.name}`,
              }))}
              allLabel="Chọn vị trí trống"
            />
            {message && (
              <p className="form-message" role="status">
                {message}
              </p>
            )}
            <button
              className="primary-button"
              disabled={busy || !vehicles.length || !availableSpots.length}
            >
              {busy ? <LoaderCircle className="spin" /> : <CalendarCheck2 />}{" "}
              Xác nhận đặt chỗ
            </button>
          </form>
          {!vehicles.length && (
            <p className="inline-hint">
              Bạn cần thêm phương tiện trước khi đặt chỗ.
            </p>
          )}
          {!availableSpots.length && (
            <p className="inline-hint">Hiện chưa có vị trí trống.</p>
          )}
        </section>
        <section className="content-section">
          <h2>Đặt chỗ đang hiệu lực</h2>
          {activeReservations.length ? (
            <ReservationList
              reservations={activeReservations}
              onCancel={cancel}
              busy={busy}
            />
          ) : (
            <EmptyState
              icon={CalendarCheck2}
              title="Không có đặt chỗ đang hiệu lực"
              description="Lượt đặt mới sẽ xuất hiện tại đây."
            />
          )}
        </section>
      </div>
      <section className="content-section reservation-history-section">
        <SectionHeader title="Lịch sử đặt chỗ" />
        {reservationHistory.length ? (
          <ReservationList reservations={reservationHistory} />
        ) : (
          <EmptyState
            icon={History}
            title="Chưa có lịch sử đặt chỗ"
            description="Các lượt đã hủy, hết hạn hoặc hoàn tất sẽ xuất hiện tại đây."
          />
        )}
      </section>
    </>
  );
}

function VehiclesView({
  vehicles,
  onChanged,
}: {
  vehicles: Vehicle[];
  onChanged: () => Promise<void>;
}) {
  const [plateNumber, setPlateNumber] = useState("");
  const [type, setType] = useState("CAR");
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
    if (plateNumber.trim().length < 4) {
      setMessage("Biển số cần ít nhất 4 ký tự.");
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
            plateNumber: plateNumber.trim(),
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
        title="Phương tiện"
        description="Quản lý phương tiện gắn với tài khoản của bạn."
      />
      <div className="two-column-content vehicle-layout">
        <section className="content-section compact-section">
          <h2>{editingId ? "Cập nhật phương tiện" : "Thêm phương tiện"}</h2>
          <form className="inline-form" onSubmit={saveVehicle}>
            <label>
              <span>Biển số</span>
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
              onChange={setType}
              hideEmpty
              options={[
                { value: "CAR", label: "Ô tô" },
                { value: "MOTORBIKE", label: "Xe máy" },
                { value: "OTHER", label: "Khác" },
              ]}
              allLabel=""
            />
            <div className="form-split">
              <label>
                <span>Hãng xe</span>
                <input
                  value={brand}
                  onChange={(event) => setBrand(event.target.value)}
                  placeholder="Toyota"
                />
              </label>
              <label>
                <span>Màu sắc</span>
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
              {editingId && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={resetForm}
                >
                  <X /> Hủy sửa
                </button>
              )}
            </div>
          </form>
        </section>
        <section className="content-section">
          <h2>Danh sách phương tiện</h2>
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
                    </small>
                  </span>
                  <span
                    className={`status-badge ${vehicle.isActive ? "available" : "inactive"}`}
                  >
                    {vehicle.isActive ? "Hoạt động" : "Ngừng"}
                  </span>
                  <button
                    className="icon-button"
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
              title="Chưa có phương tiện"
              description="Thêm phương tiện để bắt đầu đặt chỗ."
            />
          )}
        </section>
      </div>
    </>
  );
}

function HistoryView({ sessions }: { sessions: ParkingSession[] }) {
  return (
    <>
      <PageTitle
        title="Lịch sử gửi xe"
        description="Các lượt check-in và check-out ghi nhận bởi hệ thống."
      />
      <section className="content-section">
        {sessions.length ? (
          <div className="history-list">
            {sessions.map((session) => (
              <div className="history-row" key={session.id}>
                <span
                  className={`timeline-dot ${session.status === "ACTIVE" ? "active" : ""}`}
                />
                <span>
                  <strong>{session.vehicle.plateNumber}</strong>
                  <small>
                    {session.spot.code} · {session.spot.area.lot.name}
                  </small>
                </span>
                <span>
                  <strong>{formatDateTime(session.checkedInAt)}</strong>
                  <small>
                    {session.checkedOutAt
                      ? `Ra lúc ${formatDateTime(session.checkedOutAt)}`
                      : "Đang gửi xe"}
                  </small>
                </span>
                <span
                  className={`status-badge ${session.status === "ACTIVE" ? "occupied" : "neutral"}`}
                >
                  {session.status === "ACTIVE"
                    ? "Đang hoạt động"
                    : "Đã hoàn tất"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={History}
            title="Chưa có lịch sử gửi xe"
            description="Dữ liệu xuất hiện sau khi một lượt gửi xe được check-in."
          />
        )}
      </section>
    </>
  );
}

function SpotGrid({
  spots,
  detailed = false,
  onReserve,
}: {
  spots: ParkingSpot[];
  detailed?: boolean;
  onReserve?: (spotId: string) => void;
}) {
  return (
    <div className="parking-grid">
      {spots.map((spot) => {
        const meta = statusMeta[spot.status];
        return (
          <article className={`parking-spot ${meta.className}`} key={spot.id}>
            <div className="spot-top">
              <strong>{spot.code}</strong>
              <span className={`status-dot ${meta.className}`} />
            </div>
            <CarFront aria-hidden />
            <span className="spot-status">{meta.label}</span>
            {detailed && (
              <small>
                {spot.area.lot.name} · {spot.area.name}
              </small>
            )}
            {detailed && spot.status === "AVAILABLE" && onReserve && (
              <button
                className="spot-action"
                onClick={() => onReserve(spot.id)}
                aria-label={`Đặt vị trí ${spot.code}`}
              >
                Đặt chỗ
              </button>
            )}
          </article>
        );
      })}
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
              {reservation.spot.code} · {reservation.vehicle.plateNumber}
            </strong>
            <small>{reservation.spot.area.lot.name}</small>
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

function countSpots(spots: ParkingSpot[]) {
  return spots.reduce<Record<SpotStatus, number>>(
    (result, spot) => {
      result[spot.status] += 1;
      return result;
    },
    { AVAILABLE: 0, RESERVED: 0, OCCUPIED: 0, INACTIVE: 0 },
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
function reservationStatusLabel(status: Reservation["status"]) {
  return {
    PENDING: "Đang chờ",
    CONFIRMED: "Đã xác nhận",
    CANCELLED: "Đã hủy",
    EXPIRED: "Hết hạn",
    CHECKED_IN: "Đã check-in",
    COMPLETED: "Hoàn tất",
  }[status];
}
