# Smart Parking Vision Service

Cửa sổ chạy tích hợp `npm.cmd run vision:run` tự thu vừa tối đa 1100×650 và cho phép kéo giãn để thấy đủ các ô. Chỉ cửa sổ xem được thu nhỏ; YOLO, ROI và OCR vẫn xử lý frame gốc. Nhấn **R** để chọn lại vùng biển số nếu xe/camera đã di chuyển.

Module Python đọc webcam, MP4 hoặc RTSP, dùng Ultralytics YOLO phát hiện phương tiện và ánh xạ vào các polygon theo dữ liệu cấu hình (có thể chọn 3–4 ô). Tuần 7–8 bổ sung OCR biển số, gán với xe/ô và gửi **kết quả quan sát** sang Express. Không thay đổi đặt chỗ, check-in, check-out hay trạng thái nghiệp vụ.

**Tuần 7–8:** [cài PaddleOCR, chạy ảnh/webcam/video, cấu hình model riêng hoặc vùng thủ công](../../docs/week7-8-plates.md). `yolo11n.pt` không phải model biển số, chưa kiểm định trên xe đồ chơi. Dùng `python -m vision.plate_cli` để thử OCR độc lập; thêm `plateConfig` vào settings để tích hợp. Model biển số không kèm sẵn.

## Demo nhanh webcam: xe và biển số viết tay

Sau khi cài `requirements-ocr.txt`, không cần ROI ô đỗ hoặc database:

```powershell
cd D:\DATN\services\vision
.\.venv\Scripts\python.exe -m vision.camera_demo --source 0
```

Demo mặc định chọn camera **số 0**, dùng **DirectShow trên Windows** để kết nối webcam USB/local; không mặc định chọn nguồn điện thoại số 1. Với webcam USB Windows hiện nhận là `USB2.0 HD UVC WebCam`, chạy:

```powershell
cd D:\DATN\services\vision
.\.venv\Scripts\python.exe -m vision.camera_demo
# Hoặc ghi rõ nguồn/backend:
.\.venv\Scripts\python.exe -m vision.camera_demo --source 0 --backend dshow
```

Nếu máy có nhiều camera, chỉ số có thể thay đổi; dùng `--source` chỉ rõ camera USB cần chọn. Chương trình in `CAMERA_SOURCE` và backend khi mở, không tự chuyển sang camera điện thoại khi nguồn đã chọn không mở được.

YOLO hiển thị hộp xe và confidence. Đưa giấy biển số viết chữ in hoa, nét đậm vào khung xanh ngọc để thử OCR; nhấn **R** khoanh vùng sát biển, **Enter** xác nhận, **C** xóa kết quả, **Q/Esc** thoát. Đây là OCR vùng chọn thủ công, độc lập với nhận diện xe. Số xe bằng 0 chỉ nghĩa là model chưa phát hiện xe. Chưa khẳng định nhận được xe đồ chơi hoặc chữ viết tay. Demo không ghi hình hoặc gửi API, chỉ hiển thị và in kết quả thực ra terminal. Model phương tiện tải lần đầu vào `models/` đã ignore.

Trạng thái OCR: `TEXT_ONLY` = đọc được chữ nhưng chưa đúng định dạng biển hỗ trợ; `PENDING` = cần thêm frame ổn định; `READ` = đủ đồng thuận/định dạng; `UNREADABLE` = chưa đọc được hoặc ảnh mờ; `WAITING` = kết quả cũ, đang chờ frame mới. Ví dụ giấy chỉ ghi `61A123` vẫn thử đọc chữ được, nhưng chưa đủ số ký tự để xác nhận biển số. Không sửa kết quả OCR thành một biển số mẫu.

Tài liệu đầy đủ: [`docs/week6-vision.md`](../../docs/week6-vision.md).

## Cài đặt trên Windows

Yêu cầu Python 3.10-3.12. Từ thư mục `D:\DATN`:

```powershell
cd services\vision
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Nếu PowerShell chặn script kích hoạt, chạy một lần trong cửa sổ hiện tại:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Lần đầu chạy YOLO, Ultralytics có thể tải model nhỏ `yolo11n.pt`. Model, video và file cấu hình thật đều đã được `.gitignore` loại khỏi Git.

## Tạo cấu hình

```powershell
Copy-Item config\vision.example.json config\vision.json
Copy-Item config\spots.example.json config\spots.json
```

Lấy UUID thật của A01-A05 từ PostgreSQL rồi thay các giá trị `replace-with-database-uuid-*` trong `config\spots.json`:

```sql
SELECT ps.id, ps.code
FROM parking_spots AS ps
WHERE ps.code IN ('A01', 'A02', 'A03', 'A04', 'A05')
ORDER BY ps.code;
```

## Vẽ ROI

Webcam laptop:

```powershell
python -m vision.roi_tool --source 0 --spots config\spots.json --output config\parking_rois.json
```

Video MP4:

```powershell
python -m vision.roi_tool --source "D:\video\bai-xe.mp4" --spots config\spots.json --output config\parking_rois.json
```

Trong công cụ ROI: chuột trái thêm điểm, chuột phải bỏ điểm cuối, `Enter` xác nhận polygon, `R` vẽ lại polygon hiện tại, `Q` hoặc `Esc` thoát. Tọa độ được lưu dạng chuẩn hóa nên dùng được khi độ phân giải nguồn thay đổi cùng tỉ lệ khung hình.

## Chạy nhận diện

Đặt cùng một khóa bí mật `VISION_API_KEY` trong `apps\api\.env` và phiên PowerShell chạy Python:

```powershell
$env:VISION_API_KEY="thay-bang-khoa-bi-mat-dai"
python -m vision --settings config\vision.json
```

Phím điều khiển: `Space` tạm dừng/tiếp tục, `Q` hoặc `Esc` thoát. Chạy không gửi API để kiểm tra cục bộ:

```powershell
python -m vision --settings config\vision.json --no-api
```

Chạy test không cần camera và không cần tải model:

```powershell
python -m unittest discover -s tests -v
```
