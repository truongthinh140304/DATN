# Vision Service Contract

Thu muc nay danh cho module Python/OpenCV/YOLO/PaddleOCR o giai doan sau. Hien tai chua cai AI, chua co model, chua xu ly camera.

## Expected Input

Camera hoac video frame se duoc cau hinh sau khi co thiet bi va du lieu mau:

```json
{
  "cameraId": "gate-01",
  "frameId": "20260927T080000.000Z-001",
  "capturedAt": "2026-09-27T08:00:00.000Z",
  "roiId": "entrance-lane-1"
}
```

## Expected Output

```json
{
  "cameraId": "gate-01",
  "eventType": "PLATE_RECOGNIZED",
  "capturedAt": "2026-09-27T08:00:00.000Z",
  "plateNumber": "30A-12345",
  "confidence": 0.94,
  "roiId": "entrance-lane-1",
  "imageRef": "local-or-object-storage-path",
  "metadata": {
    "detector": "yolo",
    "ocr": "paddleocr"
  }
}
```

Backend tuan sau se doi chieu `plateNumber` voi `vehicles` va reservation/session dang hop le. Khong nen luu anh, video, model AI vao Git.
