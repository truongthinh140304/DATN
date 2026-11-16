# Smart Parking — Hệ thống bãi giữ xe thông minh (Web + AI Camera ANPR + Arduino Barie)

Hệ thống quản lý bãi giữ xe thông minh dùng mô hình cổng kiểm soát tự động:

1. **Khách hàng đặt chỗ trên Web**:
   - Đăng ký / đăng nhập tài khoản.
   - Khai báo biển số xe (ví dụ `30A-12345`) trong mục **Phương tiện**.
   - Chọn **bãi xe** còn sức chứa và xác nhận giữ chỗ (hiện chưa tích hợp thanh toán online; schema đã giữ sẵn `paymentStatus` cho giai đoạn sau).
2. **Xe tới cổng (vào bãi)**:
   - **Webcam USB** hướng vào biển số trước cổng gửi hình về tiến trình Python (**YOLO + PaddleOCR**).
   - Sau khi đọc ổn định biển số hợp lệ qua nhiều khung hình liên tiếp, Python gọi `POST /api/gate/scan`.
   - **Backend (Express + PostgreSQL)** kiểm tra biển số có vé đặt chỗ hợp lệ còn hạn và `paymentStatus != UNPAID`.
   - Nếu hợp lệ: tự động tạo `ParkingSession` (`ACTIVE`), chuyển vé đặt chỗ sang `CHECKED_IN` và trả về `barrierAction: "OPEN"`.
   - Python gửi lệnh `OPEN:5000\n` qua USB Serial (`9600` baud) xuống **Arduino Uno R3** để quay **Servo SG90** (`D4`) nâng barie trong 5 giây rồi tự đóng.
   - Nếu không hợp lệ (chưa đặt vé, sai biển số, hết hạn): giữ barie đóng (`STAY_CLOSED`) và ghi nhật ký `DENY` hiển thị realtime lên Web Quản trị.
3. **Xe rời bãi (ra qua cùng 1 cổng)**:
   - Cùng camera & barie đó đọc lại biển số xe khi đi ra.
   - Sau thời gian chống lặp lại (`GATE_REENTRY_COOLDOWN_SECONDS=15` giây), backend nhận diện xe đang có phiên `ACTIVE`, tự động check-out (`COMPLETED`), hoàn tất vé đặt chỗ và ra lệnh mở barie cho xe ra.
4. **Admin giám sát & mở cổng thủ công**:
   - Trang **Quản trị & Cổng** hiển thị trạng thái kết nối Webcam/Arduino, lịch sử từng lượt quét cổng realtime (Socket.IO) và nút **Mở barie thủ công**.

---

## Cấu trúc thư mục

- `apps/api`: Express + TypeScript + Prisma (PostgreSQL) + Socket.IO realtime.
- `apps/web`: React + Vite + TypeScript dashboard đặt chỗ & giám sát cổng.
- `services/vision`: Python Gate Vision (`YOLO + PaddleOCR + PySerial`) kết nối Webcam USB & Arduino Uno R3.
- `firmware/gate_controller`: Mã nguồn Arduino (`gate_controller.ino`) điều khiển Servo SG90 (`D4`) và sẵn chân dự phòng cảm biến hồng ngoại `IR1 (D2)`, `IR2 (D3)`.
- `scripts/gate.mjs`: Launcher chạy `gate:run` / `gate:preflight` với `VISION_API_KEY`.
- `tests/e2e`: Playwright end-to-end tests.

---

## Sơ đồ đấu nối phần cứng (Arduino Uno R3 + Servo SG90 + Adapter 5V DC)

- **Arduino `D4`** → dây tín hiệu màu **cam** của **Servo SG90**.
- **Adapter 5V DC (`+`)** → thanh nguồn `+` trên breadboard → dây đỏ (**VCC**) của Servo SG90.
- **Adapter 5V DC (`-`)**, dây nâu/đen (**GND**) của Servo SG90 và chân **GND** của Arduino Uno R3 → nối **chung một cụm GND** trên breadboard.
- **Chân dự phòng tương lai** (đã khai báo trong `firmware/gate_controller/gate_controller.ino`, đặt `USE_IR_SENSORS = false`):
  - `D2` → cảm biến `IR1` (trước barie)
  - `D3` → cảm biến `IR2` (sau barie)
- Chi tiết nạp code Arduino: xem [firmware/README.md](firmware/README.md).

---

## Cài đặt & Chạy hệ thống

### 1. Cài dependencies Node.js

```bash
npm install
```

### 2. Cấu hình môi trường & Database (PostgreSQL)

Tạo `apps/api/.env` từ `.env.example` (chỉnh `DATABASE_URL`, `JWT_ACCESS_SECRET`, `VISION_API_KEY`):

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

Tài khoản mẫu sau `npm run db:seed`:

- **Admin**: `admin@example.com` / `Admin12345!`
- **User**: `user@example.com` / `User12345!` (đã gắn sẵn xe mẫu biển số `30A-12345` và bãi `Bãi xe thông minh · Cổng chính`, sức chứa `20` chỗ).

### 3. Chạy API & Web

```bash
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:4000`

### 4. Chạy dịch vụ Camera AI & Điều khiển Barie Arduino

Chi tiết cài đặt môi trường Python xem [services/vision/README.md](services/vision/README.md).

Kiểm tra nhanh Webcam & cổng COM Arduino trước khi chạy:

```bash
npm run gate:preflight
```

Chạy nhận diện biển số tại cổng:

```bash
npm run gate:run
```

Tùy chọn nhanh khi test chưa cắm Arduino hoặc chưa bật API:

- `npm run gate:run -- --no-arduino` (chỉ đọc camera/OCR & gọi API, mô phỏng mở barie)
- `npm run gate:run -- --no-api --no-arduino` (test camera + OCR offline)
- Phím tắt trên cửa sổ camera:
  - `R`: kéo chuột chọn lại vùng quét biển số trước cổng và lưu vào `services/vision/config/gate.json`
  - `O`: test gửi lệnh mở barie 5 giây xuống Arduino
  - `C`: xóa bộ nhớ đệm biển số để quét lại ngay
  - `Q` / `ESC`: thoát

---

## Kiểm thử (Tests & Lint)

```bash
npm run build
npm run lint
npm run lint:e2e
npm test
npm run format:check
```

Test Python Gate Vision:

```bash
services/vision/.venv/Scripts/python.exe -m unittest discover -s services/vision/tests -v
services/vision/.venv/Scripts/python.exe -m ruff check services/vision/vision services/vision/tests
```
