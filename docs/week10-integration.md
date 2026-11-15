# Tuần 10 — Kiểm thử tích hợp toàn hệ thống

## Mục tiêu và loại bằng chứng

Kiểm tra xuyên luồng đặt chỗ, chống đặt trùng, nhận diện xe/biển, đúng xe–đúng ô và cập nhật web. Các lớp bằng chứng được tách rõ:

| Lớp                      | Thành phần chạy thật                                        | Thành phần điều khiển                         | Chứng minh được                                                                        |
| ------------------------ | ----------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| API/PostgreSQL/WebSocket | Express, Prisma/PostgreSQL, transaction, JWT, Socket.IO     | Tài khoản/bãi/xe/quan sát thử có UUID riêng   | Nghiệp vụ, phân quyền, chống trùng, thứ tự commit, cảnh báo và hồi quy                 |
| Python core              | ROI, gán xe/biển, temporal occupancy, consensus, chuẩn hóa  | Detection/OCR theo ca test                    | Hình học và trạng thái rõ/mơ hồ/không đọc/mất camera                                   |
| Paddle runtime (`--ocr`) | PaddleOCR/PaddlePaddle/model chính thức, tiền xử lý adapter | Ảnh chữ tổng hợp                              | API/thư viện/model OCR chạy tương thích, không chứng minh chất lượng biển số chụp thật |
| Browser E2E              | Chromium, React, HTTP API, DB, Socket.IO, Python reporter   | Detection/OCR có nhãn CONTROLLED_TEST_FIXTURE | Toàn luồng phần mềm và nội dung web tự cập nhật, nhiều tab, reconnect, mobile          |
| Camera thật              | Webcam và mô hình thực nghiệm                               | Do người dùng bố trí                          | Chỉ kết luận sau khi đo/chụp bằng thiết bị thật; không lấy các test phía trên thay thế |

Không trả biển mẫu khi OCR thất bại; không coi `yolo11n.pt` là detector biển số. Luồng thực vẫn dùng vùng biển thủ công nếu chưa có model riêng. Camera không tự tạo/hủy đặt chỗ hoặc check-in/out.

## Một lệnh kiểm thử trên PowerShell

Điều kiện: PostgreSQL đang chạy, `.env` API có khóa/JWT/URL phù hợp, Node.js và Python `.venv` đã cài theo README. Cài thêm trình duyệt dành riêng cho test lần đầu:

```powershell
cd D:\DATN
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run test:browser:install
npm.cmd run test:week10
```

Mở rộng kiểm tra OCR runtime và khả năng đọc frame webcam:

```powershell
npm.cmd run test:week10 -- --ocr --camera
```

Mặc định hai test Paddle runtime được skip để không bắt buộc tải model; `--ocr` chạy chúng trên chữ tổng hợp. `--camera` chỉ kiểm tra thiết bị/đọc một frame, không lưu ảnh hoặc khẳng định đã nhận diện đúng xe/biển. Camera không có hoặc chưa hiệu chuẩn được ghi rõ trong `hardware.json`; kết quả tổng thể **PASS_SOFTWARE_ONLY** không phải PASS thực nghiệm camera.

Runner không chạy migrate reset/seed và không tự áp dụng migration còn thiếu; bước `migrate status` sẽ báo chưa sẵn sàng. Các bước còn làm được vẫn chạy và báo cáo FAIL/SKIP rõ ràng. Nếu thiếu Chromium, chạy lại `test:browser:install`. Báo cáo không gán PASS cho bước chưa chạy.

Test API/web trình duyệt dùng cổng **4101/5174**, tự khởi động và đóng máy chủ thử, không dùng lại API/web bình thường ở 4000/5173. Có thể chọn cổng trống khác:

```powershell
$env:WEEK10_API_PORT = "4102"
$env:WEEK10_WEB_PORT = "5175"
npm.cmd run test:week10 -- --ocr
Remove-Item Env:\WEEK10_API_PORT
Remove-Item Env:\WEEK10_WEB_PORT
```

Test server có `HTTP_RATE_LIMIT_MAX=1000` để chịu các đợt request fixture từ nhiều tab; ứng dụng bình thường giữ mặc định 120/phút. Không tắt JWT/API key, không dùng test server như cấu hình production.

Chạy riêng một tầng khi cần tái hiện lỗi:

```powershell
$env:RUN_DB_TESTS = "true"
npm.cmd test
Remove-Item Env:\RUN_DB_TESTS
npm.cmd run test:e2e
cd services\vision
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
$env:RUN_OCR_TESTS = "true"
.\.venv\Scripts\python.exe -m unittest tests.test_ocr_runtime -v
Remove-Item Env:\RUN_OCR_TESTS
```

Nguồn cấu hình trình duyệt: [Playwright webServer](https://playwright.dev/docs/test-webserver), [configuration](https://playwright.dev/docs/test-configuration), [JSON/HTML reporters](https://playwright.dev/docs/test-reporters).

## Ma trận tự động

| Nhóm             | Ca kiểm thử                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Đặt chỗ          | Đặt thành công qua UI; một ô không nhận hai lượt; một xe không giữ hai ô; hai request đồng thời chỉ một thành công; rollback ô của thao tác thua                          |
| Điều kiện đặt    | Xe ngừng hoạt động; ô/khu/bãi không hoạt động; lượt mới đã hết hạn bị từ chối                                                                                             |
| Xe/biển/ROI      | Chuẩn hóa không đoán O/0; không xe; mờ/không đọc; nhiều xe/biển mơ hồ; gán đúng ROI; đồng thuận 3 mẫu; TTL; mất camera                                                    |
| Python → API     | Reporter thật dùng API key, gửi batch 4 ô từ fixture được kiểm soát; API trả accepted=4, lưu confidence/text/trạng thái thật từ pipeline test                             |
| Đối chiếu        | Đúng xe/đúng ô MATCH; xe đúng nhưng sai ô WRONG_SPOT; biển khác MISMATCH; không đặt chỗ; hết hạn; thiếu bằng chứng                                                        |
| Realtime         | Giao diện đổi theo sự kiện, không bấm tải lại; chỉ phát sau commit; không phát khi rollback; đúng route lồng nhau; tab khác thấy check-in/out; reconnect lấy snapshot mới |
| Lịch sử/cảnh báo | Gộp cảnh báo lặp; tiếp nhận bởi ADMIN; giữ lịch sử khi resolved; UNKNOWN/EMPTY/mất camera không tự xóa cảnh báo/phiên                                                     |
| Quyền            | Socket JWT/Origin/token hết hạn; USER không đọc cảnh báo/biển số người khác; client không quyết định kết luận backend                                                     |
| Check-in/out     | Đúng hạn, đúng quyền, xe/khu hoạt động; xử lý đồng thời chỉ một thành công; hủy đặt đụng check-in; ô bị vô hiệu hóa không trở thành AVAILABLE khi checkout                |
| Web              | Chromium desktop và viewport 390×844; giữ bộ lọc camera khi dữ liệu nghiệp vụ cập nhật; nút checkout bị khóa đến khi người dùng xác nhận xe thật sự ra bãi                |
| Thời gian frame  | Frame tương lai vẫn được lưu lịch sử nhưng không được chiếm latest hoặc chặn cảnh báo của frame hiện tại                                                                  |

## Fixture và báo cáo

Fixture có lot `Week10 fixture <UUID>`, email/camera riêng và bốn ô nằm trong lot đó; không tái sử dụng tài khoản quản trị/ô của người dùng để thao tác thử. Cleanup chỉ dùng UUID của lần chạy và transaction. Test Python bridge kiểm tra các spot UUID thuộc đúng lot fixture trước khi gửi; từ chối gửi dữ liệu điều khiển vào ô thật. Không commit ảnh, trace, token hoặc cấu hình thật.

Kết quả trong `artifacts/week10/<timestamp>/`:

- `summary.md`, `summary.json`: từng bước PASS/FAIL/SKIP, thời gian, vị trí log và giới hạn bằng chứng.
- `vitest.json`: từng test API/DB/Socket.
- `playwright.json`, `browser-report/index.html`: bài test web, thời gian, ảnh/trace khi lỗi.
- `browser-results/.../camera-match.png`, `camera-mobile.png`: ảnh giao diện chứa dữ liệu **fixture**, không phải ảnh biển thật.
- `hardware.json`: thiết bị được liệt kê, ROI cấu hình, kết quả đọc frame nếu yêu cầu; không lưu ảnh hoặc giá trị khóa.

Khi cố ý thử trùng/rollback có thể thấy `prisma:error`, HTTP 400/401/403/409/500 trong log test. Kết quả assertion và summary mới quyết định test đạt hay không; không lấy một dòng HTTP lỗi cố ý làm bằng chứng lỗi hệ thống thực.

Không đóng cưỡng bức tiến trình khi fixture đang chạy. Các hook cleanup chạy sau mỗi case; nếu mất điện/kill đột ngột, có thể còn dữ liệu có UUID fixture và cần kiểm tra đúng phạm vi trước khi dọn, không xóa theo mã A01 hoặc biển số của người dùng.

## Thực nghiệm thật để chốt tuần 10

Giữ camera cố định, chọn lại vùng biển khi xe đổi ô (R), hướng đầu/đuôi xe và biển về camera. Dùng tài khoản/xe/đặt chỗ thực nghiệm do người dùng tạo hợp lệ; không tự thay dữ liệu cũ để ép kết quả khớp. Ghi lại mỗi lần thử: camera/ánh sáng/khoảng cách, ô, biển thật, raw/normalized OCR, confidence xe/OCR/gán ô, samples, timestamp, kết quả backend, thời điểm web đổi và ảnh minh chứng được phép sử dụng.

| Mã   | Thao tác thật                                    | Mong đợi                                                  | Kết quả hiện tại |
| ---- | ------------------------------------------------ | --------------------------------------------------------- | ---------------- |
| HW01 | Đặt đúng biển vào A01 đã đặt hợp lệ              | READ ổn định, MATCH trên web                              | CHƯA ĐO          |
| HW02 | Cùng xe chuyển sang A02                          | Gán A02, WRONG_SPOT, không tự đổi đặt chỗ                 | CHƯA ĐO          |
| HW03 | Đổi sang biển khác tại A01                       | MISMATCH/cảnh báo phù hợp                                 | CHƯA ĐO          |
| HW04 | Xe không đặt chỗ vào ô trống                     | NO_RESERVATION/cảnh báo, không tự check-in                | CHƯA ĐO          |
| HW05 | Xe nằm giữa hai ô hoặc có nhiều biển             | UNKNOWN/AMBIGUOUS/INSUFFICIENT                            | CHƯA ĐO          |
| HW06 | Biển mờ/rung/che khuất                           | Không bịa hoặc dùng lại biển cũ                           | CHƯA ĐO          |
| HW07 | Rút/cắm lại webcam                               | CAMERA_LOST/UNKNOWN, không tự checkout                    | CHƯA ĐO          |
| HW08 | Mất/kết nối lại API hoặc mạng web                | Offline rõ ràng, reconnect lấy snapshot mới               | CHƯA ĐO          |
| HW09 | Xác nhận xe vào, chuyển khỏi ô nhưng chưa ra bãi | Phiên vẫn ACTIVE tới khi người có quyền xác nhận checkout | CHƯA ĐO          |
| HW10 | Di chuyển lần lượt 4 ô, nhiều điều kiện sáng     | Ghi tỉ lệ đọc đúng/sai/không đọc và sai ô theo dữ liệu đo | CHƯA ĐO          |

Chỉ tính độ chính xác trên tập mẫu đã ghi ground truth; không diễn giải confidence của một frame thành độ chính xác toàn hệ thống. Các test software PASS không làm những dòng CHƯA ĐO phía trên thành PASS.
