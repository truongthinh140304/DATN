# Bàn giao tuần 10

Đã bổ sung bộ kiểm thử tích hợp có thể chạy lại bằng PowerShell tại `D:\DATN`:

```powershell
npm run test:week10 -- --ocr --camera
```

Hướng dẫn cài trình duyệt, cấu hình, đọc báo cáo và ma trận thực nghiệm: [week10-integration.md](week10-integration.md).

## Phạm vi thay đổi

| File/nhóm file                                                                           | Thay đổi tuần 10                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright.config.ts`, `tests/e2e/system.spec.ts`                                       | Chromium chạy web/API ở cổng riêng; kiểm tra luồng đặt chỗ, Python reporter, lưu DB, đối chiếu, cảnh báo, realtime, check-in/out thủ công, nhiều tab, reconnect và mobile |
| `apps/api/test/helpers/week10-fixture.ts`                                                | Tạo tài khoản/bãi/bốn ô/xe thử riêng theo UUID; cleanup trong phạm vi fixture                                                                                             |
| `apps/api/test/week10.test.ts`                                                           | Sáu ca hồi quy điều kiện đặt, chống trùng đồng thời, sự kiện route lồng nhau và frame tương lai                                                                           |
| `services/vision/tests/integration_bridge.py`                                            | Chạy ROI, temporal, consensus, chuẩn hóa và HTTP reporter thật bằng detection/OCR điều khiển; chỉ cho gửi vào fixture                                                     |
| `services/vision/vision/preflight.py`                                                    | Liệt kê nguồn camera, kiểm tra cấu hình/đọc frame tùy chọn, không lưu ảnh hoặc khẳng định nhận diện chính xác                                                             |
| `scripts/test-week10.mjs`, `package.json`, `package-lock.json`                           | Lệnh chạy tổng hợp và báo cáo theo timestamp; thêm Playwright                                                                                                             |
| `apps/api/src/modules/reservations/reservations.routes.ts`                               | Từ chối xe/khu/bãi ngừng hoạt động và đặt mới đã hết hạn; giữ kiểm tra trạng thái trong transaction                                                                       |
| `apps/api/src/app.ts`, `apps/api/src/config/env.ts`, `.env.example`                      | Phát sự kiện đúng đường dẫn đầy đủ sau commit; cấu hình quota HTTP (mặc định 120, test riêng 1000)                                                                        |
| `apps/api/src/modules/vision/vision.routes.ts`, `alert.service.ts`                       | Frame vượt quá cửa sổ tương lai 30 giây vẫn lưu lịch sử nhưng không chiếm latest hoặc chặn cảnh báo hiện tại                                                              |
| `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/components/CameraObservations.tsx` | Cập nhật nền giữ màn hình/bộ lọc; loại phản hồi camera cũ để không ghi đè yêu cầu mới                                                                                     |
| `apps/web/src/api.ts`                                                                    | Thông báo tiếng Việt khi đặt mới đã hết hạn                                                                                                                               |
| `.gitignore`, `.prettierignore`, `README.md`, tài liệu tuần 10                           | Loại báo cáo/ảnh/trace khỏi Git; hướng dẫn chạy và giới hạn bằng chứng                                                                                                    |

Các file tuần 7–9 đang có trong workspace được giữ lại; danh sách `git status` còn chứa thay đổi của những tuần trước. Không reset/seed database, không thay đổi ô thật để ép MATCH, không thêm migration tuần 10.

## Kết quả và giới hạn

`apps/api/test/week9.test.ts` được chỉnh ca tranh chấp cảnh báo dùng cùng timestamp: hai request khác thời gian có thể tới ngược thứ tự, khi đó frame cũ bị bỏ qua đúng thiết kế và không được kỳ vọng tăng bộ đếm. Quy tắc bỏ frame cũ vẫn có ca kiểm thử riêng.

Các lượt chạy đã xác nhận 41 test API/PostgreSQL/WebSocket, 30 test Python (có PaddleOCR thật trên ảnh chữ tổng hợp khi bật `--ocr`) và hai test browser đạt. Kiểm tra format, lint, TypeScript/Vite build và trạng thái bốn migration cũng đã đạt. Báo cáo của lần chạy tổng hợp nằm ở `artifacts/week10/<timestamp>/summary.md`; xem từng bước và assertion trong JSON/log đi kèm, không suy kết quả từ một dòng lỗi HTTP được cố ý tạo trong test.

Detection và OCR trong luồng browser là `CONTROLLED_TEST_FIXTURE`; không phải phép đo chất lượng YOLO/PaddleOCR trên xe đồ chơi hoặc biển thật. Ảnh tổng hợp của OCR runtime chỉ kiểm tra thư viện/model/API tương thích.

Lượt kiểm kê thiết bị không tìm thấy webcam có tên cấu hình `USB Camera`; các nguồn được thấy là webcam tích hợp, camera điện thoại ảo và OBS. Không tự chọn nhầm nguồn. Chưa kiểm chứng lại nhận diện thực tế ở bốn ô, mất/cắm lại webcam, độ trễ hoặc tỉ lệ đọc đúng/sai. Các ca HW01–HW10 trong tài liệu tích hợp vẫn **CHƯA ĐO**; cần cắm webcam đúng tên, cố định camera, kiểm tra lại ROI và chạy thực nghiệm có biển số ground truth để chốt phần này.

Không tự check-in/check-out theo OCR hoặc xe rời ô. Không commit `.env`, API key, model weights, ảnh cá nhân hoặc trace. Cảnh báo phụ thuộc cũ đã ghi ở bàn giao tuần 9 vẫn là giới hạn riêng, không được suy thành đã xử lý bởi kiểm thử tuần 10.
