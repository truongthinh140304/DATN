# Smart Parking Thesis

Đồ án tốt nghiệp **Xây dựng hệ thống bãi đỗ xe thông minh tích hợp IoT và Web thời gian thực**.

Dự án hiện có nền tảng backend tuần 4, ứng dụng React tuần 5 và module Camera AI tuần 6. Module tuần 6 hỗ trợ OpenCV, YOLO và ROI/polygon; PaddleOCR, ESP32, MQTT và WebSocket chưa được triển khai.

## Cấu trúc dự án

```text
apps/
  api/        Express, Prisma, PostgreSQL và API nhận quan sát camera
  web/        React/Vite, xác thực và dashboard responsive
services/
  vision/     Python, OpenCV, Ultralytics YOLO và công cụ chọn ROI
docs/         Kiến trúc, mô hình dữ liệu, API và hướng dẫn tuần 6
infra/        Docker Compose PostgreSQL cho môi trường phát triển
```

## Chức năng đã hoàn thành

### Tuần 4-5

- Đăng ký, đăng nhập, đăng xuất và phân quyền `USER`/`ADMIN` bằng JWT.
- Dashboard lấy dữ liệu từ REST API, hiển thị tổng số vị trí và sơ đồ A01-A05.
- Quản lý phương tiện; đặt/hủy chỗ; xem lịch sử check-in/check-out.
- Admin quản lý người dùng, bãi xe, khu vực và vị trí.
- Giao diện responsive, có loading, empty state, lỗi API và thử lại.
- Transaction và ràng buộc database ngăn hai lượt hợp lệ cùng chiếm một vị trí.

### Tuần 6

- Đọc webcam laptop, file MP4 hoặc RTSP bằng OpenCV.
- Phát hiện phương tiện bằng Ultralytics YOLO, mặc định model nhỏ `yolo11n.pt` và CPU.
- Công cụ chọn polygon bằng chuột cho A01-A05, lưu tọa độ chuẩn hóa trong JSON.
- Ánh xạ detection vào vị trí bằng độ giao nhau và các điểm đại diện ở đáy xe.
- Tránh gán một xe vào nhiều ô khi kết quả mơ hồ; ổn định trạng thái qua nhiều frame.
- Hiển thị polygon, bounding box, `EMPTY`/`OCCUPIED`/`UNKNOWN`, confidence, FPS và số ô có xe.
- API key riêng cho Vision Service; lưu kết quả vào `camera_observations`.
- Kết quả camera không tự thay đổi đặt chỗ, check-in/check-out hoặc `parking_spots.status`.

Hướng dẫn chi tiết: [docs/week6-vision.md](docs/week6-vision.md).

## Yêu cầu môi trường

- Node.js 20 trở lên và npm.
- PostgreSQL chạy trực tiếp hoặc qua Docker Desktop.
- Python 3.10-3.12 cho Vision Service (khuyến nghị 3.11).

Trên Windows nên dùng `npm.cmd` nếu PowerShell chặn `npm.ps1`.

## Cấu hình Web/API

Tạo file môi trường từ mẫu nếu chưa có. Không ghi đè file `.env` đang dùng:

```powershell
Copy-Item .env.example .env
Copy-Item .env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
```

Kết nối PostgreSQL mặc định:

```text
postgresql://smart_parking:smart_parking_dev@localhost:5432/smart_parking
```

Với PostgreSQL cài trực tiếp, tài khoản `smart_parking` cần sở hữu database và schema `public`:

```sql
CREATE ROLE smart_parking WITH LOGIN PASSWORD 'smart_parking_dev';
CREATE DATABASE smart_parking OWNER smart_parking;
ALTER SCHEMA public OWNER TO smart_parking;
GRANT ALL ON SCHEMA public TO smart_parking;
```

Nếu database đã tồn tại, không chạy lại `CREATE DATABASE`. Với Docker:

```powershell
docker compose -f infra/docker-compose.yml up -d
```

## Chạy Web/API

Lần đầu:

```powershell
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev
```

Mở web tại `http://localhost:5173`, API health tại `http://localhost:4000/health`.

Tài khoản seed mặc định, có thể đổi bằng biến môi trường:

```text
Quản trị viên: admin@example.com / Admin12345!
Người dùng:     user@example.com  / User12345!
```

Người tự đăng ký luôn có vai trò `USER`.

## Chạy Vision Service

```powershell
cd D:\DATN\services\vision
py -3.11 -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item config\vision.example.json config\vision.json
Copy-Item config\spots.example.json config\spots.json
```

Sau khi thay UUID thật A01-A05 trong `spots.json`, vẽ ROI và chạy:

```powershell
python -m vision.roi_tool --source 0 --spots config\spots.json --output config\parking_rois.json
$env:VISION_API_KEY="giong-gia-tri-trong-apps-api-env"
python -m vision --settings config\vision.json
```

Xem [hướng dẫn tuần 6](docs/week6-vision.md) để dùng MP4/RTSP và cấu hình API key.

## Kiểm tra

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run build
npm.cmd run test

cd services\vision
python -m unittest discover -s tests -v
python -m compileall -q vision tests
```

Để chạy integration test PostgreSQL:

```powershell
$env:RUN_DB_TESTS="true"
npm.cmd run test
```

Test chỉ dọn các bản ghi có định danh test, không xóa dữ liệu seed hoặc dữ liệu phát triển.

## Phạm vi chưa triển khai

- Kiểm định độ chính xác trên camera/video bãi xe thực tế và hiệu chỉnh ROI tại hiện trường.
- Hiển thị quan sát camera theo thời gian thực trên React bằng WebSocket.
- PaddleOCR và đối chiếu biển số.
- ESP32, cảm biến và MQTT.
- Tự động check-in/check-out từ Camera AI.

Không commit `.env`, mật khẩu/URL RTSP, video, ảnh cá nhân hoặc model weights.
