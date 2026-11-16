# Smart Parking Gate Vision Service (Python + YOLO + PaddleOCR + Arduino Serial)

Tiến trình chạy trên laptop kết nối đồng thời:

1. **Webcam USB** hướng vào biển số xe trước cổng.
2. **Backend API** (`POST /api/gate/scan`, `POST /api/gate/heartbeat`, `POST /api/gate/commands/claim`).
3. **Arduino Uno R3** qua cổng USB Serial (`9600` baud) để nâng/hạ Servo SG90 ở chân `D4`.

## Cài đặt môi trường `.venv` (Windows)

```powershell
cd services/vision
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-ocr.txt
```

> Lưu ý: `requirements-ocr.txt` đã gồm `ultralytics`, `paddleocr`, `paddlepaddle`, `opencv-python`, `requests`, `pyserial`.

## Cấu hình `config/gate.json`

Sao chép từ mẫu nếu chưa có:

```powershell
copy config\gate.example.json config\gate.json
```

Các trường chính trong `config/gate.json`:

- `gateId`: mã cổng (mặc định `"main-gate-01"`).
- `lotId`: để `null` để tự lấy bãi duy nhất từ `GET /api/gate/lots`, hoặc điền UUID của bãi.
- `source`: `0` (webcam mặc định), `"1"`, đường dẫn video `.mp4`, hoặc RTSP URL.
- `plateMode`:
  - `"scan_zone"` (khuyên dùng cho mô hình): OCR đọc trong khung `scanRegion` trước cổng — hoạt động được cả với xe thật lẫn xe mô hình / biển số in giấy.
  - `"full_frame"`: quét toàn bộ khung hình.
  - `"model"`: dùng model YOLO phát hiện biển số riêng qua `plateModelPath`.
- `scanRegion`: `[x1, y1, x2, y2]` chuẩn hóa `0..1` (có thể chỉnh trực tiếp trên màn hình bằng phím `R`).
- `arduino`:
  - `enabled`: `true` / `false`
  - `port`: `"auto"` (tự tìm cổng Uno / CH340 / FTDI) hoặc chỉ định rõ `"COM5"`
  - `baudrate`: `9600`
  - `openMs`: `5000` (mở barie 5 giây rồi tự đóng).

## Kiểm tra thiết bị & Chạy

Từ thư mục gốc repo:

```bash
npm run gate:preflight
npm run gate:run
```

Hoặc chạy trực tiếp bằng Python trong `services/vision`:

```powershell
.venv\Scripts\python.exe -m vision.preflight
.venv\Scripts\python.exe -m vision --settings config/gate.json
```

Tham số dòng lệnh của `python -m vision`:

- `--settings <path>`: file cấu hình JSON (mặc định `config/gate.json`).
- `--no-arduino`: chạy giả lập lệnh mở barie không cần mở cổng COM.
- `--no-api`: chỉ test camera + OCR cục bộ, không gọi API backend.
- `--headless`: chạy nền không mở cửa sổ OpenCV.
- `--max-frames <n>`: dừng sau `<n>` khung hình (`0` = chạy liên tục).
