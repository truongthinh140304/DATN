# API Guide

Base URL: `http://localhost:4000`

## Xác minh xe của lượt đặt

`GET /api/reservations/:id/verification` yêu cầu JWT, chủ lượt đặt hoặc ADMIN. Trả về `reservationId`, `spotId`, `spotCode`, `expectedPlate`, `matchStatus`, `reason`, `observation`. Backend đối chiếu quan sát mới tại đúng ô và khoảng thời gian của lượt đặt; không nhận kết luận từ client. USER chỉ được thấy biển camera trùng xe mình; biển khác được ẩn (`plateHidden: true`); ADMIN xem đầy đủ. Frame cũ quá 60 giây hoặc lượt không còn hiệu lực trả `INSUFFICIENT`. Không tự check-in/check-out. Chi tiết: [hướng dẫn xác minh](reservation-verification.md).

## Auth

- `POST /api/auth/register`: dang ky user thuong. Server luon gan role `USER`.
- `POST /api/auth/login`: tra ve `accessToken`.
- `GET /api/auth/me`: thong tin tai khoan hien tai.

## Admin Users

Can role `ADMIN`.

- `GET /api/users?page=1&pageSize=20&q=...`
- `POST /api/users`
- `PATCH /api/users/:id`

## Vehicles

Can dang nhap.

- `GET /api/vehicles?page=1&pageSize=20&q=...`
- `POST /api/vehicles`
- `PATCH /api/vehicles/:id`

User chi thay/sua xe cua minh; admin thay tat ca.

## Parking

Can dang nhap; tao/sua can admin.

- `GET /api/parking/lots`
- `POST /api/parking/lots`
- `PATCH /api/parking/lots/:id`
- `GET /api/parking/areas?lotId=...`
- `POST /api/parking/areas`
- `PATCH /api/parking/areas/:id`
- `GET /api/parking/spots?areaId=...&status=AVAILABLE`
- `POST /api/parking/spots`
- `PATCH /api/parking/spots/:id`

## Reservations

- `GET /api/reservations`
- `POST /api/reservations`
- `POST /api/reservations/:id/cancel`

Body dat cho:

```json
{
  "vehicleId": "uuid",
  "spotId": "uuid",
  "startsAt": "2026-09-27T08:00:00.000Z",
  "expiresAt": "2026-09-27T08:30:00.000Z"
}
```

## Sessions

- `GET /api/sessions?status=ACTIVE`
- `POST /api/sessions/check-in`
- `POST /api/sessions/:id/check-out`

Body check-in:

```json
{
  "vehicleId": "uuid",
  "spotId": "uuid",
  "reservationId": "uuid optional",
  "notes": "optional"
}
```

## Camera observations

Tuần 9 bổ sung WebSocket có JWT và REST cảnh báo dành riêng ADMIN: `GET /api/vision/alerts`, `POST /api/vision/alerts/:id/acknowledge`. Lịch sử/cảnh báo không tự đổi trạng thái nghiệp vụ. Check-in hiện kiểm tra thời hạn/CONFIRMED, check-out và hủy đặt chỗ dùng claim trong transaction để ngăn xử lý đồng thời. Chi tiết: [week9-realtime.md](week9-realtime.md).

### Gửi từ Vision Service

`POST /api/vision/observations` dùng header `x-vision-api-key`, không dùng tài khoản người dùng. Khóa phải trùng `VISION_API_KEY` của API.

```json
{
  "observations": [
    {
      "cameraId": "parking-camera-01",
      "spotId": "uuid",
      "occupancyStatus": "OCCUPIED",
      "confidence": 0.88,
      "timestamp": "2026-10-13T10:30:00.000Z",
      "metadata": { "detector": "yolo11n.pt", "device": "cpu" }
    }
  ]
}
```

API trả `202 { "accepted": 1 }`. Batch nhận tối đa 50 quan sát. Endpoint lưu lịch sử camera và kết quả đối chiếu đặt chỗ tuần 8, không thay đổi `parking_spots.status`. Các trường mới, ngưỡng confidence và quy tắc đối chiếu: [hợp đồng tuần 7–8](week7-8-plates.md).

### Đọc quan sát

Cần JWT hợp lệ:

ADMIN xem đầy đủ nhận diện; USER chỉ thấy các trường occupancy cơ bản, không thấy biển số, liên kết đặt chỗ hoặc metadata.

- `GET /api/vision/observations?page=1&pageSize=20&cameraId=...&spotId=...&occupancyStatus=OCCUPIED`
- `GET /api/vision/observations/latest?cameraId=parking-camera-01`
