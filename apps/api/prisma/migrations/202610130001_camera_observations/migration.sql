CREATE TYPE "OccupancyStatus" AS ENUM ('EMPTY', 'OCCUPIED', 'UNKNOWN');

CREATE TABLE "camera_observations" (
    "id" UUID NOT NULL,
    "camera_id" TEXT NOT NULL,
    "spot_id" UUID NOT NULL,
    "occupancy_status" "OccupancyStatus" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "camera_observations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "camera_observations_camera_id_observed_at_idx"
ON "camera_observations"("camera_id", "observed_at");

CREATE INDEX "camera_observations_spot_id_observed_at_idx"
ON "camera_observations"("spot_id", "observed_at");

ALTER TABLE "camera_observations"
ADD CONSTRAINT "camera_observations_spot_id_fkey"
FOREIGN KEY ("spot_id") REFERENCES "parking_spots"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
