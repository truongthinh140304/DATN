# Bàn giao tuần 9 · 30/10/2026

## Kết quả

- Đã triển khai Socket.IO WebSocket có JWT/Origin, ngắt khi JWT hết hạn, tự nối lại ở client và refetch snapshot khi nối lại. Chỉ phát invalidation sau commit; dữ liệu cá nhân/biển số không được broadcast.
- Camera/latest và cảnh báo tự cập nhật; lịch sử nhận diện giữ trang đang xem. Giữ nút tải lại khi offline.
- Cảnh báo sai ô/khác biển đặt chỗ/không có đặt chỗ hoặc phiên phù hợp; lưu lịch sử, gộp lặp, tiếp nhận bởi ADMIN và giải quyết khi có bằng chứng đủ tin cậy. Không kết thúc cảnh báo/phiên chỉ vì EMPTY hoặc mất camera.
- Màn hình Xe vào / ra; kiểm tra đặt chỗ còn hiệu lực, quyền sở hữu, xe/ô/khu/bãi hoạt động, chống trùng check-in/out và hủy đặt chỗ đụng check-in; audit log trong cùng transaction.
- Migration `202610300001_week9_alerts` đã áp dụng bằng migrate deploy. Không reset database, seed lại hoặc xóa các ô/nghiệp vụ cũ. Không thêm ESP32/MQTT/cảm biến.

## Tệp thêm/sửa trong tuần 9

| Nhóm               | Tệp                                                                                                                                                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Realtime backend   | `apps/api/src/realtime/events.ts`, `apps/api/src/realtime/server.ts`, `apps/api/src/server.ts`, `apps/api/src/app.ts`                                                                                                                                                                         |
| Cảnh báo và ingest | `apps/api/src/modules/vision/alert.service.ts`, `apps/api/src/modules/vision/alerts.routes.ts`, `apps/api/src/modules/vision/vision.routes.ts`, `apps/api/src/utils/transaction-retry.ts`                                                                                                     |
| Nghiệp vụ          | `apps/api/src/modules/sessions/sessions.routes.ts`, `apps/api/src/modules/reservations/reservations.routes.ts`                                                                                                                                                                                |
| Prisma             | `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/202610300001_week9_alerts/migration.sql`                                                                                                                                                                                         |
| Web                | `apps/web/src/realtime.tsx`, `apps/web/src/main.tsx`, `apps/web/src/api.ts`, `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/components/CameraObservations.tsx`, `apps/web/src/components/VisionAlerts.tsx`, `apps/web/src/components/SessionOperations.tsx`, `apps/web/src/styles.css` |
| Test               | `apps/api/test/realtime.test.ts`, `apps/api/test/week9.test.ts`, `apps/api/test/vision.test.ts`                                                                                                                                                                                               |
| Dependency         | `apps/api/package.json`, `apps/web/package.json`, `package-lock.json`                                                                                                                                                                                                                         |
| Tài liệu           | `README.md`, `docs/api.md`, `docs/data-model.md`, `docs/architecture.md`, `docs/week8-live.md`, `docs/week9-realtime.md`, `docs/week9-handover.md`                                                                                                                                            |

## Kiểm tra đã chạy

- Prisma generate và migrate deploy thành công.
- `RUN_DB_TESTS=true; npm.cmd test`: **35/35 test đạt** trên PostgreSQL, gồm 4 test kết nối WebSocket thực và 11 test tuần 9 về trạng thái/cảnh báo/concurrency.
- `npm.cmd run build`, `npm.cmd run lint`, `npm.cmd run format:check`: đã kiểm tra trong quá trình bàn giao.
- Kiểm tra với API/web đang chạy: đăng nhập tài khoản demo thành công; Socket.IO báo transport `websocket`, kết nối lại thành công; API latest trả 200 và đủ A01–A04; API cảnh báo trả 200; web trả 200. Không tạo observation giả trong database thật để làm minh chứng.
- Test concurrency có chủ ý kích hoạt unique constraint/write conflict; API trả 409 cho thao tác thua hoặc thử lại transaction ingest. Các thông báo `prisma:error` tương ứng không phải test thất bại.

Test dùng fixture riêng có UUID/camera/email/bãi riêng; phần dọn test chỉ áp dụng cho fixture đó. Không thay đổi Python/ROI đã hiệu chuẩn trong tuần 9.

## Chưa kiểm tra được / giới hạn

- Webcam USB thực nghiệm không còn có mặt khi kiểm tra thiết bị cuối lượt; chỉ thấy webcam tích hợp, camera điện thoại ảo và OBS. Vì vậy chưa thử lại camera → cảnh báo → giao diện trực tiếp tuần 9 bằng xe thật trong lần bàn giao này.
- Chưa thao tác xác minh giao diện bằng trình duyệt ở mọi kích thước màn hình; đã qua TypeScript, lint/build và API/socket test. Cần người dùng thực nghiệm hai tab, mất/kết nối mạng và xe đúng/sai ô để chụp báo cáo.
- Một tiến trình API; chưa cấu hình Redis adapter/durable outbox cho nhiều máy. Nếu tiến trình dừng ngay sau commit trước phát sự kiện, client refetch khi reconnect hoặc dùng tải lại sẽ lấy dữ liệu bền vững từ DB.
- `npm audit` tại lúc kiểm tra báo **11 cảnh báo dependency** (4 moderate, 4 high, 3 critical), trong các dependency hiện có như Vitest/Vite/Zod và gói gián tiếp; Socket.IO không nằm trong danh sách gói bị báo của lần kiểm tra. Chưa nâng major các công cụ này hoặc chạy audit fix --force vì sẽ mở rộng phạm vi và có thể phá tương thích. Cần xử lý riêng trước khi triển khai ra ngoài môi trường phát triển.
- OCR/YOLO vẫn phụ thuộc góc chụp, ánh sáng, vùng biển chọn thủ công và dữ liệu xe đồ chơi. Không có cam kết độ chính xác từ các test phần mềm.

Lệnh chạy và checklist thực nghiệm nằm trong [week9-realtime.md](week9-realtime.md). Chỉ xác nhận xe thực sự vào/ra trên màn hình nghiệp vụ; không lấy chuyển động khỏi ô làm bằng chứng đã ra bãi.
