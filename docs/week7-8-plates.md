# Tuần 7–8: OCR biển số và đối chiếu đặt chỗ

## Kiểm tra tuần 6 trước khi sửa

Đã có OpenCV webcam/MP4/RTSP, YOLO COCO phương tiện, hình học ROI, ổn định occupancy, API key và lịch sử `camera_observations`. Chưa có detector biển số, tiền xử lý, PaddleOCR, tổng hợp biển số, hợp đồng lưu biển số, đối chiếu backend hoặc bảng web. `roi_tool` còn bắt buộc 5 ô; đã thay bằng danh sách có ít nhất một ô, kiểm tra trùng ID/code. Không xóa ô A04/A05 hoặc sửa dữ liệu seed. Danh sách ROI chỉ chọn các ô dùng trong thí nghiệm, ví dụ 3–4 ô.

`yolo11n.pt` hiện tại là model phương tiện COCO, **không phải detector biển số**. Chưa có bằng chứng model này nhận được xe đồ chơi 1:32. `EMPTY` nghĩa là không phát hiện phương tiện trong ROI, không bảo đảm thực tế ô trống. Có thể thử OCR độc lập mà không chạy YOLO phương tiện.

## Tuần 7: cài đặt Windows / Python 3.11

Máy kiểm tra có Python 3.11.9 x64. Chọn PaddleOCR **3.3.2**, PaddlePaddle CPU **3.2.0** và API `PaddleOCR(...).predict(image)`. Không dùng API 2.x `ocr(..., cls=True)`. Adapter đọc `rec_texts`, `rec_scores`, `rec_boxes`; ghép thứ tự dòng và lấy confidence thấp nhất của các dòng. Confidence chỉ là điểm của model, không phải xác suất đo được trên mô hình thí nghiệm.

Nguồn chính thức đã đối chiếu:

- [Metadata PaddleOCR 3.3.2: Python >=3.8, PaddleX 3.3.x](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.3.2/pyproject.toml).
- [Constructor và predict của 3.3.2](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.3.2/paddleocr/_pipelines/ocr.py).
- [Quick Start và PaddlePaddle CPU 3.2.0](https://www.paddleocr.ai/latest/en/quick_start.html).
- [PaddleOCR Apache-2.0](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE).

```powershell
cd D:\DATN\services\vision
py -3.11 -m venv .venv
# Không cần activate hoặc đổi ExecutionPolicy.
.\.venv\Scripts\python.exe -m pip install -r requirements-ocr.txt
.\.venv\Scripts\python.exe -m pip check
if (!(Test-Path config\plates.json)) { Copy-Item config\plates.example.json config\plates.json }
```

Lần đầu khởi tạo OCR, PaddleOCR tải model OCR tiếng Anh PP-OCRv5 từ nguồn chính thức của Paddle/PaddleX vào cache người dùng, cần Internet. Đây là detector chữ + recognizer chữ trên **crop biển số đã chọn**, không thay thế model tìm biển số trong toàn cảnh. Không commit cache/weights.

### Không có model biển số: chọn vùng thủ công (thử nghiệm)

Chuẩn bị ảnh biển số mẫu do bạn tự in/chụp. Đặt ảnh trong `services/vision/local-media/` (đã ignore). Góc nhìn trực diện đầu/đuôi, thử khoảng 20–25 cm, chỉnh lấy nét/ánh sáng; kích thước chữ cần đủ rõ. Khoảng cách này chưa được kiểm chứng trên thiết bị của bạn.

```powershell
New-Item -ItemType Directory -Force local-media
# Đặt ảnh thực có tên plate.jpg vào local-media trước khi chạy.
.\.venv\Scripts\python.exe -m vision.plate_cli --config config\plates.json --image local-media\plate.jpg --select --save-regions
# Chọn từng hình chữ nhật, Enter/Space xác nhận, Esc kết thúc chọn vùng.
# Tái sử dụng vùng đã chọn trên cùng ảnh/góc máy:
.\.venv\Scripts\python.exe -m vision.plate_cli --config config\plates.json --image local-media\plate.jpg --headless

# Webcam; --save-regions lưu vùng mới vào config thật, không sửa config mẫu.
.\.venv\Scripts\python.exe -m vision.plate_cli --config config\plates.json --source 0 --select --save-regions
# Hoặc video đã chuẩn bị:
.\.venv\Scripts\python.exe -m vision.plate_cli --config config\plates.json --source local-media\parking.mp4 --headless --max-frames 100
```

`plate_cli` xuất JSON từng frame: `raw`, `normalized`, `confidence`, `sharp`, `stable`, `samples`, bbox, confidence vùng (null khi chọn thủ công). Ảnh tĩnh chỉ đọc một lần nên chưa đủ 3 frame để `stable=true`. Không có kết quả thì chuỗi rỗng/list rỗng, không trả biển mẫu. CLI OCR độc lập **không gửi API, không suy ra occupancy, không xác nhận có xe**. Các giá trị đọc được vẫn phải đối chiếu ảnh thật.

Vùng thủ công cố định theo góc máy, không theo dõi biển số di chuyển. Vẽ lại nếu đổi camera/góc/tỉ lệ ảnh. `preprocess` trong JSON cấu hình scale, grayscale, CLAHE, denoise, threshold và ngưỡng Laplacian `min_blur`. Cắt từ frame gốc trước resize; ảnh mờ bị từ chối để thử lại frame sau. Không tự đổi O/0 hoặc I/1. Chỉ bỏ khoảng trắng, dấu chấm/gạch phân cách và chuẩn hóa Unicode/chữ hoa. Chuỗi lạ giữ nguyên và không được coi là biển số hợp lệ. Bộ kiểm tra hiện hỗ trợ định dạng thử nghiệm biển dân sự Việt Nam: 2 số + 1–2 chữ + 4–6 số; các biển khác cần mở rộng có test.

### Model phát hiện biển số riêng

Repository **không kèm model biển số**, không có URL trọng số được chọn/kiểm chứng và không tạo weights giả. `detector.modelPath` mặc định null. Dùng chế độ thủ công cho đến khi có model hợp lệ. Bạn có thể cung cấp model Ultralytics detection `.pt` đã huấn luyện cho lớp biển số (ghi rõ nguồn, phiên bản, giấy phép code/weights/dataset và class ID trong hồ sơ thí nghiệm). Đường dẫn tương đối tính từ thư mục file cấu hình; file phải tồn tại. Adapter từ chối các lớp COCO thông thường như `car`/`person`.

Nguồn công cụ huấn luyện/tải model khởi tạo: [Ultralytics Detect](https://docs.ultralytics.com/tasks/detect/), [định dạng dataset](https://docs.ultralytics.com/datasets/detect/), [giấy phép Ultralytics AGPL-3.0/Enterprise](https://www.ultralytics.com/license). Model khởi tạo `yolo11n.pt` tải qua Ultralytics dùng để **huấn luyện lại**, không phải model biển số đã dùng được. Không giả định giấy phép dataset/model bên thứ ba giống giấy phép Ultralytics.

Ví dụ sau chỉ chạy **sau khi bạn có dataset biển số thật**, YAML chia train/val/test và nhãn bounding box lớp `license_plate`. `data\plates.yaml` không được cung cấp sẵn:

```powershell
.\.venv\Scripts\yolo.exe detect train model=yolo11n.pt data=data\plates.yaml epochs=100 imgsz=640 device=cpu project=models name=plate-detector
# Chỉ sau khi train thành công mới có file models\plate-detector\weights\best.pt.
# Sửa config\plates.json bằng file thực đó:
# detector.mode = "model"
# detector.modelPath = "../models/plate-detector/weights/best.pt"
# detector.classIds = [0] (phải khớp nhãn dataset của bạn)
```

## Tuần 8: ghép với xe/ô và REST API

Giữ luồng tuần 6 khi không cấu hình `plateConfig`. Để bật tuần 7–8:

1. Tạo `config/spots.json` từ mẫu, giữ đúng 3–4 ô muốn thử cùng UUID thật của database. Không xóa ô trong DB.
2. Vẽ ROI bằng công cụ cũ (nay dùng số ô theo dữ liệu).
3. Thêm `"plateConfig": "plates.json"` vào `config/vision.json`. Cấu hình đường dẫn ROI vẫn tương đối từ file settings.
4. Trong chế độ manual, vẽ vùng biển số cho các vị trí bằng CLI ở trên trên cùng nguồn hình.

```powershell
cd D:\DATN\services\vision
if (!(Test-Path config\vision.json)) { Copy-Item config\vision.example.json config\vision.json }
if (!(Test-Path config\spots.json)) { Copy-Item config\spots.example.json config\spots.json }
# Sửa UUID và chọn danh sách ô trước khi vẽ:
.\.venv\Scripts\python.exe -m vision.roi_tool --source 0 --spots config\spots.json --output config\parking_rois.json
# Thử cục bộ sau khi thêm plateConfig vào vision.json:
.\.venv\Scripts\python.exe -m vision --settings config\vision.json --no-api
```

Chỉ gắn biển số khi vùng biển nằm ít nhất 90% trong **đúng một** detection xe, xe được gán vào đúng một ROI bằng hình học tuần 6, không có nhiều xe/biển trong cùng ô. Mơ hồ → `AMBIGUOUS`; không lấy vị trí biển số thay cho bằng chứng xe. Xe không được YOLO phát hiện → OCR độc lập vẫn thử được, nhưng không khẳng định gán xe đồ chơi vào ô. Với dữ liệu thật, có thể cần model phương tiện huấn luyện riêng; đây là phụ thuộc chưa giải quyết bằng OCR.

Consensus dùng cửa sổ 7 frame, ít nhất 3 mẫu cùng biển, confidence >=0.7, hết hạn 3 giây. Xóa lịch sử khi mất xe/camera, gán mơ hồ hoặc hộp xe thay đổi lớn. Frame hiện tại mờ/không đọc được không được dùng lại biển cũ để kết luận. Đây là theo dõi tạm theo ROI, không phải tracker định danh xe; xe thay thế nhanh trong cùng vị trí cần kiểm chứng thực nghiệm.

### Migration và khởi động (không reset, không seed lại)

```powershell
cd D:\DATN
npm.cmd run db:generate
npm.cmd run db:migrate
# migrate deploy chỉ áp dụng migration bổ sung; không dùng migrate reset/db push.
npm.cmd run dev
```

Migration `202610290001_plate_recognition` thêm enum/cột/index vào `camera_observations`. Dữ liệu cũ giữ nguyên với `recognitionStatus=NOT_REQUESTED`, `matchStatus=INSUFFICIENT`. Không đổi `parking_spots`, đặt chỗ hoặc session. Kết quả đối chiếu là snapshot; ID đặt chỗ/biển dự kiến không cascade khi dữ liệu nghiệp vụ đổi sau đó.

Đặt `VISION_API_KEY` trùng nhau trong `.env` của API và terminal Vision; không commit giá trị thật:

```powershell
cd D:\DATN\services\vision
$env:VISION_API_KEY = Read-Host "Nhap VISION_API_KEY trung API"
.\.venv\Scripts\python.exe -m vision --settings config\vision.json
# Hoặc MP4: sửa source thành đường dẫn video trong vision.json.
.\.venv\Scripts\python.exe -m vision --settings config\vision.json --headless --max-frames 100
```

POST `/api/vision/observations`, header `x-vision-api-key`, giữ body tuần 6 hoặc batch `observations` tối đa 50. Các trường mới:

| Trường                      | Ý nghĩa                                                         |
| --------------------------- | --------------------------------------------------------------- |
| cameraId, spotId, timestamp | Camera, UUID ô, thời gian frame UTC                             |
| occupancyStatus, confidence | EMPTY/OCCUPIED/UNKNOWN và confidence occupancy cũ               |
| recognitionStatus           | NOT_REQUESTED/NO_VEHICLE/UNREADABLE/READ/CAMERA_LOST/AMBIGUOUS  |
| plateRaw, plateNormalized   | Text OCR gốc và chuẩn hóa; backend tự tính lại chuẩn hóa từ raw |
| vehicleConfidence           | Confidence detection xe                                         |
| plateDetectionConfidence    | Confidence detector biển; null với vùng thủ công                |
| associationConfidence       | Điểm hình học xe → ROI (đã kiểm tra biển → xe)                  |
| ocrConfidence, plateSamples | Confidence OCR và số mẫu đồng thuận                             |
| metadata.plateMode          | manual/model/disabled; manual hiển thị nhãn thử nghiệm          |

Backend bỏ qua kết luận `matchStatus`, `reservationId`, `expectedPlate` do client gửi. Chỉ đối chiếu khi occupancy OCCUPIED, recognition READ, OCR >=0.7, xe >=0.35, gán ô >=0.6, >=3 mẫu và biển đúng định dạng được hỗ trợ. Các ngưỡng backend là chốt bảo thủ; tăng/giảm ngưỡng Python không tự đổi ngưỡng backend.

Truy vấn đặt chỗ **đúng spotId**, trạng thái CONFIRMED/CHECKED_IN, `startsAt <= timestamp < expiresAt`. Không dùng giờ nhận HTTP thay giờ quan sát. Đối chiếu/lưu batch trong transaction RepeatableRead. Phân loại:

- MATCH: một đặt chỗ hiệu lực, biển chuẩn hóa khớp.
- MISMATCH: một đặt chỗ hiệu lực, biển khác.
- NO_RESERVATION: đủ thông tin nhận diện nhưng không có đặt chỗ hiệu lực (kể cả hết hạn).
- INSUFFICIENT: ảnh mờ, chưa ổn định, mất camera, gán mơ hồ, thiếu/không hỗ trợ biển hoặc có nhiều đặt chỗ cùng hiệu lực.

Đây là đối chiếu với trạng thái nghiệp vụ đang lưu lúc ingest. Gửi lại frame cũ sau khi đặt chỗ đã bị hủy/hoàn tất không tái dựng được toàn bộ trạng thái lịch sử trước khi hủy; kết quả gốc đã lưu không đổi. Không tự check-in/check-out hay thay trạng thái ô. Xe rời ô chưa chứng minh đã rời bãi.

### Xem dữ liệu

Đăng nhập ADMIN → **Quản trị → Camera AI · Biển số và đặt chỗ**. Bảng lịch sử phân trang, nút **Tải lại camera**, confidence riêng và kết quả đối chiếu. Không polling/WebSocket. Người dùng thường không được hiển thị bảng này.

API cần JWT:

- GET `/api/vision/observations?page=1&pageSize=20&cameraId=...&spotId=...&occupancyStatus=...`
- GET `/api/vision/observations/latest?cameraId=...`: latest cho mỗi cặp camera/ô.

ADMIN thấy các trường nhận diện; USER chỉ thấy tình trạng ô cơ bản như tuần 6, không biển số, reservationId, expectedPlate hay metadata. Không trả thông tin chủ xe trong các endpoint này.

SQL read-only trong pgAdmin:

```sql
SELECT camera_id, spot_id, observed_at, occupancy_status, recognition_status,
       plate_raw, plate_normalized, vehicle_confidence, plate_detection_confidence,
       association_confidence, ocr_confidence, plate_samples,
       match_status, match_reason, matched_reservation_id
FROM camera_observations ORDER BY observed_at DESC LIMIT 30;
```

## Kiểm tra và phụ thuộc thực nghiệm

```powershell
cd D:\DATN
npm.cmd run format:check
npm.cmd run lint
npm.cmd run build
npm.cmd test
# Chỉ bật integration khi PostgreSQL đã chạy và đã migrate:
$env:RUN_DB_TESTS = "true"
npm.cmd test
Remove-Item Env:\RUN_DB_TESTS
cd services\vision
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m compileall -q vision tests
# Test thêm runtime OCR trên chữ tổng hợp (tải model lần đầu, không phải ảnh bãi xe):
$env:RUN_OCR_TESTS = "true"
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
Remove-Item Env:\RUN_OCR_TESTS
```

Test dùng prediction/detection giả để kiểm tra logic, không phải bằng chứng chất lượng AI. Không có ảnh cá nhân/camera/model biển số thực trong repository. Cần bổ sung ảnh in lớn, video nhiều frame rõ/mờ, 3–4 ROI đúng UUID và thiết bị thật để đo tỉ lệ đọc đúng, đọc sai, không đọc, gán sai ô, FPS/độ trễ. Thử xe đồ chơi trước khi chọn/huấn luyện detector phù hợp. Không có cam kết độ chính xác khi chưa đo.

ESP32/MQTT/cảm biến ngoài phạm vi. WebSocket để tuần 9.
