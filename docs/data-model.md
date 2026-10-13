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
