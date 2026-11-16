import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

const values = dotenv.parse(readFileSync("apps/api/.env"));
const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL || values.DATABASE_URL } },
});
const apiURL = process.env.WEEK10_API_URL || "http://127.0.0.1:4101";

type E2EFixture = {
  runId: string;
  password: string;
  userEmail: string;
  adminEmail: string;
  lotId: string;
  lotName: string;
  gateId: string;
  plateNumber: string;
};

let fixture: E2EFixture;

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.locator(".realtime-badge.connected").first()).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Điều hướng chính" }),
  ).toBeVisible();
}

async function navigate(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("button", { name, exact: true })
    .click();
}

test.beforeEach(async () => {
  const runId = randomUUID().slice(0, 8);
  const password = "E2EPassword123!";
  const userEmail = `e2e-user-${runId}@example.com`;
  const adminEmail = `e2e-admin-${runId}@example.com`;
  const lotName = `E2E Lot ${runId}`;
  const plateNumber = `30E-${Math.floor(10000 + Math.random() * 89999)}`;

  const lot = await db.parkingLot.create({
    data: {
      name: lotName,
      address: "Cổng thử nghiệm E2E",
      capacity: 10,
      isActive: true,
    },
  });

  fixture = {
    runId,
    password,
    userEmail,
    adminEmail,
    lotId: lot.id,
    lotName,
    gateId: `e2e-gate-${runId}`,
    plateNumber,
  };
});

test.afterEach(async () => {
  if (!fixture) return;
  await db.gateCommand.deleteMany({ where: { gateId: fixture.gateId } });
  await db.gateEvent.deleteMany({ where: { gateId: fixture.gateId } });
  await db.auditLog.deleteMany({
    where: {
      actor: { email: { in: [fixture.userEmail, fixture.adminEmail] } },
    },
  });
  await db.parkingSession.deleteMany({ where: { lotId: fixture.lotId } });
  await db.reservation.deleteMany({ where: { lotId: fixture.lotId } });
  await db.vehicle.deleteMany({
    where: {
      owner: { email: { in: [fixture.userEmail, fixture.adminEmail] } },
    },
  });
  await db.parkingLot.deleteMany({ where: { id: fixture.lotId } });
  await db.user.deleteMany({
    where: { email: { in: [fixture.userEmail, fixture.adminEmail] } },
  });
});

test.afterAll(async () => {
  await db.$disconnect();
});

test("booking by lot -> gate scan entry -> barrier monitor -> gate scan exit", async ({
  page,
  browser,
  request,
}) => {
  const regUser = await request.post(`${apiURL}/api/auth/register`, {
    data: {
      email: fixture.userEmail,
      password: fixture.password,
      fullName: `Driver ${fixture.runId}`,
    },
  });
  expect(regUser.status()).toBe(201);

  const regAdmin = await request.post(`${apiURL}/api/auth/register`, {
    data: {
      email: fixture.adminEmail,
      password: fixture.password,
      fullName: `Operator ${fixture.runId}`,
    },
  });
  expect(regAdmin.status()).toBe(201);
  await db.user.update({
    where: { email: fixture.adminEmail },
    data: { role: "ADMIN" },
  });

  await login(page, fixture.userEmail, fixture.password);

  await navigate(page, "Đặt chỗ & Xe");
  await page.getByPlaceholder("30A-12345").fill(fixture.plateNumber);
  await page.getByLabel("Bãi xe").selectOption({ value: fixture.lotId });
  await page.getByRole("button", { name: "Xác nhận đặt chỗ" }).click();
  await expect(page.getByText("Đặt chỗ thành công.")).toBeVisible();
  await expect(page.getByText(fixture.plateNumber).first()).toBeVisible();

  const visionKey = process.env.VISION_API_KEY || values.VISION_API_KEY;
  const entryScan = await request.post(`${apiURL}/api/gate/scan`, {
    headers: { "x-vision-api-key": visionKey },
    data: {
      gateId: fixture.gateId,
      lotId: fixture.lotId,
      plateRaw: fixture.plateNumber,
      ocrConfidence: 0.96,
      plateSamples: 3,
      timestamp: new Date().toISOString(),
    },
  });
  expect(entryScan.status()).toBe(200);
  expect(await entryScan.json()).toMatchObject({
    direction: "ENTRY",
    decision: "ALLOW",
    barrierAction: "OPEN",
  });

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  try {
    await login(adminPage, fixture.adminEmail, fixture.password);
    await navigate(adminPage, "Cổng & Barie");
    const monitor = adminPage.getByRole("region", {
      name: "Giám sát cổng và barie",
      exact: true,
    });
    await expect(monitor).toContainText(fixture.plateNumber.replace("-", ""));
    await expect(monitor).toContainText("Cho qua");

    const exitScan = await request.post(`${apiURL}/api/gate/scan`, {
      headers: { "x-vision-api-key": visionKey },
      data: {
        gateId: fixture.gateId,
        lotId: fixture.lotId,
        plateRaw: fixture.plateNumber,
        ocrConfidence: 0.96,
        plateSamples: 3,
        timestamp: new Date(Date.now() + 20_000).toISOString(),
      },
    });
    expect(exitScan.status()).toBe(200);
    expect(await exitScan.json()).toMatchObject({
      direction: "EXIT",
      decision: "ALLOW",
      barrierAction: "OPEN",
    });
    await expect(monitor).toContainText("Xe ra");
  } finally {
    await adminContext.close();
  }
});
