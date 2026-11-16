# Firmware Arduino Uno R3 · Điều khiển cổng barie

File mã nguồn: [gate_controller.ino](gate_controller.ino)

## Sơ đồ chân (khớp mô hình đã dựng)

| Chân trên Arduino Uno R3 | Kết nối phần cứng                         | Ghi chú                                                              |
| ------------------------ | ----------------------------------------- | -------------------------------------------------------------------- |
| `D4`                     | Dây tín hiệu (cam) của **Servo SG90**     | PWM điều khiển góc thanh chắn                                        |
| `D2`                     | Cảm biến hồng ngoại **IR1** (trước barie) | Chờ sẵn trong code (`USE_IR_SENSORS = false`)                        |
| `D3`                     | Cảm biến hồng ngoại **IR2** (sau barie)   | Chờ sẵn trong code (`USE_IR_SENSORS = false`)                        |
| `GND`                    | Cụm `GND` trên Breadboard mini            | **Bắt buộc nối chung GND** giữa Arduino, Adapter 5V DC và Servo SG90 |

> Nguồn `+5V` cấp cho dây đỏ Servo SG90 lấy từ **Adapter 5V DC** qua Breadboard (không cấp nguồn servo từ chân 5V của Arduino để tránh sụt áp reset mạch).

## Nạp code vào Arduino Uno R3

1. Mở **Arduino IDE** → mở file `firmware/gate_controller/gate_controller.ino`.
2. Chọn **Tools → Board → Arduino Uno** và chọn đúng cổng **Port (`COMx`)**.
3. Nhấn **Upload**.
4. Mở **Serial Monitor** ở tốc độ **`9600 baud`** (`Newline`), gửi thử:
   - `PING` → trả về `PONG`
   - `OPEN` → servo quay từ `60°` lên `120°`, giữ 5 giây rồi tự hạ về `60°`
   - `CLOSE` → hạ thanh chắn ngay

> Góc đóng/mở mặc định đã chỉnh theo mô hình thực tế (`60°` đóng, `120°` mở). Nếu thay đổi cơ cấu cần gạt, chỉnh lại 2 hằng số `ANGLE_CLOSED` và `ANGLE_OPEN` ở đầu file `.ino`.
