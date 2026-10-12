import { useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";
import { friendlyError } from "../api";
import { useAuth } from "../auth";
import { AuthLayout } from "../components/AuthLayout";

type Errors = Partial<
  Record<"fullName" | "email" | "password" | "confirmPassword", string>
>;

export function RegisterPage() {
  const { register } = useAuth();
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [requestError, setRequestError] = useState("");

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function validate() {
    const next: Errors = {};
    if (form.fullName.trim().length < 2)
      next.fullName = "Họ tên cần ít nhất 2 ký tự.";
    if (!/^\S+@\S+\.\S+$/.test(form.email))
      next.email = "Email chưa đúng định dạng.";
    if (form.password.length < 8)
      next.password = "Mật khẩu cần ít nhất 8 ký tự.";
    if (form.confirmPassword !== form.password)
      next.confirmPassword = "Mật khẩu xác nhận chưa khớp.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setRequestError("");
    if (!validate()) return;
    setSubmitting(true);
    try {
      await register({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      window.history.replaceState({}, "", "/dashboard");
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (error) {
      setRequestError(friendlyError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <div className="auth-heading compact">
        <p className="section-kicker">TẠO TÀI KHOẢN</p>
        <h1>Bắt đầu sử dụng</h1>
        <p>Tài khoản mới được cấp quyền người dùng tiêu chuẩn.</p>
      </div>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {requestError && (
          <div className="form-alert" role="alert">
            {requestError}
          </div>
        )}
        <Field label="Họ và tên" error={errors.fullName}>
          <UserRound aria-hidden />
          <input
            value={form.fullName}
            onChange={(e) => update("fullName", e.target.value)}
            placeholder="Nguyễn Văn An"
            autoComplete="name"
            disabled={submitting}
          />
        </Field>
        <Field label="Email" error={errors.email}>
          <Mail aria-hidden />
          <input
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="ten@email.com"
            autoComplete="email"
            disabled={submitting}
          />
        </Field>
        <Field label="Mật khẩu" error={errors.password}>
          <LockKeyhole aria-hidden />
          <input
            type={showPassword ? "text" : "password"}
            value={form.password}
            onChange={(e) => update("password", e.target.value)}
            placeholder="Tối thiểu 8 ký tự"
            autoComplete="new-password"
            disabled={submitting}
          />
          <button
            className="icon-button password-toggle"
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            title={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          >
            {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </button>
        </Field>
        <Field label="Xác nhận mật khẩu" error={errors.confirmPassword}>
          <LockKeyhole aria-hidden />
          <input
            type={showPassword ? "text" : "password"}
            value={form.confirmPassword}
            onChange={(e) => update("confirmPassword", e.target.value)}
            placeholder="Nhập lại mật khẩu"
            autoComplete="new-password"
            disabled={submitting}
          />
        </Field>
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? (
            <LoaderCircle className="spin" aria-hidden />
          ) : (
            <ArrowRight aria-hidden />
          )}
          {submitting ? "Đang tạo tài khoản..." : "Tạo tài khoản"}
        </button>
      </form>
      <p className="auth-switch">
        Đã có tài khoản? <a href="/login">Đăng nhập</a>
      </p>
    </AuthLayout>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label>
      <span>{label}</span>
      <span className={`input-wrap ${error ? "invalid" : ""}`}>{children}</span>
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}
