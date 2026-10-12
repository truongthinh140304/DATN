# Smart Parking Thesis

Đồ án tốt nghiệp: **Xây dựng hệ thống bãi đỗ xe thông minh tích hợp IoT và Web thời gian thực**.

Dự án hiện hoàn thành nền tảng backend tuần 4 và giao diện React tuần 5. Camera, AI nhận diện biển số, ESP32, MQTT và WebSocket chưa được triển khai trong giai đoạn này.

## Cấu trúc dự án

```text
apps/
  api/        Express, Prisma và PostgreSQL
  web/        React/Vite, xác thực và dashboard responsive
services/
  vision/     Hợp đồng dữ liệu dự kiến cho module Python về sau
docs/         Kiến trúc, mô hình dữ liệu và tài liệu API
infra/        Docker Compose PostgreSQL cho môi trường phát triển
```

## Chức năng tuần 5

- Đăng ký, đăng nhập, đăng xuất và khôi phục phiên qua JWT.
- Chặn truy cập dashboard khi chưa đăng nhập và tự đăng xuất khi token hết hạn.
- Dashboard lấy dữ liệu thật từ REST API, hiển thị tổng vị trí, vị trí trống, đã đặt và đang có xe.
- Sơ đồ bãi xe trực quan với màu và nhãn trạng thái; seed có 5 vị trí A01-A05.
- Lọc vị trí theo bãi, khu vực và trạng thái; chọn trực tiếp vị trí trống để đặt chỗ.
- Đặt chỗ bằng phương tiện của tài khoản, xem lượt đang hiệu lực, xem lịch sử và hủy lượt hợp lệ.
- Thêm và chỉnh sửa biển số, loại xe, hãng xe và màu xe.
- Xem lịch sử check-in/check-out.
- Quản trị viên quản lý vai trò/trạng thái người dùng, bãi xe, khu vực và vị trí.
- Giao diện responsive cho laptop và điện thoại, có loading, empty state, lỗi API và thử lại.

## Yêu cầu môi trường

- Node.js 20 trở lên.
- npm.
- PostgreSQL đang chạy trên máy hoặc Docker Desktop.

Trên Windows nên dùng `npm.cmd` nếu PowerShell chặn `npm.ps1`.

## Cấu hình

Tạo các file môi trường từ mẫu:

```powershell
Copy-Item .env.example .env
Copy-Item .env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
```

Kết nối PostgreSQL mặc định:

```text
postgresql://smart_parking:smart_parking_dev@localhost:5432/smart_parking
```

Nếu dùng PostgreSQL cài trực tiếp, tài khoản `smart_parking` phải là chủ sở hữu database và schema `public`:

```sql
CREATE ROLE smart_parking WITH LOGIN PASSWORD 'smart_parking_dev';
CREATE DATABASE smart_parking OWNER smart_parking;
ALTER SCHEMA public OWNER TO smart_parking;
GRANT ALL ON SCHEMA public TO smart_parking;
```

Nếu database đã tồn tại, không chạy lại `CREATE DATABASE`; chỉ cần kiểm tra quyền sở hữu.

Nếu dùng Docker:

```powershell
docker compose -f infra/docker-compose.yml up -d
```

## Chạy lần đầu

```powershell
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev
```

Mở:

- Web: `http://localhost:5173`
- API health: `http://localhost:4000/health`

## Tài khoản seed

Giá trị có thể thay đổi bằng biến môi trường trong `.env`.

```text
Quản trị viên: admin@example.com / Admin12345!
Người dùng:     user@example.com  / User12345!
```

Người tự đăng ký luôn nhận vai trò `USER`; chỉ quản trị viên mới có thể thay đổi vai trò qua API được bảo vệ.

## Lệnh kiểm tra

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run build
npm.cmd run test
```

Để chạy cả integration test với PostgreSQL:

```powershell
$env:RUN_DB_TESTS="true"
npm.cmd run test
```

Integration test chỉ dọn các bản ghi có định danh test, không xóa dữ liệu seed hoặc dữ liệu phát triển hiện tại.

## Phạm vi chưa triển khai

- WebSocket cập nhật trạng thái thời gian thực.
- Camera, ROI, OpenCV, YOLO và PaddleOCR.
- ESP32, cảm biến và MQTT.
- Tích hợp phần cứng hoặc dữ liệu camera thực tế.
