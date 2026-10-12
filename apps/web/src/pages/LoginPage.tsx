import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
} from "lucide-react";
import { friendlyError } from "../api";
import { useAuth } from "../auth";
import { AuthLayout } from "../components/AuthLayout";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Vui lòng nhập đầy đủ email và mật khẩu.");
      return;
    }
    setSubmitting(true);
    try {
      await login({ email: email.trim(), password });
      window.history.replaceState({}, "", "/dashboard");
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <div className="auth-heading">
        <p className="section-kicker">CHÀO MỪNG TRỞ LẠI</p>
        <h1>Đăng nhập</h1>
        <p>Truy cập thông tin vị trí đỗ và các hành trình của bạn.</p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {error && (
          <div className="form-alert" role="alert">
            {error}
          </div>
        )}
        <label>
          <span>Email</span>
          <span className="input-wrap">
            <Mail aria-hidden />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="ten@email.com"
              autoComplete="email"
              autoFocus
              disabled={submitting}
            />
          </span>
        </label>
        <label>
          <span>Mật khẩu</span>
          <span className="input-wrap">
            <LockKeyhole aria-hidden />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Nhập mật khẩu"
              autoComplete="current-password"
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
          </span>
        </label>
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? (
            <LoaderCircle className="spin" aria-hidden />
          ) : (
            <ArrowRight aria-hidden />
          )}
          {submitting ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>

      <p className="auth-switch">
        Chưa có tài khoản? <a href="/register">Đăng ký ngay</a>
      </p>
    </AuthLayout>
  );
}
