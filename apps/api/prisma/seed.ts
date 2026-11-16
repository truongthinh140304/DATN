import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalizePlate(raw: string): string {
  return raw
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s.\-\u2010-\u2015]/gu, "");
}

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

  const demoPlate = "30A-12345";
  await prisma.vehicle.upsert({
    where: { plateNormalized: normalizePlate(demoPlate) },
    update: {},
    create: {
      ownerId: user.id,
      plateNumber: demoPlate,
      plateNormalized: normalizePlate(demoPlate),
      type: "CAR",
      brand: "Toyota",
      color: "White",
    },
  });

  await prisma.parkingLot.upsert({
    where: { id: "11111111-1111-4111-8111-111111111111" },
    update: {},
    create: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Bãi xe thông minh · Cổng chính",
      address: "Khuôn viên bãi xe mô hình DATN",
      description: "Bãi giữ xe ô tô dùng camera đọc biển số và barie Arduino",
      capacity: 20,
    },
  });

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
