# Đặt chỗ và xác minh đúng xe tại đúng ô

1. Người dùng vào **Phương tiện**, thêm biển đúng với biển gắn trên xe (ví dụ `51H2342`).
2. Vào **Đặt chỗ**, chọn phương tiện đó và ô A01, xác nhận đặt chỗ.
3. Trong cùng trang, bảng **Xác minh xe đã đặt** hiển thị ô, biển đã đặt và trạng thái chờ camera. Có thể chọn lượt khác để xem.
4. Đặt xe tại A01, hướng biển về camera cố định. Với detector biển thủ công hiện tại, nhấn **R**, khoanh sát biển số, **Enter**. Khi chuyển xe sang vị trí khác phải chọn lại vùng biển.
5. Khi YOLO gán được đúng ô, OCR đọc `READ`, có ít nhất 3 mẫu ổn định và đạt ngưỡng confidence, backend chuẩn hóa rồi đối chiếu với lượt đặt hiệu lực tại A01 và thời điểm quan sát. Bảng tự cập nhật qua WebSocket, có nút tải lại.

Ví dụ: A01 đặt `51H2342`, camera đọc `51h-23.42` → **Khớp đặt chỗ — đúng xe, đúng ô** (xanh). Camera đọc `51H9999` → **Không khớp biển số đã đặt** (đỏ). Cùng biển xuất hiện tại A02 không xác nhận cho A01; admin có cảnh báo sai ô khi đủ bằng chứng. Chưa thấy xe, chưa đọc rõ, mơ hồ xe/ô, mất camera hoặc bằng chứng yếu → **Chưa đủ thông tin**, không kết luận sai biển.

`GET /api/reservations/:id/verification` yêu cầu JWT và chỉ cho chủ lượt đặt hoặc ADMIN. Trả về `expectedPlate`, `spotCode`, `matchStatus`, `reason`, `observation` tối thiểu. USER chỉ thấy biển nhận diện khi trùng xe của mình; biển khác được ẩn, ADMIN xem chi tiết trong **Quản trị → Camera AI** với hai cột **Biển camera đọc / Biển đã đặt**. Không trả thông tin cá nhân chủ xe khác hoặc metadata camera.

API xác minh là snapshot hiện tại, tính lại trên backend bằng cùng hàm đối chiếu của luồng ingest; không sửa lịch sử. Quan sát phải thuộc đúng spot UUID, sau khi tạo lượt đặt và trong khoảng `[startsAt, expiresAt)`. Quan sát quá 60 giây, vượt cửa sổ tương lai 30 giây, hoặc lượt chưa bắt đầu/hủy/hết hạn/hoàn tất không được hiển thị như xác nhận MATCH hiện tại. Khi camera dừng, màn hình kiểm tra lại mỗi 15 giây để bỏ kết quả cũ. Lịch sử đối chiếu tại thời điểm camera gửi và cảnh báo vẫn lưu như trước.

Không tự check-in/check-out hoặc thay đổi trạng thái ô chỉ vì biển số khớp. Không tạo sẵn lượt đặt/biển mẫu trong dữ liệu người dùng để ép MATCH. Phải kiểm tra kết quả OCR so với biển thật; test phần mềm không chứng minh độ chính xác nhận diện xe đồ chơi hay biển viết tay.

Kiểm tra đã bổ sung: ví dụ `51H2342` bằng unit test; API với dữ liệu fixture riêng cho đúng/sai biển, đúng/sai ô, phân quyền, thiếu mẫu, ảnh không đọc được, camera mất, hủy/hết hạn/chưa tới giờ, frame trước lúc đặt/tương lai/cũ. Browser E2E kiểm tra bảng của người đặt tự chuyển từ chờ → khớp → không khớp mà không tải lại, và không lộ biển khác.

Lượt kiểm tra triển khai ngày 30/10/2026: **49/49 API/DB/WebSocket**, **2/2 browser E2E**, build và lint đạt. Browser chạy tại cổng riêng 4111/5184 do cổng test mặc định đang được dùng; báo cáo ở `artifacts/reservation-verification/`. Detection/OCR trong test browser là fixture được kiểm soát, không phải phép đo camera thật. API làm việc ở cổng 4000 đã nạp lại, webcam đang gửi batch bốn ô. Chưa xác nhận một lượt thực nghiệm biển thật đã đạt MATCH trong phần bổ sung này.
