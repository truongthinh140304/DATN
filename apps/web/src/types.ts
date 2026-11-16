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
  capacity: number;
  isActive: boolean;
  activeReservations: number;
  activeSessions: number;
  usedSlots: number;
  availableSlots: number;
};

export type Vehicle = {
  id: string;
  ownerId: string;
  plateNumber: string;
  plateNormalized?: string;
  type: "MOTORBIKE" | "CAR" | "OTHER";
  brand?: string | null;
  color?: string | null;
  isActive: boolean;
};

export type PaymentStatus = "NOT_REQUIRED" | "UNPAID" | "PAID";

export type ReservationStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "EXPIRED"
  | "CHECKED_IN"
  | "COMPLETED";

export type Reservation = {
  id: string;
  userId?: string;
  vehicleId?: string;
  lotId?: string;
  status: ReservationStatus;
  paymentStatus: PaymentStatus;
  startsAt: string;
  expiresAt: string;
  cancelledAt?: string | null;
  checkedInAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  vehicle: Vehicle;
  lot: {
    id: string;
    name: string;
    address: string;
    capacity?: number;
  };
};

export type ParkingSession = {
  id: string;
  userId?: string;
  vehicleId?: string;
  lotId?: string;
  reservationId?: string | null;
  status: "ACTIVE" | "COMPLETED";
  checkedInAt: string;
  checkedOutAt?: string | null;
  notes?: string | null;
  vehicle: Vehicle;
  lot: {
    id: string;
    name: string;
    address: string;
    capacity?: number;
  };
  reservation?: {
    id: string;
    status: ReservationStatus;
    paymentStatus: PaymentStatus;
  } | null;
};

export type GateEvent = {
  id: string;
  gateId: string;
  lotId?: string | null;
  direction: "ENTRY" | "EXIT" | "UNKNOWN";
  source: "CAMERA" | "MANUAL";
  decision: "ALLOW" | "DENY" | "COOLDOWN";
  barrierAction: "OPEN" | "STAY_CLOSED";
  reason: string;
  plateRaw?: string | null;
  plateNormalized?: string | null;
  ocrConfidence?: number | null;
  plateSamples?: number | null;
  reservationId?: string | null;
  sessionId?: string | null;
  actorId?: string | null;
  occurredAt: string;
  lot?: {
    id: string;
    name: string;
  } | null;
};

export type GateHardwareStatus = {
  gateId: string;
  lotId: string | null;
  cameraConnected: boolean;
  arduinoConnected: boolean;
  arduinoPort: string | null;
  lastHeartbeatAt: string;
  lastScanAt: string | null;
  lastPlate: string | null;
  stale?: boolean;
};

export type GateStatusResponse = {
  gates: GateHardwareStatus[];
  latestEvent: GateEvent | null;
  pendingCommands: number;
};

export type ListResponse<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};
