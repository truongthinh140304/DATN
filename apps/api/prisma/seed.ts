import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const userEmail = process.env.SEED_USER_EMAIL ?? "user@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Admin12345!";
  const userPassword = process.env.SEED_USER_PASSWORD ?? "User12345!";

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { fullName: "Quản trị viên", role: "ADMIN" },
    create: {
      email: adminEmail,
      fullName: "Quản trị viên",
      role: "ADMIN",
      passwordHash: await bcrypt.hash(adminPassword, 12),
    },
  });

  const user = await prisma.user.upsert({
    where: { email: userEmail },
    update: { fullName: "Người dùng", role: "USER" },
    create: {
      email: userEmail,
      fullName: "Người dùng",
      role: "USER",
      passwordHash: await bcrypt.hash(userPassword, 12),
    },
  });

  await prisma.vehicle.upsert({
    where: { plateNumber: "30A-12345" },
    update: {},
    create: {
      ownerId: user.id,
      plateNumber: "30A-12345",
      type: "CAR",
      brand: "Toyota",
      color: "White",
    },
  });

  const lot = await prisma.parkingLot.upsert({
    where: { id: "11111111-1111-4111-8111-111111111111" },
    update: {},
    create: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Bai xe demo DATN",
      address: "Truong dai hoc - khu demo",
      description: "Seed data for local development only",
    },
  });

  const area = await prisma.parkingArea.upsert({
    where: { lotId_code: { lotId: lot.id, code: "A" } },
    update: {},
    create: { lotId: lot.id, code: "A", name: "Khu A", floor: 1 },
  });

  for (const code of ["A01", "A02", "A03", "A04", "A05"]) {
    await prisma.parkingSpot.upsert({
      where: { areaId_code: { areaId: area.id, code } },
      update: {},
      create: { areaId: area.id, code, status: "AVAILABLE" },
    });
  }

  console.log(`Seeded demo data. Admin=${admin.email}, User=${user.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
