-- Upgrade from spot-based monitoring to gate-barrier lot-capacity control.
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_REQUIRED', 'UNPAID', 'PAID');
CREATE TYPE "GateDirection" AS ENUM ('ENTRY', 'EXIT', 'UNKNOWN');
CREATE TYPE "GateEventSource" AS ENUM ('CAMERA', 'MANUAL');
CREATE TYPE "GateDecision" AS ENUM ('ALLOW', 'DENY', 'COOLDOWN');
CREATE TYPE "BarrierAction" AS ENUM ('OPEN', 'STAY_CLOSED');
CREATE TYPE "GateCommandStatus" AS ENUM ('PENDING', 'EXECUTED', 'EXPIRED');

-- 1. Vehicles: normalize plate lookup for gate camera OCR matching.
ALTER TABLE "vehicles" ADD COLUMN "plate_normalized" TEXT;
UPDATE "vehicles"
SET "plate_normalized" = UPPER(REGEXP_REPLACE("plate_number", '[\s.\-‐-―]+', '', 'g'));
ALTER TABLE "vehicles" ALTER COLUMN "plate_normalized" SET NOT NULL;
ALTER TABLE "vehicles" ALTER COLUMN "type" SET DEFAULT 'CAR';
DROP INDEX IF EXISTS "vehicles_plate_number_key";
CREATE UNIQUE INDEX "vehicles_plate_normalized_key" ON "vehicles"("plate_normalized");

-- 2. Parking lots: capacity replaces individual ParkingSpot rows.
ALTER TABLE "parking_lots" ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "parking_lots" ADD CONSTRAINT "parking_lots_capacity_chk" CHECK ("capacity" >= 1);

-- 3. Reservations & ParkingSessions: link directly to ParkingLot + paymentStatus.
ALTER TABLE "reservations" ADD COLUMN "lot_id" UUID;
ALTER TABLE "reservations" ADD COLUMN "payment_status" "PaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED';
UPDATE "reservations" r
SET "lot_id" = a."lot_id"
FROM "parking_spots" s
JOIN "parking_areas" a ON a."id" = s."area_id"
WHERE r."spot_id" = s."id";
ALTER TABLE "reservations" ALTER COLUMN "lot_id" SET NOT NULL;

ALTER TABLE "parking_sessions" ADD COLUMN "lot_id" UUID;
UPDATE "parking_sessions" ps
SET "lot_id" = a."lot_id"
FROM "parking_spots" s
JOIN "parking_areas" a ON a."id" = s."area_id"
WHERE ps."spot_id" = s."id";
ALTER TABLE "parking_sessions" ALTER COLUMN "lot_id" SET NOT NULL;

DROP INDEX IF EXISTS "reservations_one_active_per_spot";
DROP INDEX IF EXISTS "reservations_spot_id_idx";
ALTER TABLE "reservations" DROP CONSTRAINT IF EXISTS "reservations_spot_id_fkey";
ALTER TABLE "reservations" DROP COLUMN "spot_id";
CREATE INDEX "reservations_lot_id_idx" ON "reservations"("lot_id");
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "parking_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "parking_sessions_one_active_per_spot";
DROP INDEX IF EXISTS "parking_sessions_spot_id_idx";
ALTER TABLE "parking_sessions" DROP CONSTRAINT IF EXISTS "parking_sessions_spot_id_fkey";
ALTER TABLE "parking_sessions" DROP COLUMN "spot_id";
CREATE INDEX "parking_sessions_lot_id_idx" ON "parking_sessions"("lot_id");
ALTER TABLE "parking_sessions"
  ADD CONSTRAINT "parking_sessions_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "parking_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Drop obsolete spot-level ROI tables and enums.
DROP TABLE IF EXISTS "vision_alerts";
DROP TABLE IF EXISTS "camera_observations";
DROP TABLE IF EXISTS "parking_spots";
DROP TABLE IF EXISTS "parking_areas";

DROP TYPE IF EXISTS "VisionAlertStatus";
DROP TYPE IF EXISTS "VisionAlertType";
DROP TYPE IF EXISTS "ReservationMatchStatus";
DROP TYPE IF EXISTS "RecognitionStatus";
DROP TYPE IF EXISTS "OccupancyStatus";
DROP TYPE IF EXISTS "SpotStatus";

-- 5. Create GateEvent and GateCommand tables.
CREATE TABLE "gate_events" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "gate_id" TEXT NOT NULL,
  "lot_id" UUID,
  "direction" "GateDirection" NOT NULL,
  "source" "GateEventSource" NOT NULL DEFAULT 'CAMERA',
  "decision" "GateDecision" NOT NULL,
  "barrier_action" "BarrierAction" NOT NULL,
  "reason" TEXT NOT NULL,
  "plate_raw" TEXT,
  "plate_normalized" TEXT,
  "ocr_confidence" DOUBLE PRECISION,
  "plate_samples" INTEGER NOT NULL DEFAULT 0,
  "reservation_id" UUID,
  "session_id" UUID,
  "actor_id" UUID,
  "metadata" JSONB,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gate_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gate_events_gate_id_occurred_at_idx" ON "gate_events"("gate_id", "occurred_at");
CREATE INDEX "gate_events_plate_normalized_occurred_at_idx" ON "gate_events"("plate_normalized", "occurred_at");
CREATE INDEX "gate_events_decision_occurred_at_idx" ON "gate_events"("decision", "occurred_at");
ALTER TABLE "gate_events"
  ADD CONSTRAINT "gate_events_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "parking_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "gate_commands" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "gate_id" TEXT NOT NULL,
  "lot_id" UUID,
  "command" TEXT NOT NULL DEFAULT 'OPEN',
  "duration_ms" INTEGER NOT NULL DEFAULT 5000,
  "status" "GateCommandStatus" NOT NULL DEFAULT 'PENDING',
  "requested_by" UUID,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "executed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gate_commands_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gate_commands_gate_id_status_expires_at_idx" ON "gate_commands"("gate_id", "status", "expires_at");
