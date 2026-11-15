# Bàn giao tuần 7–8 · 29/10/2026

Đã triển khai trực tiếp trong D:\DATN, tuần 7 trước rồi tuần 8. Không commit, không sửa .env, không reset database, không xóa ô để ép mô hình còn 3–4 ô. Không thêm ESP32/MQTT/cảm biến hoặc WebSocket.

## Kết quả

- Tuần 7: phát hiện vùng biển số riêng bằng model thật do người dùng cung cấp hoặc vùng chọn thủ công thử nghiệm; crop từ frame gốc; tiền xử lý; PaddleOCR; chuẩn hóa không đoán O/0, I/1; đồng thuận nhiều frame có hết hạn; lệnh ảnh/webcam/video; không bịa kết quả khi thất bại.
- Tuần 8: ghép biển → một xe → một ROI rõ ràng, API key ingest tương thích tuần 6, confidence riêng, đối chiếu backend đúng ô/thời gian, snapshot lịch sử và bảng ADMIN tải lại bằng nút. USER vẫn được xem occupancy cơ bản, không nhận dữ liệu nhận diện của người khác. Không tự thay đổi nghiệp vụ.
- `roi_tool` không còn bắt buộc 5 ô; chọn danh sách 3–4 ô trong file cấu hình với UUID thật, giữ các ô còn lại trong DB.
- Migration `202610290001_plate_recognition` đã áp dụng thành công lên PostgreSQL `smart_parking` tại localhost; dữ liệu cũ giữ nguyên với giá trị mặc định bảo thủ.

## Tệp thêm/sửa

| Nhóm                                               | Tệp                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vision: module mới trong `services/vision/vision/` | `plate_detector.py`, `plate_preprocess.py`, `plate_ocr.py`, `plate_text.py`, `plate_temporal.py`, `plate_pipeline.py`, `plate_cli.py`                                     |
| Vision: tích hợp vào luồng cũ                      | `services/vision/vision/app.py`, `services/vision/vision/config.py`, `services/vision/vision/reporter.py`, `services/vision/vision/roi_tool.py`                           |
| Vision: cấu hình/thư viện                          | `services/vision/config/plates.example.json`, `services/vision/requirements-ocr.txt`, `services/vision/requirements-dev.txt`                                              |
| Vision: kiểm thử mới                               | `services/vision/tests/test_plates.py`, `services/vision/tests/test_plate_pipeline.py`, `services/vision/tests/test_ocr_runtime.py`                                       |
| Prisma/PostgreSQL                                  | `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/202610290001_plate_recognition/migration.sql`                                                                |
| Backend                                            | `apps/api/src/modules/vision/plate-matching.ts`, `apps/api/src/modules/vision/vision.routes.ts`                                                                           |
| Backend: kiểm thử                                  | `apps/api/test/plate-matching.test.ts`, `apps/api/test/vision.test.ts`, `apps/api/test/api.test.ts`                                                                       |
| Web                                                | `apps/web/src/components/CameraObservations.tsx`, `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/styles.css`                                                       |
| Tài liệu/Git                                       | `README.md`, `services/vision/README.md`, `docs/week7-8-plates.md`, `docs/week7-8-handover.md`, `docs/api.md`, `docs/architecture.md`, `docs/data-model.md`, `.gitignore` |

## Đã kiểm tra

| Kiểm tra                                 | Kết quả                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `npm.cmd run db:generate`                | Đạt, Prisma Client 5.22.0                                                       |
| `npm.cmd run db:migrate`                 | Đạt, migration bổ sung đã deploy, không reset                                   |
| Prisma validate                          | Schema hợp lệ                                                                   |
| `RUN_DB_TESTS=true; npm.cmd test`        | **17/17 test đạt**, gồm PostgreSQL thực                                         |
| `npm.cmd run format:check`               | Đạt                                                                             |
| `npm.cmd run lint`                       | API và Web đạt                                                                  |
| `npm.cmd run build`                      | TypeScript API, React/TypeScript và Vite đạt                                    |
| Python unittest với `RUN_OCR_TESTS=true` | **22/22 test đạt**                                                              |
| Python compileall                        | Đạt                                                                             |
| Ruff `--isolated --select E9,F`          | Đạt; đây là kiểm tra lỗi cú pháp/tên biến, không phải toàn bộ rule style Ruff   |
| `pip check`                              | Không có yêu cầu thư viện bị xung đột theo metadata                             |
| CLI ảnh chữ tổng hợp                     | Đọc được text; ảnh đơn có 1 mẫu, chưa báo ổn định                               |
| CLI MP4 chữ tổng hợp 4 frame             | Đọc được text; frame thứ 3 trở đi đạt đồng thuận                                |
| Git ignore                               | .venv, output ảnh/video/cấu hình thử, config thật và weights được loại khỏi Git |

Test API bao phủ xác thực key/JWT, confidence không hợp lệ, ô không tồn tại, bỏ qua kết luận client, chuẩn hóa backend, khớp/không khớp/không có đặt/hết hạn/thiếu thông tin và ẩn dữ liệu với USER. Test DB kiểm tra không đổi trạng thái đặt chỗ/ô/session khi nhận camera; đăng ký, phân quyền, quản lý xe/bãi, chống đặt trùng và check-in/check-out thủ công vẫn hoạt động.

Test Python bao phủ chuẩn hóa, OCR rỗng/hai dòng, consensus/hết hạn/mất camera, nhiều xe/biển/ROI mơ hồ, xe không có vùng biển, không phát hiện xe, crop gốc không sửa frame, ảnh mờ và cấu hình 3/4/5 ô. Test runtime dùng PaddleOCR thật trên ảnh chữ vẽ bằng OpenCV; những test gán xe/ô dùng detection giả để kiểm tra logic.

Môi trường đã tạo: `services/vision/.venv`, Python 3.11.9 x64; PaddleOCR 3.3.2, PaddlePaddle CPU 3.2.0, OpenCV 4.10.0. OCR model chính thức được tải trong cache người dùng, không nằm trong mã nguồn. Ảnh/video chữ tổng hợp nằm trong `services/vision/output/`, không được dùng làm minh chứng nhận diện xe thực.

## Chưa kiểm tra được / cần bổ sung

- Chưa có ảnh/video biển số chụp thực, camera của mô hình và model detector biển số riêng. Chưa đo độ chính xác hoặc FPS thực tế, chưa xác nhận YOLO COCO nhận được xe đồ chơi 1:32 ở 20–25 cm.
- Chưa thao tác chuột chọn vùng trên camera thật; chưa kiểm tra giao diện bằng trình duyệt ở nhiều kích thước màn hình. Giao diện đã qua TypeScript, lint và build; REST phía sau được kiểm thử.
- Ghép theo hình học ROI và lịch sử ngắn, chưa có tracker định danh xe. Xe đổi chỗ rất nhanh, che khuất hoặc giữ cùng bounding box cần kiểm tra trước khi sử dụng kết luận.
- Kết quả đối chiếu dùng trạng thái đặt chỗ đang lưu khi ingest. Không tái dựng mọi thay đổi đặt chỗ trong quá khứ khi replay frame cũ; snapshot gốc không bị sửa theo trạng thái mới.

Để chạy thử: làm theo [hướng dẫn PowerShell](week7-8-plates.md), bổ sung ảnh/video vào thư mục đã ignore, chọn vùng thủ công để thử OCR trước; cấu hình 3–4 ROI bằng UUID thật và thêm `plateConfig` để ghép luồng đầy đủ. Muốn tự tìm biển số cần cung cấp/huấn luyện model detector riêng có nguồn và giấy phép rõ ràng. `yolo11n.pt` hiện tại không phải model biển số.
