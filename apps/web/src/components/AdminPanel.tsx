import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  CircleParking,
  LoaderCircle,
  MapPinned,
  Pencil,
  Plus,
  Save,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { apiRequest, friendlyError } from "../api";
import type {
  ParkingArea,
  ParkingLot,
  ParkingSpot,
  SpotStatus,
  User,
  UserRole,
} from "../types";

type AdminSection = "users" | "lots" | "areas" | "spots";

type AdminPanelProps = {
  currentUserId: string;
  users: User[];
  lots: ParkingLot[];
  areas: ParkingArea[];
  spots: ParkingSpot[];
  onChanged: () => Promise<void>;
};

const spotStatusOptions: Array<{ value: SpotStatus; label: string }> = [
  { value: "AVAILABLE", label: "Trống" },
  { value: "RESERVED", label: "Đã đặt" },
  { value: "OCCUPIED", label: "Đang có xe" },
  { value: "INACTIVE", label: "Ngừng hoạt động" },
];

export function AdminPanel({
  currentUserId,
  users,
  lots,
  areas,
  spots,
  onChanged,
}: AdminPanelProps) {
  const [section, setSection] = useState<AdminSection>("users");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function runAction(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await onChanged();
      setMessage(success);
      return true;
    } catch (error) {
      setMessage(friendlyError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const sections = [
    {
      id: "users" as const,
      label: "Người dùng",
      detail: "Tài khoản và phân quyền",
      count: users.length,
      icon: Users,
    },
    {
      id: "lots" as const,
      label: "Bãi xe",
      detail: "Thông tin bãi đỗ",
      count: lots.length,
      icon: Warehouse,
    },
    {
      id: "areas" as const,
      label: "Khu vực",
      detail: "Khu và tầng đỗ xe",
      count: areas.length,
      icon: MapPinned,
    },
    {
      id: "spots" as const,
      label: "Vị trí",
      detail: "Trạng thái từng vị trí",
      count: spots.length,
      icon: CircleParking,
    },
  ];

  return (
    <>
      <div className="page-title">
        <h1>Quản trị hệ thống</h1>
        <p>Quản lý tài khoản và cấu trúc bãi đỗ theo đúng quyền quản trị.</p>
      </div>

      <section className="admin-grid" aria-label="Nhóm chức năng quản trị">
        {sections.map(({ id, label, detail, count, icon: Icon }) => (
          <button
            className={`admin-card ${section === id ? "selected" : ""}`}
            key={id}
            onClick={() => {
              setSection(id);
              setMessage("");
            }}
          >
            <Icon aria-hidden />
            <span>
              <small>{label}</small>
              <strong>{count}</strong>
              <span>{detail}</span>
            </span>
          </button>
        ))}
      </section>

      {message && (
        <div className="admin-message" role="status">
          {message}
        </div>
      )}

      {section === "users" && (
        <UsersManager
          users={users}
          currentUserId={currentUserId}
          busy={busy}
          runAction={runAction}
        />
      )}
      {section === "lots" && (
        <LotsManager lots={lots} busy={busy} runAction={runAction} />
      )}
      {section === "areas" && (
        <AreasManager
          areas={areas}
          lots={lots}
          busy={busy}
          runAction={runAction}
        />
      )}
      {section === "spots" && (
        <SpotsManager
          spots={spots}
          areas={areas}
          busy={busy}
          runAction={runAction}
        />
      )}
    </>
  );
}

type RunAction = (
  action: () => Promise<unknown>,
  success: string,
) => Promise<boolean>;

function UsersManager({
  users,
  currentUserId,
  busy,
  runAction,
}: {
  users: User[];
  currentUserId: string;
  busy: boolean;
  runAction: RunAction;
}) {
  async function updateUser(
    user: User,
    patch: { role?: UserRole; isActive?: boolean },
  ) {
    await runAction(
      () =>
        apiRequest(`/api/users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        }),
      `Đã cập nhật tài khoản ${user.fullName}.`,
    );
  }

  return (
    <section className="content-section admin-manager">
      <div className="section-header">
        <h2>Danh sách người dùng</h2>
        <span className="result-count">{users.length} tài khoản</span>
      </div>
      {users.length ? (
        <div className="admin-table">
          <div className="admin-table-head user-columns">
            <span>Tài khoản</span>
            <span>Vai trò</span>
            <span>Trạng thái</span>
          </div>
          {users.map((account) => {
            const isCurrent = account.id === currentUserId;
            return (
              <div className="admin-table-row user-columns" key={account.id}>
                <span className="admin-primary-cell">
                  <strong>{account.fullName}</strong>
                  <small>{account.email}</small>
                </span>
                <select
                  value={account.role}
                  disabled={busy || isCurrent}
                  onChange={(event) =>
                    void updateUser(account, {
                      role: event.target.value as UserRole,
                    })
                  }
                  aria-label={`Vai trò của ${account.fullName}`}
                >
                  <option value="USER">Người dùng</option>
                  <option value="ADMIN">Quản trị viên</option>
                </select>
                <label className="status-toggle">
                  <input
                    type="checkbox"
                    checked={account.isActive}
                    disabled={busy || isCurrent}
                    onChange={(event) =>
                      void updateUser(account, {
                        isActive: event.target.checked,
                      })
                    }
                  />
                  <span>{account.isActive ? "Hoạt động" : "Đã khóa"}</span>
                </label>
                {isCurrent && (
                  <small className="self-note">Tài khoản hiện tại</small>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <AdminEmpty icon={Users} text="Chưa có tài khoản trong hệ thống." />
      )}
    </section>
  );
}

function LotsManager({
  lots,
  busy,
  runAction,
}: {
  lots: ParkingLot[];
  busy: boolean;
  runAction: RunAction;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    address: "",
    description: "",
    isActive: true,
  });

  function edit(lot: ParkingLot) {
    setEditingId(lot.id);
    setForm({
      name: lot.name,
      address: lot.address,
      description: lot.description ?? "",
      isActive: lot.isActive,
    });
  }

  function reset() {
    setEditingId(null);
    setForm({ name: "", address: "", description: "", isActive: true });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.name.trim().length < 2 || form.address.trim().length < 3) return;
    const ok = await runAction(
      () =>
        apiRequest(
          editingId ? `/api/parking/lots/${editingId}` : "/api/parking/lots",
          {
            method: editingId ? "PATCH" : "POST",
            body: JSON.stringify({
              name: form.name.trim(),
              address: form.address.trim(),
              description: form.description.trim() || undefined,
              isActive: form.isActive,
            }),
          },
        ),
      editingId ? "Đã cập nhật bãi xe." : "Đã thêm bãi xe.",
    );
    if (ok) reset();
  }

  return (
    <ManagerLayout
      formTitle={editingId ? "Cập nhật bãi xe" : "Thêm bãi xe"}
      form={
        <form className="inline-form" onSubmit={submit}>
          <TextField
            label="Tên bãi xe"
            value={form.name}
            onChange={(name) => setForm((current) => ({ ...current, name }))}
            placeholder="Bãi xe khu giảng đường"
            required
          />
          <TextField
            label="Địa chỉ"
            value={form.address}
            onChange={(address) =>
              setForm((current) => ({ ...current, address }))
            }
            placeholder="Khuôn viên trường"
            required
          />
          <TextField
            label="Mô tả"
            value={form.description}
            onChange={(description) =>
              setForm((current) => ({ ...current, description }))
            }
            placeholder="Thông tin bổ sung"
          />
          <label className="status-toggle form-toggle">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isActive: event.target.checked,
                }))
              }
            />
            <span>Bãi xe đang hoạt động</span>
          </label>
          <FormActions
            busy={busy}
            editing={Boolean(editingId)}
            onCancel={reset}
          />
        </form>
      }
      listTitle="Danh sách bãi xe"
      list={
        lots.length ? (
          <div className="management-list">
            {lots.map((lot) => (
              <ManagementRow
                key={lot.id}
                title={lot.name}
                detail={lot.address}
                active={lot.isActive}
                onEdit={() => edit(lot)}
              />
            ))}
          </div>
        ) : (
          <AdminEmpty icon={Warehouse} text="Chưa có bãi xe." />
        )
      }
    />
  );
}

function AreasManager({
  areas,
  lots,
  busy,
  runAction,
}: {
  areas: ParkingArea[];
  lots: ParkingLot[];
  busy: boolean;
  runAction: RunAction;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    lotId: lots[0]?.id ?? "",
    code: "",
    name: "",
    floor: "",
    isActive: true,
  });

  function edit(area: ParkingArea) {
    setEditingId(area.id);
    setForm({
      lotId: area.lotId,
      code: area.code,
      name: area.name,
      floor: area.floor?.toString() ?? "",
      isActive: area.isActive,
    });
  }

  function reset() {
    setEditingId(null);
    setForm({
      lotId: lots[0]?.id ?? "",
      code: "",
      name: "",
      floor: "",
      isActive: true,
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.lotId || !form.code.trim() || !form.name.trim()) return;
    const ok = await runAction(
      () =>
        apiRequest(
          editingId ? `/api/parking/areas/${editingId}` : "/api/parking/areas",
          {
            method: editingId ? "PATCH" : "POST",
            body: JSON.stringify({
              lotId: form.lotId,
              code: form.code.trim(),
              name: form.name.trim(),
              floor: form.floor === "" ? undefined : Number(form.floor),
              isActive: form.isActive,
            }),
          },
        ),
      editingId ? "Đã cập nhật khu vực." : "Đã thêm khu vực.",
    );
    if (ok) reset();
  }

  return (
    <ManagerLayout
      formTitle={editingId ? "Cập nhật khu vực" : "Thêm khu vực"}
      form={
        <form className="inline-form" onSubmit={submit}>
          <SelectField
            label="Bãi xe"
            value={form.lotId}
            onChange={(lotId) => setForm((current) => ({ ...current, lotId }))}
            options={lots.map((lot) => ({ value: lot.id, label: lot.name }))}
            placeholder="Chọn bãi xe"
          />
          <div className="form-split">
            <TextField
              label="Mã khu"
              value={form.code}
              onChange={(code) =>
                setForm((current) => ({ ...current, code: code.toUpperCase() }))
              }
              placeholder="A"
              required
            />
            <TextField
              label="Tầng"
              value={form.floor}
              onChange={(floor) =>
                setForm((current) => ({ ...current, floor }))
              }
              placeholder="1"
              type="number"
            />
          </div>
          <TextField
            label="Tên khu vực"
            value={form.name}
            onChange={(name) => setForm((current) => ({ ...current, name }))}
            placeholder="Khu A"
            required
          />
          <label className="status-toggle form-toggle">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isActive: event.target.checked,
                }))
              }
            />
            <span>Khu vực đang hoạt động</span>
          </label>
          <FormActions
            busy={busy}
            editing={Boolean(editingId)}
            onCancel={reset}
          />
        </form>
      }
      listTitle="Danh sách khu vực"
      list={
        areas.length ? (
          <div className="management-list">
            {areas.map((area) => (
              <ManagementRow
                key={area.id}
                title={`${area.code} · ${area.name}`}
                detail={`${area.lot?.name ?? "Bãi xe"}${area.floor ? ` · Tầng ${area.floor}` : ""}`}
                active={area.isActive}
                onEdit={() => edit(area)}
              />
            ))}
          </div>
        ) : (
          <AdminEmpty icon={MapPinned} text="Chưa có khu vực." />
        )
      }
    />
  );
}

function SpotsManager({
  spots,
  areas,
  busy,
  runAction,
}: {
  spots: ParkingSpot[];
  areas: ParkingArea[];
  busy: boolean;
  runAction: RunAction;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{
    areaId: string;
    code: string;
    status: SpotStatus;
    isActive: boolean;
  }>({
    areaId: areas[0]?.id ?? "",
    code: "",
    status: "AVAILABLE",
    isActive: true,
  });

  const sortedSpots = useMemo(
    () => [...spots].sort((a, b) => a.code.localeCompare(b.code, "vi")),
    [spots],
  );

  function edit(spot: ParkingSpot) {
    setEditingId(spot.id);
    setForm({
      areaId: spot.areaId,
      code: spot.code,
      status: spot.status,
      isActive: spot.isActive,
    });
  }

  function reset() {
    setEditingId(null);
    setForm({
      areaId: areas[0]?.id ?? "",
      code: "",
      status: "AVAILABLE",
      isActive: true,
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.areaId || !form.code.trim()) return;
    const ok = await runAction(
      () =>
        apiRequest(
          editingId ? `/api/parking/spots/${editingId}` : "/api/parking/spots",
          {
            method: editingId ? "PATCH" : "POST",
            body: JSON.stringify({
              areaId: form.areaId,
              code: form.code.trim(),
              status: form.status,
              isActive: form.isActive,
            }),
          },
        ),
      editingId ? "Đã cập nhật vị trí." : "Đã thêm vị trí.",
    );
    if (ok) reset();
  }

  return (
    <ManagerLayout
      formTitle={editingId ? "Cập nhật vị trí" : "Thêm vị trí"}
      form={
        <form className="inline-form" onSubmit={submit}>
          <SelectField
            label="Khu vực"
            value={form.areaId}
            onChange={(areaId) =>
              setForm((current) => ({ ...current, areaId }))
            }
            options={areas.map((area) => ({
              value: area.id,
              label: `${area.code} · ${area.name}`,
            }))}
            placeholder="Chọn khu vực"
          />
          <TextField
            label="Mã vị trí"
            value={form.code}
            onChange={(code) =>
              setForm((current) => ({ ...current, code: code.toUpperCase() }))
            }
            placeholder="A05"
            required
          />
          <SelectField
            label="Trạng thái"
            value={form.status}
            onChange={(status) =>
              setForm((current) => ({
                ...current,
                status: status as SpotStatus,
              }))
            }
            options={spotStatusOptions}
          />
          <label className="status-toggle form-toggle">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isActive: event.target.checked,
                }))
              }
            />
            <span>Cho phép sử dụng vị trí</span>
          </label>
          <FormActions
            busy={busy}
            editing={Boolean(editingId)}
            onCancel={reset}
          />
        </form>
      }
      listTitle="Danh sách vị trí"
      list={
        sortedSpots.length ? (
          <div className="management-list">
            {sortedSpots.map((spot) => (
              <ManagementRow
                key={spot.id}
                title={spot.code}
                detail={`${spot.area.lot.name} · ${spot.area.name}`}
                active={spot.isActive}
                badge={
                  spotStatusOptions.find(
                    (option) => option.value === spot.status,
                  )?.label
                }
                onEdit={() => edit(spot)}
              />
            ))}
          </div>
        ) : (
          <AdminEmpty icon={CircleParking} text="Chưa có vị trí đỗ." />
        )
      }
    />
  );
}

function ManagerLayout({
  formTitle,
  form,
  listTitle,
  list,
}: {
  formTitle: string;
  form: ReactNode;
  listTitle: string;
  list: ReactNode;
}) {
  return (
    <div className="admin-manager-grid">
      <section className="content-section compact-section">
        <h2>{formTitle}</h2>
        {form}
      </section>
      <section className="content-section">
        <div className="section-header">
          <h2>{listTitle}</h2>
        </div>
        {list}
      </section>
    </div>
  );
}

function FormActions({
  busy,
  editing,
  onCancel,
}: {
  busy: boolean;
  editing: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="form-actions">
      <button className="primary-button" disabled={busy}>
        {busy ? (
          <LoaderCircle className="spin" aria-hidden />
        ) : editing ? (
          <Save aria-hidden />
        ) : (
          <Plus aria-hidden />
        )}
        {editing ? "Lưu thay đổi" : "Thêm mới"}
      </button>
      {editing && (
        <button className="secondary-button" type="button" onClick={onCancel}>
          <X aria-hidden /> Hủy sửa
        </button>
      )}
    </div>
  );
}

function ManagementRow({
  title,
  detail,
  active,
  badge,
  onEdit,
}: {
  title: string;
  detail: string;
  active: boolean;
  badge?: string;
  onEdit: () => void;
}) {
  return (
    <div className="management-row">
      <span className="admin-primary-cell">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {badge && <span className="status-badge neutral">{badge}</span>}
      <span className={`status-badge ${active ? "available" : "inactive"}`}>
        {active ? "Hoạt động" : "Ngừng"}
      </span>
      <button
        className="icon-button"
        onClick={onEdit}
        title="Chỉnh sửa"
        aria-label={`Chỉnh sửa ${title}`}
      >
        <Pencil aria-hidden />
      </button>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function AdminEmpty({
  icon: Icon,
  text,
}: {
  icon: typeof Users;
  text: string;
}) {
  return (
    <div className="admin-empty">
      <Icon aria-hidden />
      <span>{text}</span>
    </div>
  );
}
