# Tuần 9 — WebSocket, cảnh báo vị trí và xác nhận xe vào/ra

## Phạm vi triển khai

Tuần 9 tiếp tục giữ nguồn trạng thái riêng: `parking_spots.status` do nghiệp vụ quản lý, `camera_observations` là quan sát tại thời điểm frame. Thêm WebSocket cập nhật web, bảng cảnh báo có lịch sử, và màn hình xe vào/ra. Không tự check-in/check-out từ OCR; xe rời ô không chứng minh xe rời bãi. Không thêm ESP32/MQTT/cảm biến.

## Chạy trên Windows

```powershell
cd D:\DATN
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run dev
# Terminal khác; dùng cấu hình USB/ROI đã hiệu chuẩn:
npm.cmd run vision:run
```

Migration bổ sung `202610300001_week9_alerts` chỉ tạo bảng/index/enum cảnh báo, không reset, seed lại hay xóa dữ liệu cũ. Vẫn dùng `VISION_API_KEY` giữa Vision Service và API, JWT giữa web và API/WebSocket. Không in token/khóa hoặc ghi chúng trong JSON camera.

Mở `http://localhost:5173`, đăng nhập như các tuần trước. `WEB_ORIGIN` phía API phải khớp origin web; `VITE_API_BASE_URL` là URL API bao gồm giao thức/cổng, mặc định `http://localhost:4000`. Khi triển khai HTTPS cần proxy hỗ trợ WebSocket Upgrade. Chưa có Redis adapter: phiên bản này dùng một tiến trình API.

## Cập nhật thời gian thực

Socket.IO 4.x, transport chỉ `websocket`; không dùng HTTP polling thay WebSocket. Token gửi qua `auth.token` khi kết nối, không trong URL. Server kiểm tra JWT, user đang hoạt động và browser Origin. JWT hết hạn ngắt kết nối và yêu cầu đăng nhập lại. Client tự thử nối lại khi mất mạng; khi nối lại lấy snapshot mới, không giả định đã nhận đủ mọi sự kiện.

Sự kiện `data:changed` chỉ có `{ scope, at }`, scope là `vision`, `parking` hoặc `alerts`. Không truyền biển số, chủ xe, reservation/session ID qua broadcast. Dữ liệu chi tiết luôn lấy qua REST có JWT và kiểm tra quyền hiện tại. Client không thể tạo check-in/cảnh báo bằng cách gửi sự kiện WebSocket.

- Ingest camera: commit lịch sử/đối chiếu/cảnh báo rồi mới phát invalidation `vision`, và `alerts` nếu có thay đổi cảnh báo.
- Đặt/hủy chỗ, xe vào/ra và quản trị bãi thành công: phát invalidation `parking` sau phản hồi thành công.
- Web gộp sự kiện trong khoảng 300 ms trước khi tải snapshot; kết nối lại cũng tải mới. Khi offline hiện nhãn mất kết nối và vẫn có nút tải lại.
- Bảng **Mới nhất theo ô** tự cập nhật. **Lịch sử nhận diện** giữ trang đang xem và hiện thông báo có dữ liệu mới để tránh nhảy trang.

Nguồn API đã đối chiếu: [Socket.IO middleware/auth](https://socket.io/docs/v4/middlewares/), [client/reconnection options](https://socket.io/docs/v4/client-options/), [Origin/CORS](https://socket.io/docs/v4/handling-cors/).

## Cảnh báo sai vị trí và lịch sử

ADMIN → **Quản trị → Cảnh báo vị trí đỗ**. USER không được gọi endpoint cảnh báo hoặc xem biển số người khác. Bảng có cảnh báo đang hoạt động, lịch sử toàn bộ, thời điểm đầu/gần nhất, ô thực tế/ô dự kiến, số lần ghi nhận và nút **Đã tiếp nhận**.

Chỉ xét frame có `READ`, occupancy OCCUPIED, biển đúng định dạng hỗ trợ, OCR >=0.7, confidence xe >=0.35, gán ô >=0.6 và >=3 mẫu. Các kết luận client gửi không được tin cậy; backend tự đối chiếu:

| Loại               | Điều kiện                                                                        |
| ------------------ | -------------------------------------------------------------------------------- |
| WRONG_SPOT         | Biển đọc được có đúng một đặt chỗ hiệu lực hoặc một phiên gửi xe ACTIVE ở ô khác |
| PLATE_MISMATCH     | Biển đọc được khác biển của đặt chỗ hiệu lực tại ô đang quan sát                 |
| UNRESERVED_VEHICLE | Đủ bằng chứng có xe/biển tại ô nhưng không có đặt chỗ hoặc phiên ACTIVE phù hợp  |

Nhiều bản ghi chuẩn hóa cùng biển hoặc đặt chỗ/phiên mâu thuẫn → chưa kết luận cảnh báo. Phiên walk-in ACTIVE đúng xe/ô không bị cảnh báo chỉ vì không có reservation. Frame quá 60 giây, tương lai quá 30 giây hoặc đến sau một frame mới hơn vẫn lưu lịch sử nhận diện nhưng không mở/kết thúc cảnh báo trực tiếp.

Một cảnh báo hoạt động được gộp theo camera/ô/loại/biển/ô dự kiến. Các frame lặp cập nhật thời gian và số lần, không tạo một cảnh báo mới mỗi frame. Trạng thái:

- OPEN: cần kiểm tra.
- ACKNOWLEDGED: ADMIN đã tiếp nhận; frame lặp không xóa dấu tiếp nhận.
- RESOLVED: quan sát đủ tin cậy sau đó chứng minh tình huống đã thay đổi/hết bất thường. Với sai ô, đọc rõ cùng xe trở lại ô dự kiến cũng kết thúc cảnh báo sai ô cũ của camera đó.

EMPTY, mất camera hoặc OCR yếu **không** tự giải quyết cảnh báo hay kết thúc phiên gửi xe. Lịch sử giữ lại kể cả khi cảnh báo đã RESOLVED. Tiếp nhận cảnh báo ghi audit log. Ingest cạnh tranh được thử lại tối đa ba transaction khi PostgreSQL báo write conflict/active-key race; chỉ phát sự kiện khi commit thành công.

REST dành cho ADMIN:

```text
GET  /api/vision/alerts?page=1&pageSize=20
GET  /api/vision/alerts?status=ALL&cameraId=usb-parking-camera
GET  /api/vision/alerts?status=OPEN
POST /api/vision/alerts/:id/acknowledge
```

Các trường ID/biển/ô dự kiến trong bảng cảnh báo là snapshot phục vụ lịch sử, không tự thay đổi reservation hoặc parking session. Nhận diện vẫn lưu ở endpoint tuần 8 `/api/vision/observations` và `/latest`.

## Check-in / check-out

Menu **Xe vào / ra** dùng quyền hiện có: USER thao tác xe/phiên thuộc mình, ADMIN thao tác các xe/phiên được quản lý. Nút xác nhận là hành động nghiệp vụ có chủ đích, không tự chạy khi camera đọc được biển.

Check-in có đặt chỗ chỉ nhận trạng thái CONFIRMED và `startsAt <= giờ hiện tại < expiresAt`, đúng xe/chủ/ô. Xe, ô, khu và bãi phải đang hoạt động. Claim reservation và ô RESERVED trong cùng transaction, sau đó tạo phiên ACTIVE và audit log. Nếu một bước thất bại thì rollback toàn bộ. Đặt chỗ chưa tới giờ/hết hạn không được check-in.

Walk-in yêu cầu ô AVAILABLE, xe hoạt động và không có reservation đang chiếm xe/ô. Unique indexes bảo vệ một xe/ô không có hai phiên ACTIVE kể cả khi gọi đồng thời. Hủy đặt chỗ cũng dùng claim có điều kiện để không giải phóng một ô vừa được check-in.

Check-out yêu cầu phiên ACTIVE và quyền sở hữu/quản trị; UI yêu cầu đánh dấu đã kiểm tra xe thực sự rời bãi. Claim phiên chỉ một lần, đồng bộ reservation CHECKED_IN → COMPLETED, giải phóng ô OCCUPIED hợp lệ và ghi audit trong một transaction. Nếu ô/khu/bãi ngừng hoạt động, không biến ô đó thành AVAILABLE; dữ liệu trạng thái mâu thuẫn cần kiểm tra thay vì ghi đè.

REST cũ giữ nguyên đường dẫn/body; các điều kiện nghiệp vụ được kiểm tra chặt hơn:

```text
POST /api/sessions/check-in          { vehicleId, spotId, reservationId? }
POST /api/sessions/:id/check-out
```

Lượt CONFIRMED cũ đã hết hạn nhưng còn giữ RESERVED cần được người có quyền kiểm tra/hủy trên web; hệ thống không tự xóa/hủy dữ liệu cũ chỉ để chạy demo.

## Kiểm tra và thực nghiệm

```powershell
cd D:\DATN
npm.cmd run format:check
npm.cmd run lint
npm.cmd run build
$env:RUN_DB_TESTS = "true"
npm.cmd test
Remove-Item Env:\RUN_DB_TESTS
```

Test WebSocket dùng HTTP server/cổng tạm và client Socket.IO thực; test PostgreSQL tạo bộ fixture có UUID/email/lot/camera riêng rồi chỉ dọn dữ liệu đó. Bao phủ xác thực/token hết hạn/Origin/kết nối lại, dữ liệu invalidation không lộ biển, phát sự kiện sau commit, cảnh báo sai ô/lặp/tiếp nhận/hết cảnh báo, frame cũ/không rõ và các cuộc đua check-in/out/hủy đặt chỗ.

Để ghi minh chứng tuần 9 bằng mô hình thật: mở hai tab đăng nhập, chạy camera 4 ROI, đặt xe đúng/sai ô với lượt đặt đang hiệu lực, kiểm tra bảng tự đổi không bấm tải lại, tiếp nhận cảnh báo và xem lịch sử. Thử ngắt/kết nối lại API, rồi xác nhận xe vào/ra trên màn hình. Không tạo kết quả nhận diện mẫu trong database để thay cho thực nghiệm.

Các test phần mềm không chứng minh độ chính xác OCR/YOLO trên mọi xe đồ chơi. Vẫn dùng vùng biển thủ công khi chưa có model biển số riêng; cần thử camera thực cho từng góc/ánh sáng và đo độ trễ. Đây là giới hạn của phần nhận diện, không được bỏ qua ngưỡng để ép READ/cảnh báo.
