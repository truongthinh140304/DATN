# API Guide

Base URL: `http://localhost:4000`

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
