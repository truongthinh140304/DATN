CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "VehicleType" AS ENUM ('MOTORBIKE', 'CAR', 'OTHER');
CREATE TYPE "SpotStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'OCCUPIED', 'INACTIVE');
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'CHECKED_IN', 'COMPLETED');
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'COMPLETED');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "full_name" TEXT NOT NULL,
  "phone" TEXT,
  "role" "UserRole" NOT NULL DEFAULT 'USER',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vehicles" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "owner_id" UUID NOT NULL,
  "plate_number" TEXT NOT NULL,
  "type" "VehicleType" NOT NULL,
  "brand" TEXT,
  "color" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "parking_lots" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "parking_lots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "parking_areas" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "lot_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "floor" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "parking_areas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "parking_spots" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "area_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "status" "SpotStatus" NOT NULL DEFAULT 'AVAILABLE',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "parking_spots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reservations" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "user_id" UUID NOT NULL,
  "vehicle_id" UUID NOT NULL,
  "spot_id" UUID NOT NULL,
  "status" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
  "starts_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "cancelled_at" TIMESTAMP(3),
  "checked_in_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservations_time_order_chk" CHECK ("expires_at" > "starts_at")
);

CREATE TABLE "parking_sessions" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "user_id" UUID NOT NULL,
  "vehicle_id" UUID NOT NULL,
  "spot_id" UUID NOT NULL,
  "reservation_id" UUID,
  "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "checked_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checked_out_at" TIMESTAMP(3),
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "parking_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "actor_id" UUID,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" UUID,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "vehicles_plate_number_key" ON "vehicles"("plate_number");
CREATE UNIQUE INDEX "parking_areas_lot_id_code_key" ON "parking_areas"("lot_id", "code");
CREATE UNIQUE INDEX "parking_spots_area_id_code_key" ON "parking_spots"("area_id", "code");
CREATE UNIQUE INDEX "parking_sessions_reservation_id_key" ON "parking_sessions"("reservation_id");

CREATE INDEX "vehicles_owner_id_idx" ON "vehicles"("owner_id");
CREATE INDEX "parking_areas_lot_id_idx" ON "parking_areas"("lot_id");
CREATE INDEX "parking_spots_area_id_idx" ON "parking_spots"("area_id");
CREATE INDEX "parking_spots_status_idx" ON "parking_spots"("status");
CREATE INDEX "reservations_user_id_idx" ON "reservations"("user_id");
CREATE INDEX "reservations_vehicle_id_idx" ON "reservations"("vehicle_id");
CREATE INDEX "reservations_spot_id_idx" ON "reservations"("spot_id");
CREATE INDEX "reservations_status_idx" ON "reservations"("status");
CREATE INDEX "parking_sessions_user_id_idx" ON "parking_sessions"("user_id");
CREATE INDEX "parking_sessions_vehicle_id_idx" ON "parking_sessions"("vehicle_id");
CREATE INDEX "parking_sessions_spot_id_idx" ON "parking_sessions"("spot_id");
CREATE INDEX "parking_sessions_status_idx" ON "parking_sessions"("status");
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

CREATE UNIQUE INDEX "reservations_one_active_per_spot"
  ON "reservations"("spot_id")
  WHERE "status" IN ('PENDING', 'CONFIRMED', 'CHECKED_IN');

CREATE UNIQUE INDEX "reservations_one_active_per_vehicle"
  ON "reservations"("vehicle_id")
  WHERE "status" IN ('PENDING', 'CONFIRMED', 'CHECKED_IN');

CREATE UNIQUE INDEX "parking_sessions_one_active_per_spot"
  ON "parking_sessions"("spot_id")
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "parking_sessions_one_active_per_vehicle"
  ON "parking_sessions"("vehicle_id")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "parking_areas" ADD CONSTRAINT "parking_areas_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "parking_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "parking_spots" ADD CONSTRAINT "parking_spots_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "parking_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_spot_id_fkey" FOREIGN KEY ("spot_id") REFERENCES "parking_spots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_spot_id_fkey" FOREIGN KEY ("spot_id") REFERENCES "parking_spots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
