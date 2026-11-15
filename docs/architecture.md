# Architecture

## Thành phần

- `apps/web`: React/Vite, giao diện người dùng và quản trị.
- `apps/api`: Express REST API, JWT, Prisma và PostgreSQL.
- `services/vision`: tiến trình Python/OpenCV/YOLO chạy độc lập.
- PostgreSQL: dữ liệu nghiệp vụ và lịch sử quan sát camera.

## Luồng Web và nghiệp vụ

1. User/Admin đăng nhập qua `/api/auth/login`.
2. React gửi `Authorization: Bearer <token>` cho API được bảo vệ.
3. Middleware xác thực token, tải user và kiểm tra `isActive`.
4. Admin quản lý users, parking lots, areas và spots.
5. User quản lý vehicle, đặt/hủy chỗ và xem lịch sử.
6. Check-in/check-out chạy trong transaction để đồng bộ reservation, session và spot status.

## Luồng Camera AI tuần 6

1. OpenCV đọc webcam, MP4 hoặc RTSP.
2. YOLO trả về bounding box và confidence của phương tiện.
3. Vision Service so khớp detection với polygon A01-A05 và làm ổn định qua nhiều frame.
4. Ứng dụng Python hiển thị overlay và gửi batch quan sát tới `POST /api/vision/observations`.
5. Middleware `x-vision-api-key` xác thực nguồn gửi.
6. API lưu kết quả vào `camera_observations`; client có JWT có thể đọc lịch sử/latest.

Đây là hai nguồn trạng thái tách biệt:

- `parking_spots.status`: trạng thái nghiệp vụ do đặt chỗ và phiên gửi xe quản lý.
- `camera_observations.occupancy_status`: điều camera quan sát được tại một thời điểm.

Sự khác nhau giữa hai nguồn chỉ là tín hiệu để cảnh báo/đối chiếu về sau. Camera không trực tiếp sửa trạng thái nghiệp vụ.

## Tuần 7–8

Plate detector riêng hoặc vùng thủ công thử nghiệm → crop frame gốc → tiền xử lý → PaddleOCR → đồng thuận có TTL. Chỉ ghép biển với một xe và một ROI rõ ràng. API key ingest lưu confidence riêng, text raw và normalized (backend tự chuẩn hóa), đối chiếu đúng ô/thời điểm với reservation trong transaction RepeatableRead và lưu snapshot. Không thay đổi trạng thái nghiệp vụ. ADMIN xem bảng lịch sử bằng nút tải lại; USER chỉ nhận occupancy đã lược bỏ nhận diện/metadata.

Chi tiết và giới hạn thực nghiệm: [week7-8-plates.md](week7-8-plates.md).

## Tuần 9

WebSocket có JWT, invalidation sau commit và REST snapshot có phân quyền; xem [hướng dẫn tuần 9](week9-realtime.md). Cảnh báo được lưu và gộp theo camera/ô/biển, ADMIN tiếp nhận; check-in/out do người dùng xác nhận và chạy trong transaction. Mất camera không kết thúc phiên gửi xe.

## Chưa triển khai

- Kiểm định nhận diện biển số/xe đồ chơi trên dữ liệu thực và model detector biển số đã huấn luyện.
- Tự động check-in/check-out từ kết quả AI.
- ESP32, cảm biến và MQTT.

Các phần này cần thiết bị, dữ liệu thực tế và quy tắc nghiệp vụ trước khi đánh giá hoàn thành.
