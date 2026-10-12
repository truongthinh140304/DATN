# Architecture

## Week 4 Scope

- REST API bang Express.
- PostgreSQL lam nguon du lieu chinh.
- Prisma quan ly schema, migration va transaction.
- JWT cho dang nhap va bao ve API.
- React/Vite tao giao dien nen tang toi thieu.

## Runtime Flow

1. User/Admin dang nhap qua `/api/auth/login`.
2. Client gui `Authorization: Bearer <token>` cho API can bao ve.
3. Middleware xac thuc token, tai user tu DB va kiem tra `isActive`.
4. Admin quan ly users, parking lots, areas, spots.
5. User quan ly vehicle cua minh va dat/huy cho.
6. Check-in/check-out chay trong transaction de cap nhat reservation, session va spot status cung luc.

## Not Yet Implemented

- WebSocket realtime.
- Camera stream, ROI, OCR bien so.
- YOLO/PaddleOCR/OpenCV pipeline.
- ESP32, cam bien, MQTT.

Nhung phan nay can thiet bi, du lieu mau va quy dinh tich hop truoc khi khang dinh hoan thanh.
