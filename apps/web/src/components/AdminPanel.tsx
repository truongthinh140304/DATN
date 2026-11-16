import { useState, type FormEvent, type ReactNode } from "react";
import {
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { apiRequest, friendlyError } from "../api";
import type { ParkingLot, User, UserRole } from "../types";

type AdminSection = "users" | "lots";

type AdminPanelProps = {
  currentUserId: string;
  users: User[];
  lots: ParkingLot[];
  onChanged: () => Promise<void>;
};

export function AdminPanel({
  currentUserId,
  users,
  lots,
  onChanged,
}: AdminPanelProps) {
  const [section, setSection] = useState<AdminSection>("lots");
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
      id: "lots" as const,
      label: "Bãi xe & Sức chứa",
      detail: "Cấu hình tổng số chỗ từng bãi",
      count: lots.length,
      icon: Warehouse,
    },
    {
      id: "users" as const,
      label: "Người dùng",
      detail: "Tài khoản và phân quyền",
      count: users.length,
      icon: Users,
    },
  ];

  return (
    <>
      <div className="page-title">
        <h1>Quản trị hệ thống</h1>
        <p>
          Quản lý tài khoản và sức chứa bãi xe phục vụ kiểm soát cổng barie.
        </p>
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
    capacity: "20",
    isActive: true,
  });

  function edit(lot: ParkingLot) {
    setEditingId(lot.id);
    setForm({
      name: lot.name,
      address: lot.address,
      description: lot.description ?? "",
      capacity: String(lot.capacity),
      isActive: lot.isActive,
    });
  }

  function reset() {
    setEditingId(null);
    setForm({
      name: "",
      address: "",
      description: "",
      capacity: "20",
      isActive: true,
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsedCapacity = Number.parseInt(form.capacity, 10);
    if (
      form.name.trim().length < 2 ||
      form.address.trim().length < 3 ||
      !Number.isFinite(parsedCapacity) ||
      parsedCapacity < 1
    ) {
      return;
    }
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
              capacity: parsedCapacity,
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
        <form className="inline-form" onSubmit={(e) => void submit(e)}>
          <TextField
            label="Tên bãi xe"
            value={form.name}
            onChange={(name) => setForm((current) => ({ ...current, name }))}
            placeholder="Bãi xe trung tâm"
            required
          />
          <TextField
            label="Địa chỉ"
            value={form.address}
            onChange={(address) =>
              setForm((current) => ({ ...current, address }))
            }
            placeholder="Cổng chính khuôn viên"
            required
          />
          <TextField
            label="Sức chứa tối đa (chỗ)"
            type="number"
            value={form.capacity}
            onChange={(capacity) =>
              setForm((current) => ({ ...current, capacity }))
            }
            placeholder="20"
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
                badge={`Còn ${lot.availableSlots}/${lot.capacity} chỗ`}
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
        min={type === "number" ? 1 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
      />
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
