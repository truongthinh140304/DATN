export type UserRole = "USER" | "ADMIN";

export type User = {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
};

export type ParkingLot = {
  id: string;
  name: string;
  address: string;
  description?: string | null;
  isActive: boolean;
};

export type ParkingArea = {
  id: string;
  lotId: string;
  code: string;
  name: string;
  floor?: number | null;
  isActive: boolean;
  lot?: ParkingLot;
};

export type SpotStatus = "AVAILABLE" | "RESERVED" | "OCCUPIED" | "INACTIVE";

export type ParkingSpot = {
  id: string;
  areaId: string;
  code: string;
  status: SpotStatus;
  isActive: boolean;
  area: ParkingArea & { lot: ParkingLot };
};

export type Vehicle = {
  id: string;
  ownerId: string;
  plateNumber: string;
  type: "MOTORBIKE" | "CAR" | "OTHER";
  brand?: string | null;
  color?: string | null;
  isActive: boolean;
};

export type Reservation = {
  id: string;
  status:
    | "PENDING"
    | "CONFIRMED"
    | "CANCELLED"
    | "EXPIRED"
    | "CHECKED_IN"
    | "COMPLETED";
  startsAt: string;
  expiresAt: string;
  createdAt: string;
  vehicle: Vehicle;
  spot: ParkingSpot;
};

export type ParkingSession = {
  id: string;
  status: "ACTIVE" | "COMPLETED";
  checkedInAt: string;
  checkedOutAt?: string | null;
  vehicle: Vehicle;
  spot: ParkingSpot;
};

export type ListResponse<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};
