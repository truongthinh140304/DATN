# Data Model

## Các bảng chính

- `users`: tài khoản, role `USER`/`ADMIN`, mật khẩu băm bằng bcrypt.
- `vehicles`: biển số và loại xe, thuộc một user.
- `parking_lots`: bãi xe.
- `parking_areas`: khu/tầng trong bãi xe.
- `parking_spots`: vị trí đỗ và trạng thái nghiệp vụ.
- `reservations`: lượt đặt chỗ.
- `parking_sessions`: lượt gửi xe thực tế, check-in/check-out.
- `audit_logs`: nhật ký hành động quan trọng.
- `camera_observations`: lịch sử quan sát vị trí từ Vision Service.
- `vision_alerts`: lịch sử cảnh báo tuần 9, active key gộp cùng sự cố; loại WRONG_SPOT/PLATE_MISMATCH/UNRESERVED_VEHICLE và trạng thái OPEN/ACKNOWLEDGED/RESOLVED. Các ID/biển dự kiến là snapshot; không tự tác động reservation/session. Migration bổ sung không xóa dữ liệu cũ.

## Trạng thái nghiệp vụ

`parking_spots.status` gồm `AVAILABLE`, `RESERVED`, `OCCUPIED`, `INACTIVE`. Bảng reservation/session là nguồn ranh giới nghiệp vụ; API cập nhật spot trong transaction:

- Đặt chỗ: `AVAILABLE` thành `RESERVED`.
- Hủy đặt chỗ: `RESERVED` thành `AVAILABLE`.
- Check-in: `RESERVED` hoặc `AVAILABLE` thành `OCCUPIED`.
- Check-out: `OCCUPIED` thành `AVAILABLE`.

Ràng buộc PostgreSQL đảm bảo:

- Một spot có tối đa một reservation hiệu lực (`PENDING`, `CONFIRMED`, `CHECKED_IN`).
- Một vehicle có tối đa một reservation hiệu lực.
- Một spot có tối đa một parking session `ACTIVE`.
- Một vehicle có tối đa một parking session `ACTIVE`.

## Quan sát camera

`camera_observations` gồm:

- `camera_id`: định danh nguồn camera.
- `spot_id`: khóa ngoại tới `parking_spots`.
- `occupancy_status`: `EMPTY`, `OCCUPIED` hoặc `UNKNOWN`.
- `confidence`: độ tin cậy từ 0 đến 1.
- `observed_at`: thời điểm frame được quan sát.
- `received_at`: thời điểm API nhận dữ liệu.
- `metadata`: model, device và kích thước frame khi có.

Một spot có nhiều quan sát theo thời gian. Bảng này không ghi đè `parking_spots.status`, không tạo/hủy reservation và không tạo/kết thúc parking session.

Migration bổ sung tuần 7–8 thêm `recognition_status`, `plate_raw`, `plate_normalized`, `vehicle_confidence`, `plate_detection_confidence`, `association_confidence`, `ocr_confidence`, `plate_samples`, `match_status`, `match_reason`, `matched_reservation_id`, `expected_plate`. Hai trường cuối là snapshot không cascade theo đặt chỗ. Quan sát cũ giữ nguyên, mặc định NOT_REQUESTED/INSUFFICIENT. Xem [quy tắc và hợp đồng](week7-8-plates.md).
