# Tuần 6 - Camera AI, OpenCV, YOLO và ROI

## 1. Phạm vi đã triển khai

Vision Service là một tiến trình Python độc lập trong `services/vision`. Luồng xử lý:

1. Đọc frame từ webcam, file MP4 hoặc RTSP bằng OpenCV.
2. Phát hiện `car`, `motorcycle`, `bus`, `truck` bằng model pretrained nhỏ `yolo11n.pt`.
3. Đánh giá độ giao nhau giữa bounding box và từng polygon, kết hợp ba điểm đại diện ở đáy xe.
4. Mỗi detection chỉ được gán cho một vị trí khi bằng chứng đủ mạnh và không mơ hồ.
5. Làm ổn định trạng thái qua nhiều frame để giảm nhấp nháy.
6. Hiển thị polygon, bounding box, nhãn, FPS và tổng số vị trí có xe.
7. Gửi quan sát đã xác thực vào API Express để lưu lịch sử.

Ba trạng thái quan sát camera:

- `EMPTY`: không phát hiện phương tiện trong ROI.
- `OCCUPIED`: có detection đủ độ tin cậy và đủ bằng chứng hình học.
- `UNKNOWN`: camera mất tín hiệu, detection yếu hoặc xe nằm mơ hồ giữa nhiều ROI.

`occupancyStatus` là kết quả quan sát, không phải `parking_spots.status`. Camera không được tự đổi `AVAILABLE`, `RESERVED`, `OCCUPIED`, không tạo/hủy đặt chỗ và không check-in/check-out.

## 2. Cài Python trên Windows

Kiểm tra Python:

```powershell
py --version
```

Nếu chưa có, tải Python 3.11 từ [python.org](https://www.python.org/downloads/windows/) và chọn **Add Python to PATH** khi cài. Sau đó:

```powershell
cd D:\DATN\services\vision
py -3.11 -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

CPU là mặc định (`"device": "cpu"`). GPU là tùy chọn; chỉ đổi thành `"device": "0"` sau khi đã cài PyTorch/CUDA tương thích. Không cần GPU để demo năm vị trí.

## 3. Chuẩn bị ánh xạ A01-A05

Sao chép cấu hình mẫu:

```powershell
Copy-Item config\vision.example.json config\vision.json
Copy-Item config\spots.example.json config\spots.json
```

Trong pgAdmin Query Tool của database `smart_parking`, chạy:

```sql
SELECT ps.id, ps.code, pa.code AS area_code, pl.name AS lot_name
FROM parking_spots AS ps
JOIN parking_areas AS pa ON pa.id = ps.area_id
JOIN parking_lots AS pl ON pl.id = pa.lot_id
WHERE ps.code IN ('A01', 'A02', 'A03', 'A04', 'A05')
ORDER BY ps.code;
```

Thay các UUID mẫu trong `config/spots.json` bằng UUID thật. `code` dùng để hiển thị; `spotId` là khóa ngoại gửi tới backend.

## 4. Chọn nguồn hình ảnh

Sửa `source` trong `config/vision.json`:

```json
{ "source": 0 }
```

- `0`: webcam mặc định của laptop; thử `1` nếu có webcam USB.
- `"D:\\video\\bai-xe.mp4"`: file MP4.
- `"rtsp://user:password@192.168.1.10:554/stream"`: camera IP.

Không commit URL RTSP có mật khẩu, video thật hoặc model weights.

## 5. Vẽ polygon cho năm vị trí

Webcam:

```powershell
python -m vision.roi_tool --source 0 --spots config\spots.json --output config\parking_rois.json
```

MP4:

```powershell
python -m vision.roi_tool --source "D:\video\bai-xe.mp4" --spots config\spots.json --output config\parking_rois.json
```

RTSP:

```powershell
python -m vision.roi_tool --source "rtsp://user:password@host/stream" --spots config\spots.json --output config\parking_rois.json
```

Thao tác:

- Chuột trái: thêm đỉnh polygon.
- Chuột phải: xóa đỉnh vừa thêm.
- `Enter`: lưu polygon hiện tại và chuyển sang vị trí kế tiếp.
- `R`: vẽ lại polygon hiện tại.
- `Q` hoặc `Esc`: thoát không hoàn tất.

Mỗi polygon cần ít nhất ba điểm và nên bao phủ phần mặt đất mà xe chiếm. Công cụ lưu tọa độ chuẩn hóa từ 0 đến 1. Nếu đổi tỉ lệ khung hình hoặc đổi góc camera, phải vẽ ROI lại.

## 6. Chạy API và Vision Service

Tạo khóa riêng dài và đặt trong `apps/api/.env`:

```dotenv
VISION_API_KEY=mot-khoa-bi-mat-dai-khong-commit
```

Terminal 1, từ `D:\DATN`:

```powershell
npm.cmd run db:migrate
npm.cmd run dev
```

Terminal 2:

```powershell
cd D:\DATN\services\vision
.\.venv\Scripts\Activate.ps1
$env:VISION_API_KEY="mot-khoa-bi-mat-dai-khong-commit"
python -m vision --settings config\vision.json
```

Tùy chọn:

```powershell
# Không gửi kết quả tới backend
python -m vision --settings config\vision.json --no-api

# Không mở cửa sổ; hữu ích khi thử file/video tự động
python -m vision --settings config\vision.json --headless --max-frames 100
```

Lần chạy đầu Ultralytics có thể tải `yolo11n.pt`; cần Internet ở bước đó. `Space` tạm dừng/tiếp tục, `Q` hoặc `Esc` thoát.

## 7. Hợp đồng dữ liệu với Express

Vision Service gửi `POST /api/vision/observations` với header:

```http
x-vision-api-key: <VISION_API_KEY>
```

Một quan sát:

```json
{
  "cameraId": "parking-camera-01",
  "spotId": "uuid-cua-parking-spot",
  "occupancyStatus": "OCCUPIED",
  "confidence": 0.88,
  "timestamp": "2026-10-13T10:30:00.000Z",
  "metadata": {
    "detector": "yolo11n.pt",
    "device": "cpu",
    "frameWidth": 1280,
    "frameHeight": 720
  }
}
```

Endpoint cũng nhận batch `{ "observations": [...] }`, tối đa 50 phần tử. API kiểm tra khóa, UUID vị trí, trạng thái, confidence 0-1 và timestamp rồi ghi vào `camera_observations`.

Người dùng đã đăng nhập có thể đọc:

- `GET /api/vision/observations?page=1&pageSize=20`
- `GET /api/vision/observations?cameraId=parking-camera-01&occupancyStatus=UNKNOWN`
- `GET /api/vision/observations/latest?cameraId=parking-camera-01`

Các API GET dùng JWT như phần còn lại của hệ thống. Tuần 6 chưa ghép trạng thái camera vào dashboard thời gian thực và chưa dùng WebSocket.

## 8. Kiểm thử

Test hình học và logic không cần camera/model:

```powershell
cd D:\DATN\services\vision
python -m unittest discover -s tests -v
python -m compileall -q vision tests
```

Test backend và database, từ thư mục gốc:

```powershell
npm.cmd run lint
npm.cmd run build
$env:RUN_DB_TESTS="true"
npm.cmd run test
```

Test Python bao phủ polygon, giao polygon/bounding box, tọa độ chuẩn hóa, một xe không bị gán vào hai ô, detection yếu, làm ổn định nhiều frame, mất camera và nguồn video không hợp lệ.

## 9. Ảnh cần chụp cho báo cáo

1. Terminal hiển thị phiên bản Python, virtual environment và cài thư viện.
2. Công cụ ROI với đủ polygon A01-A05 và nhãn từng vị trí.
3. Cửa sổ chạy nhận diện có polygon, bounding box, FPS và số ô có xe.
4. Ba trường hợp `EMPTY`, `OCCUPIED`, `UNKNOWN` trên dữ liệu thật.
5. pgAdmin hiển thị các bản ghi trong `camera_observations`.
6. Kết quả 11 unit test Python và 6 test backend.

Chỉ dùng ảnh chạy trên webcam/video thực tế của bạn làm minh chứng AI; file polygon mẫu không phải kết quả nhận diện thực tế.

## 10. Chuẩn bị tuần 7

- Chuẩn bị ảnh/video lối vào có biển số đủ rõ, góc chụp ổn định và điều kiện sáng khác nhau.
- Xác định quy tắc chuẩn hóa biển số và ngưỡng tin cậy.
- Sau đó mới tích hợp PaddleOCR và đối chiếu với `vehicles`, `reservations`, `parking_sessions`.
- Thiết kế luồng xác nhận thủ công khi OCR không chắc chắn.

Tuần 6 không cài hoặc triển khai PaddleOCR và không tự động hóa check-in/check-out.
