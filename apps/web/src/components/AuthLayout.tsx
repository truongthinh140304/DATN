import type { ReactNode } from "react";
import {
  CarFront,
  CheckCircle2,
  CircleParking,
  ShieldCheck,
} from "lucide-react";

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
          <p className="auth-footer">
            Hệ thống kiểm soát cổng &amp; bãi đỗ xe thông minh
          </p>
        </div>
      </section>

      <aside className="auth-visual" aria-label="Minh họa kiểm soát cổng barie">
        <div className="visual-content">
          <p className="visual-kicker">CỔNG TỰ ĐỘNG · OCR</p>
          <h2>Đặt chỗ theo biển số, qua cổng không chạm.</h2>
          <p>
            Đăng ký phương tiện và giữ suất đậu theo bãi xe. Camera tại cổng tự
            động nhận diện biển số và điều khiển barie.
          </p>

          <div className="parking-preview">
            <div className="parking-preview-head">
              <span>Cổng chính · Bãi xe trung tâm</span>
              <span>Sẵn sàng</span>
            </div>
            <div className="preview-grid">
              <PreviewTile
                code="Camera"
                state="available"
                label="Quét biển số"
              />
              <PreviewTile
                code="30A-12345"
                state="reserved"
                label="Khớp đặt chỗ"
              />
              <PreviewTile code="Barie" state="available" label="Mở cổng 5s" />
              <PreviewTile
                code="Còn chỗ"
                state="occupied"
                label="14 / 20 suất"
              />
            </div>
          </div>

          <div className="preview-legend">
            <span>
              <CheckCircle2 aria-hidden /> Tự động check-in / out
            </span>
            <span>
              <ShieldCheck aria-hidden /> Khớp biển số hợp lệ
            </span>
            <span>
              <CarFront aria-hidden /> Barie Arduino Uno
            </span>
          </div>
        </div>
      </aside>
    </main>
  );
}

function PreviewTile({
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
