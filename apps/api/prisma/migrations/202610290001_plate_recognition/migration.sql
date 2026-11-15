-- Additive only: keep week 6 observations and all business records.
CREATE TYPE "RecognitionStatus" AS ENUM ('NOT_REQUESTED', 'NO_VEHICLE', 'UNREADABLE', 'READ', 'CAMERA_LOST', 'AMBIGUOUS');
CREATE TYPE "ReservationMatchStatus" AS ENUM ('MATCH', 'MISMATCH', 'NO_RESERVATION', 'INSUFFICIENT');
ALTER TABLE "camera_observations"
  ADD COLUMN "recognition_status" "RecognitionStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "plate_raw" TEXT,
  ADD COLUMN "plate_normalized" TEXT,
  ADD COLUMN "vehicle_confidence" DOUBLE PRECISION,
  ADD COLUMN "plate_detection_confidence" DOUBLE PRECISION,
  ADD COLUMN "association_confidence" DOUBLE PRECISION,
  ADD COLUMN "ocr_confidence" DOUBLE PRECISION,
  ADD COLUMN "plate_samples" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "match_status" "ReservationMatchStatus" NOT NULL DEFAULT 'INSUFFICIENT',
  ADD COLUMN "match_reason" TEXT NOT NULL DEFAULT 'legacy_observation',
  ADD COLUMN "matched_reservation_id" UUID,
  ADD COLUMN "expected_plate" TEXT;
-- Historical snapshots, no cascading FK to reservations.
CREATE INDEX "camera_observations_match_status_observed_at_idx" ON "camera_observations"("match_status", "observed_at");
