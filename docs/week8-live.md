# Tuần 8: chạy camera → ROI → backend → web

Hiện người dùng có một xe, chưa bố trí ô vật lý. Vì vậy bước thử ban đầu dùng **một vùng quan sát do người dùng vẽ, gắn với A01 đang có trong database**; đây không phải minh chứng đã kiểm thử mô hình 3–4 ô. Không tạo/xóa ô, phương tiện hay đặt chỗ trong bước hiệu chuẩn. Không tự check-in/check-out.

## Chuẩn bị và hiệu chuẩn

Từ PowerShell tại thư mục gốc:

```powershell
cd D:\DATN
# Nếu chưa có thư viện chọn webcam theo tên:
.\services\vision\.venv\Scripts\python.exe -m pip install -r services\vision\requirements-ocr.txt
npm.cmd run dev
```

Terminal khác:

```powershell
cd D:\DATN
npm.cmd run vision:setup -- --codes A01 --camera-name "USB Camera" --backend dshow
```

`USB Camera` là tên Windows đang nhận của webcam thực nghiệm hiện tại. Xem tên của thiết bị khác bằng:

```powershell
.\services\vision\.venv\Scripts\python.exe -m cv2_enumerate_cameras
```

Nếu dùng C270 hiện đúng tên, thay bằng `--camera-name "C270 HD WEBCAM"`. Chọn theo tên chính xác sẽ tìm chỉ số mới nếu USB đổi thứ tự; không mở nhầm camera điện thoại nếu webcam bị rút. Nếu có hai camera cùng tên, không truyền `--camera-name` và chỉ rõ `--source` với `--backend dshow` sau khi kiểm tra hình.

Các bước trên cửa sổ camera:

1. Đặt camera cố định; đặt xe và biển số rõ trong hình. **Space** chốt một khung hình để hiệu chuẩn; **Q/Esc** hủy.
2. Mặc định **kéo một hình chữ nhật quanh toàn bộ xe/vùng quan sát A01**, rồi **Enter** xác nhận. Đây là vùng xe, chưa phải vùng biển số. Không khoanh cả bàn hoặc tay người nếu không cần. Nếu cần polygon, thêm `--roi-mode polygon`, bấm các đỉnh theo một chiều, chuột phải bỏ điểm cuối, **R** xóa để vẽ lại, **Enter** xác nhận. Polygon có đường cắt nhau/đỉnh trùng sẽ bị từ chối.
3. Kéo hình chữ nhật sát biển số của A01, **Enter** xác nhận. Đây là vùng OCR thủ công để thí nghiệm, không phải model tự tìm biển số. Biển phải nằm trong bounding box của xe để gán được với xe/ô; giấy đặt tách khỏi xe có thể đọc OCR độc lập nhưng không đủ bằng chứng ghép ô.
4. Khi toàn bộ bước hoàn tất, chương trình lưu bốn file cục bộ trong `services/vision/config`: `vision.json`, `spots.json`, `parking_rois.json`, `plates.json`. Không lưu ảnh/video hoặc API key. Cấu hình cũ được sao lưu thành `*.bak`, đã ignore.

Endpoint `GET /api/vision/spots` yêu cầu API key, chỉ trả UUID/code và nhãn khu/bãi đang hoạt động; không trả chủ xe, biển số hay dữ liệu đặt chỗ. Nếu mã ô trùng giữa nhiều bãi, dùng `--spot-ids UUID...` để chỉ rõ, không tự lấy ô đầu tiên.

`scripts/vision.mjs` dùng quy tắc dotenv để đọc riêng khóa Vision từ `apps/api/.env`, cho phép biến môi trường phiên hiện tại ghi đè; không in khóa, không sao chép khóa vào JSON. Nếu API đang chạy với khóa cũ, khởi động lại API sau khi thay cấu hình. Khóa cục bộ đã được tạo khi thiếu, không commit `.env`.

## Chạy và xem kết quả

```powershell
cd D:\DATN
npm.cmd run vision:run
# Thử không gửi API:
npm.cmd run vision:run -- --no-api
```

Ứng dụng tích hợp dùng camera/ROI/plate config vừa hiệu chuẩn, không dùng `camera_demo` (vốn chỉ chạy cục bộ). Camera cố định trong suốt lần thử; hiệu chuẩn lại nếu đổi góc/vị trí camera hoặc vùng biển. `VISION_STARTED` nêu camera, backend và danh sách ô thật; `VISION_REPORTED` xác nhận số quan sát API đã nhận cùng kết quả từng ô. Không coi một dòng OCR độc lập là kết quả đã lưu.

Cấu hình hiệu chuẩn chọn detector chữ OCR `PP-OCRv5_mobile_det` và recognizer `en_PP-OCRv5_mobile_rec` để thử tải CPU thấp hơn model server, vẫn là OCR trên crop thủ công. Đây **không phải detector biển số**. Model chính thức được tải qua PaddleOCR khi chạy lần đầu. Consensus giữ 3 mẫu tối thiểu, confidence >=0.7, cửa sổ 7 mẫu, TTL 20 giây cho thử nghiệm CPU; không giảm chốt confidence backend. Model cũ vẫn dùng được khi không cấu hình tên model OCR. API constructor tham khảo [PaddleOCR 3.3.2](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.3.2/paddleocr/_pipelines/ocr.py).

Web tại `http://localhost:5173/dashboard?view=admin`, cần đăng nhập ADMIN:

- **Mới nhất theo ô**: quan sát mới nhất cho mỗi camera/ô; quá 60 giây hiện nhắc đây là quan sát cũ.
- **Lịch sử**: phân trang những lần quan sát đã lưu.
- Lọc `usb-parking-camera` và nhấn **Tải lại camera** để xem lần gửi mới. Từ tuần 9, bảng mới nhất tự cập nhật bằng WebSocket khi nhãn **Trực tiếp** đang bật; xem [tuần 9](week9-realtime.md).

Backend chỉ kết luận khi đủ bằng chứng xe/ô/biển và đủ mẫu OCR. Nếu không có đặt chỗ hiệu lực đúng A01 vào lúc frame được quan sát, `NO_RESERVATION` là kết quả đúng, kể cả biển đọc rõ. Không tạo sẵn một lượt đặt giả để minh họa khớp. Thử `MATCH`/`MISMATCH` bằng các lượt đặt do người dùng tạo hợp lệ trên web, sau đó kiểm tra lịch sử; chương trình không tự sửa nghiệp vụ.

## Mở rộng sang 3–4 ô

### Hiện đường kẻ để biết đặt xe ở đâu

Nếu chưa có đường kẻ trên bàn, dùng các khung hướng dẫn trên hình camera trước:

```powershell
npm.cmd run vision:setup -- --codes A01 A02 A03 A04 --camera-name "USB Camera" --backend dshow --roi-mode grid --columns 4
```

Camera sẽ hiện A01–A04 từ trái sang phải. Đây là các vùng ảnh gợi ý để người dùng bố trí thí nghiệm, không phải tự suy ra bốn ô vật lý từ camera. Di chuyển/lùi camera để các khung vừa khu vực thử, đặt toàn bộ xe trong một ô (ví dụ A01), rồi **Space** xác nhận vị trí hiển thị. Chỉ sau khi xác nhận và hoàn tất chọn biển, tọa độ grid mới được lưu thành ROI thực nghiệm; database vẫn giữ toàn bộ ô cũ.

Sau đó chọn vùng biển cho ô có xe bằng kéo khung sát chữ → **Enter**. Với ô trống, **Esc** bỏ qua vùng biển của ô đó; ô vẫn có ROI để quan sát có/không phát hiện xe. Phải chọn được ít nhất một vùng biển, nếu không cấu hình cũ được giữ nguyên. Các cửa sổ chọn vùng đã được co vừa màn hình, không cần bấm nhiều đỉnh.

Khi chạy `npm.cmd run vision:run`, tất cả ROI đã lưu đều hiện đường kẻ và nhãn trên camera. Dùng một xe thử lần lượt các ô; khi chuyển vị trí xe, nhấn **R** để khoanh lại biển số hiện tại. Bộ gán vẫn kiểm tra biển nằm trong đúng một xe và xe thuộc đúng một ROI; không lấy nhãn ô người dùng chọn thay cho bằng chứng hình học. Không hạ confidence hoặc tự sửa text OCR để ép kết luận.

Chỉ khi mô hình đã có các ô thực tế trong cùng góc camera:

```powershell
npm.cmd run vision:setup -- --codes A01 A02 A03 --camera-name "USB Camera" --backend dshow
# Hoặc 4 ô:
npm.cmd run vision:setup -- --codes A01 A02 A03 A04 --camera-name "USB Camera" --backend dshow
npm.cmd run vision:run
```

Vẽ từng polygon/biển theo nhãn đang hiện. Các ô chưa chọn vẫn giữ nguyên trong DB. Kết quả mơ hồ giữa nhiều xe/ô/biển → AMBIGUOUS/INSUFFICIENT, không tự chọn ô gần nhất. Mất camera → UNKNOWN/CAMERA_LOST.
