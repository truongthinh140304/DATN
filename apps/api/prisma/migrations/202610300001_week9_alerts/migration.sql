CREATE TYPE "VisionAlertType" AS ENUM ('WRONG_SPOT', 'PLATE_MISMATCH', 'UNRESERVED_VEHICLE');
CREATE TYPE "VisionAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TABLE "vision_alerts" (
  "id" UUID NOT NULL,
  "active_key" TEXT,
  "type" "VisionAlertType" NOT NULL,
  "status" "VisionAlertStatus" NOT NULL DEFAULT 'OPEN',
  "camera_id" TEXT NOT NULL,
  "spot_id" UUID NOT NULL,
  "expected_spot_id" UUID,
  "expected_spot_code" TEXT,
  "plate_normalized" TEXT NOT NULL,
  "expected_plate" TEXT,
  "reservation_id" UUID,
  "observation_id" UUID NOT NULL,
  "first_seen_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL,
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "acknowledged_at" TIMESTAMP(3),
  "acknowledged_by" UUID,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vision_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vision_alerts_spot_id_fkey" FOREIGN KEY ("spot_id") REFERENCES "parking_spots"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "vision_alerts_active_key_key" ON "vision_alerts"("active_key");
CREATE INDEX "vision_alerts_camera_id_spot_id_last_seen_at_idx" ON "vision_alerts"("camera_id", "spot_id", "last_seen_at");
CREATE INDEX "vision_alerts_status_last_seen_at_idx" ON "vision_alerts"("status", "last_seen_at");
