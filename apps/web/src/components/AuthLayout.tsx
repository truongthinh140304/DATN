import type { ReactNode } from "react";
import { CarFront, CheckCircle2, CircleParking, Clock3 } from "lucide-react";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <a className="brand" href="/login" aria-label="Smart Parking">
            <span className="brand-mark">
              <CircleParking aria-hidden />
            </span>
            <span>Smart Parking</span>
          </a>
          {children}
          <p className="auth-footer">Hệ thống quản lý bãi đỗ xe thông minh</p>
        </div>
      </section>

      <aside className="auth-visual" aria-label="Minh họa trạng thái bãi đỗ xe">
        <div className="visual-content">
          <p className="visual-kicker">QUẢN LÝ TẬP TRUNG</p>
          <h2>Nắm rõ từng vị trí, chủ động mỗi hành trình.</h2>
          <p>
            Theo dõi sức chứa, đặt chỗ và quản lý phương tiện trong một không
            gian rõ ràng.
          </p>

          <div className="parking-preview">
            <div className="parking-preview-head">
              <span>Khu A · Tầng 1</span>
              <span>4 vị trí</span>
            </div>
            <div className="preview-grid">
              <PreviewSpot code="A01" state="available" label="Trống" />
              <PreviewSpot code="A02" state="reserved" label="Đã đặt" />
              <PreviewSpot code="A03" state="occupied" label="Có xe" />
              <PreviewSpot code="A04" state="available" label="Trống" />
            </div>
          </div>

          <div className="preview-legend">
            <span>
              <CheckCircle2 aria-hidden /> Trống
            </span>
            <span>
              <Clock3 aria-hidden /> Đã đặt
            </span>
            <span>
              <CarFront aria-hidden /> Đang có xe
            </span>
          </div>
        </div>
      </aside>
    </main>
  );
}

function PreviewSpot({
  code,
  state,
  label,
}: {
  code: string;
  state: string;
  label: string;
}) {
  return (
    <div className={`preview-spot ${state}`}>
      <span>{code}</span>
      {state === "occupied" ? (
        <CarFront aria-hidden />
      ) : (
        <CircleParking aria-hidden />
      )}
      <small>{label}</small>
    </div>
  );
}
