# Data Model

## Main Tables

- `users`: tai khoan, role `USER` hoac `ADMIN`, password duoc bam bang bcrypt.
- `vehicles`: bien so va loai xe, thuoc mot user.
- `parking_lots`: bai xe.
- `parking_areas`: khu/tang trong bai xe.
- `parking_spots`: vi tri do, co status `AVAILABLE`, `RESERVED`, `OCCUPIED`, `INACTIVE`.
- `reservations`: dat cho, gan user/vehicle/spot.
- `parking_sessions`: luot gui xe thuc te, check-in/check-out.
- `audit_logs`: nhat ky hanh dong quan trong.

## Consistency Rules

`parking_spots.status` la trang thai hien tai de truy van nhanh, nhung cac bang reservation/session moi la nguon ranh gioi nghiep vu.

Rang buoc PostgreSQL:

- Mot spot chi co toi da mot reservation hop le voi status `PENDING`, `CONFIRMED`, `CHECKED_IN`.
- Mot vehicle chi co toi da mot reservation hop le.
- Mot spot chi co toi da mot parking session `ACTIVE`.
- Mot vehicle chi co toi da mot parking session `ACTIVE`.

API cap nhat status spot trong transaction:

- Dat cho thanh cong: `AVAILABLE` -> `RESERVED`.
- Huy dat cho: `RESERVED` -> `AVAILABLE`.
- Check-in: `RESERVED` hoac `AVAILABLE` -> `OCCUPIED`.
- Check-out: `OCCUPIED` -> `AVAILABLE`.

Neu co sensor/camera ve sau, module IoT/vision khong duoc tu y ghi de trang thai ma phai di qua API hoac command handler co transaction tuong tu.
