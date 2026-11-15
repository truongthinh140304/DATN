# Smart Parking Thesis

Đồ án tốt nghiệp **Xây dựng hệ thống bãi đỗ xe thông minh tích hợp IoT và Web thời gian thực**.

Dự án có backend tuần 4, React tuần 5, Camera AI tuần 6, OCR/đối chiếu tuần 7–8 và tuần 9: WebSocket có JWT, cảnh báo sai vị trí, lịch sử cảnh báo và xác nhận xe vào/ra. Đã thử camera trên một số mẫu; chưa kiểm định đầy đủ độ chính xác mô hình 4 ô. ESP32/MQTT/cảm biến ngoài phạm vi.

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

**Đặt chỗ → đối chiếu biển số:** xem [hướng dẫn xác minh xe đã đặt](docs/reservation-verification.md). Người dùng theo dõi ngay tại **Đặt chỗ → Xác minh xe đã đặt**; admin xem hai biển cạnh nhau trong **Camera AI**.

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

### Tuần 7–8

- Module tách riêng: detector vùng biển số, crop frame gốc, tiền xử lý, PaddleOCR 3.3.2, chuẩn hóa và đồng thuận nhiều frame.
- OCR thử độc lập bằng ảnh/webcam/video; chọn vùng thủ công khi chưa có model biển số. `yolo11n.pt` vẫn chỉ là model phương tiện, chưa chứng minh nhận được xe đồ chơi.
- Số ô ROI theo danh sách cấu hình (ví dụ 3–4 ô), không xóa dữ liệu ô đang có.
- Gắn biển số → đúng xe → đúng ROI; mơ hồ/chưa đọc rõ/mất camera không kết luận biển số.
- Migration bổ sung lưu nhận diện và snapshot đối chiếu `MATCH`/`MISMATCH`/`NO_RESERVATION`/`INSUFFICIENT`.
- Backend tự đối chiếu đúng ô và khoảng thời gian; giữ API key. ADMIN xem bảng lịch sử Camera AI trong Quản trị bằng nút tải lại; USER chỉ đọc occupancy, không biển số hay dữ liệu đặt chỗ của người khác.
- Không tự check-in/check-out hoặc thay trạng thái nghiệp vụ.

Hướng dẫn đầy đủ, nguồn model/giấy phép, cấu hình và giới hạn: [docs/week7-8-plates.md](docs/week7-8-plates.md).

Lệnh PowerShell nhanh (ảnh/video và UUID thật phải do bạn bổ sung):

```powershell
cd D:\DATN
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run dev
# Terminal khác:
cd D:\DATN\services\vision
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-ocr.txt
if (!(Test-Path config\plates.json)) { Copy-Item config\plates.example.json config\plates.json }
# Chọn vùng biển số trên ảnh do bạn chuẩn bị; đây là OCR thử độc lập:
.\.venv\Scripts\python.exe -m vision.plate_cli --config config\plates.json --image local-media\plate.jpg --select --save-regions
# Webcam thử OCR:
.\.venv\Scripts\python.exe -m vision.plate_cli --config config\plates.json --source 0 --select --save-regions
# Model riêng: detector.mode="model", modelPath=đường dẫn weights biển số thật,
# classIds khớp model. Không có weights biển số được cung cấp trong repository.
# Bật tích hợp: thêm "plateConfig": "plates.json" vào config\vision.json,
# cấu hình spots/parking_rois với UUID thật theo hướng dẫn trước khi chạy.
$env:VISION_API_KEY = Read-Host "Nhap khoa Vision trung API"
.\.venv\Scripts\python.exe -m vision --settings config\vision.json
```

Kiểm tra dữ liệu: đăng nhập ADMIN → Quản trị → Camera AI hoặc gọi GET `/api/vision/observations` với JWT. SQL kiểm tra chi tiết có trong hướng dẫn tuần 7–8. Migrate dùng `deploy`, không reset hoặc seed lại database.

### Chạy tích hợp với webcam USB (một xe hiện tại)

Thử một vùng quan sát gắn với A01 trước khi bố trí mô hình 3–4 ô. Đặt camera cố định và biển số nằm rõ trên xe. Không tự tạo đặt chỗ để ép kết quả khớp.

```powershell
cd D:\DATN
npm.cmd run dev
# Terminal khác: dùng tên webcam Windows đang nhận (hiện là USB Camera).
# VISION_API_KEY được đọc từ apps/api/.env, không ghi vào JSON hoặc in ra màn hình.
npm.cmd run vision:setup -- --codes A01 --camera-name "USB Camera" --backend dshow
# Space chốt hình; kéo khung quanh toàn bộ xe → Enter; kéo sát vùng biển → Enter.
# Khi hiệu chuẩn hoàn tất:
npm.cmd run vision:run
```

Mở `http://localhost:5173/dashboard?view=admin`, đăng nhập ADMIN → Camera AI → **Mới nhất theo ô** → **Tải lại camera**. `VISION_REPORTED` trong terminal xác nhận API nhận quan sát; `READ` chỉ có khi đủ mẫu OCR rõ và biển gắn được với một xe/một ô. Khi có 3–4 ô thật, chạy lại hiệu chuẩn với `--codes A01 A02 A03` hoặc thêm A04, không xóa các ô khác trong database. Xem [hướng dẫn chạy tích hợp](docs/week8-live.md).

### Tuần 9 — WebSocket, cảnh báo và xe vào/ra

- WebSocket qua Socket.IO, xác thực JWT, kiểm tra Origin, ngắt khi token hết hạn; tự kết nối lại và lấy snapshot REST khi mạng phục hồi. Camera/cảnh báo tự cập nhật, không cần bấm tải lại khi kết nối trực tiếp đang hoạt động.
- Cảnh báo sai ô khi biển đọc rõ nhưng lượt đặt/phiên đang gửi thuộc ô khác; phân biệt biển khác đặt chỗ và xe chưa có đặt chỗ/phiên phù hợp. Lưu lịch sử, gộp quan sát lặp và tiếp nhận cảnh báo bằng tài khoản ADMIN.
- Màn hình **Xe vào / ra** cho check-in đặt chỗ hiệu lực hoặc xe vào trực tiếp; check-out cần người dùng xác nhận xe thực sự rời bãi. Transaction và ràng buộc DB chống thao tác trùng/đồng thời, ghi audit log.
- Camera không tự check-in/check-out, không ghi đè trạng thái nghiệp vụ. EMPTY/UNKNOWN không tự kết thúc phiên gửi xe hoặc xóa cảnh báo.

```powershell
cd D:\DATN
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run dev
# Terminal khác, sau khi đã hiệu chuẩn camera:
npm.cmd run vision:run
```

ADMIN → Quản trị: nhãn **Trực tiếp**, cảnh báo vị trí và bảng nhận diện tự cập nhật. **Xe vào / ra**: chọn lượt đặt hiệu lực hoặc vào trực tiếp; xác nhận check-out sau khi kiểm tra thực tế. Hướng dẫn đầy đủ và giới hạn: [docs/week9-realtime.md](docs/week9-realtime.md).

### Tuần 10 — Kiểm thử tích hợp toàn hệ thống

```powershell
cd D:\DATN
npm.cmd install
npm.cmd run test:browser:install
# DB cần chạy và đã migrate; không reset hoặc seed lại dữ liệu.
npm.cmd run test:week10
# Thêm PaddleOCR thật trên chữ tổng hợp và kiểm tra đọc khung webcam nếu có:
npm.cmd run test:week10 -- --ocr --camera
```

Lệnh tuần 10 chạy format/lint/build, test PostgreSQL/WebSocket, Python và trình duyệt Chromium trên API/web cổng thử riêng (4101/5174). Luồng trình duyệt đi từ đặt chỗ → Python reporter → DB → WebSocket → nội dung web → check-in/out; detection/OCR trong luồng này là fixture có kiểm soát, không phải bằng chứng độ chính xác camera. Fixture có UUID riêng, tự dọn sau mỗi test. Báo cáo JSON/Markdown/HTML và ảnh test nằm trong `artifacts/week10/<thời điểm>/`, đã được Git ignore.

Đã bổ sung hồi quy và sửa lỗi đặt xe/khu/bãi ngừng hoạt động, tạo lượt đã hết hạn, frame tương lai chiếm snapshot mới nhất, phát sự kiện từ router lồng nhau và giữ bộ lọc camera khi cập nhật nền. Hướng dẫn, ma trận kiểm thử và phần thực nghiệm còn cần: [docs/week10-integration.md](docs/week10-integration.md).

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
- Kiểm chứng đầy đủ WebSocket/cảnh báo trên mô hình thật khi mất mạng, đổi góc camera và di chuyển xe giữa các ô.
- Kiểm định PaddleOCR/gán ô trên ảnh biển số và mô hình xe đồ chơi thật; cần model phát hiện biển số riêng nếu không chọn vùng thủ công.
- ESP32, cảm biến và MQTT.
- Tự động check-in/check-out từ Camera AI.

Không commit `.env`, mật khẩu/URL RTSP, video, ảnh cá nhân hoặc model weights.
