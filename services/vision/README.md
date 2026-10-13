# Smart Parking Vision Service

Module Python tuần 6 đọc webcam, MP4 hoặc RTSP, dùng Ultralytics YOLO để phát hiện phương tiện và ánh xạ kết quả vào năm polygon A01-A05. Module chỉ gửi **kết quả quan sát** sang Express; nó không thay đổi đặt chỗ, check-in, check-out hay trạng thái nghiệp vụ của vị trí.

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
