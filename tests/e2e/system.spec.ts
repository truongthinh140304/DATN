import { test, expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import {
  createWeek10Fixture,
  cleanupWeek10Fixture,
  type Week10Fixture,
} from "../../apps/api/test/helpers/week10-fixture";

const values = dotenv.parse(readFileSync("apps/api/.env"));
const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL || values.DATABASE_URL } },
});
const execute = promisify(execFile);
const apiURL = process.env.WEEK10_API_URL || "http://127.0.0.1:4101";
let fixture: Week10Fixture;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page
    .locator('input[autocomplete="current-password"]')
    .fill(fixture.password);
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
async function cameraFrame(
  scenario = "read",
  code = "A01",
  plate = fixture.vehicle.plateNumber,
) {
  const python = resolve(
    "services/vision",
    process.platform === "win32"
      ? ".venv/Scripts/python.exe"
      : ".venv/bin/python",
  );
  const result = await execute(
    python,
    [
      "tests/integration_bridge.py",
      "--api-url",
      apiURL,
      "--run-id",
      fixture.runId,
      "--mapping",
      JSON.stringify(
        fixture.spots.map((item) => ({ id: item.id, code: item.code })),
      ),
      "--plate",
      plate,
      "--spot-code",
      code,
      "--scenario",
      scenario,
    ],
    {
      cwd: resolve("services/vision"),
      env: {
        ...process.env,
        PYTHONPATH: resolve("services/vision"),
        VISION_API_KEY: values.VISION_API_KEY,
      },
      timeout: 30_000,
    },
  );
  const output = JSON.parse(result.stdout.trim());
  expect(output.evidenceSource).toBe("CONTROLLED_TEST_FIXTURE");
  expect(output.accepted).toBe(4);
  return output;
}
test.beforeEach(async () => {
  fixture = await createWeek10Fixture(db);
});
test.afterEach(async () => {
  if (fixture) await cleanupWeek10Fixture(db, fixture);
});
test.afterAll(async () => {
  await db.$disconnect();
});

test("booking -> Python reporter -> database -> realtime web -> manual check-in/out", async ({
  page,
  browser,
  request,
}, testInfo) => {
  await login(page, fixture.owner.email);
  await navigate(page, "Đặt chỗ");
  await page
    .getByRole("combobox", { name: "Phương tiện", exact: true })
    .selectOption(fixture.vehicle.id);
  await page
    .getByRole("combobox", { name: "Vị trí", exact: true })
    .selectOption(fixture.spots[0].id);
  await page
    .getByRole("button", { name: "Xác nhận đặt chỗ", exact: true })
    .click();
  await expect
    .poll(async () =>
      db.reservation.count({
        where: { vehicleId: fixture.vehicle.id, status: "CONFIRMED" },
      }),
    )
    .toBe(1);
  const reservation = await db.reservation.findFirstOrThrow({
    where: { vehicleId: fixture.vehicle.id },
  });
  const verification = page.getByRole("region", {
    name: "Xác minh xe đã đặt",
    exact: true,
  });
  await expect(verification).toContainText(fixture.vehicle.plateNumber);
  await expect(verification).toContainText("Đang chờ camera");
  const authResponse = await request.post(`${apiURL}/api/auth/login`, {
    data: { email: fixture.owner.email, password: fixture.password },
  });
  expect(authResponse.status()).toBe(200);
  const ownerAuth = await authResponse.json();
  const headers = { Authorization: `Bearer ${ownerAuth.accessToken}` };
  const duplicate = await request.post(`${apiURL}/api/reservations`, {
    headers,
    data: { vehicleId: fixture.otherVehicle.id, spotId: fixture.spots[0].id },
  });
  expect(duplicate.status()).toBe(409);
  const sameVehicle = await request.post(`${apiURL}/api/reservations`, {
    headers,
    data: { vehicleId: fixture.vehicle.id, spotId: fixture.spots[1].id },
  });
  expect(sameVehicle.status()).toBe(409);
  expect(
    (
      await db.parkingSpot.findUniqueOrThrow({
        where: { id: fixture.spots[1].id },
      })
    ).status,
  ).toBe("AVAILABLE");

  const adminContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage();
    await login(admin, fixture.admin.email);
    await navigate(admin, "Quản trị");
    const camera = admin.getByRole("region", {
      name: "Lịch sử Camera AI",
      exact: true,
    });
    await camera
      .getByRole("textbox", { name: "Lọc theo camera" })
      .fill(fixture.cameraId);
    await camera.getByRole("button", { name: "Lọc", exact: true }).click();
    await expect(camera.locator("tbody tr")).toHaveCount(0);
    await cameraFrame();
    const row = (code: string) =>
      camera.locator("tbody tr").filter({ hasText: code });
    await expect(row("A01")).toContainText(fixture.vehicle.plateNumber);
    await expect(row("A01")).toContainText("Khớp đặt chỗ");
    await expect(verification).toContainText("Khớp đặt chỗ — đúng xe, đúng ô");
    expect(
      await db.parkingSession.count({
        where: { vehicleId: fixture.vehicle.id },
      }),
    ).toBe(0);
    expect(
      (
        await db.parkingSpot.findUniqueOrThrow({
          where: { id: fixture.spots[0].id },
        })
      ).status,
    ).toBe("RESERVED");
    const stored = await db.cameraObservation.findFirstOrThrow({
      where: { cameraId: fixture.cameraId, spotId: fixture.spots[0].id },
      orderBy: { observedAt: "desc" },
    });
    expect(stored).toMatchObject({
      recognitionStatus: "READ",
      plateNormalized: fixture.vehicle.plateNumber,
      matchStatus: "MATCH",
      plateSamples: 3,
    });

    const warnings = admin.getByRole("region", {
      name: "Cảnh báo vị trí đỗ",
      exact: true,
    });
    await cameraFrame("read", "A02");
    await expect(warnings).toContainText("Xe ở sai ô");
    await expect(warnings).toContainText(fixture.vehicle.plateNumber);
    await warnings
      .getByRole("button", { name: "Đã tiếp nhận", exact: true })
      .first()
      .click();
    await expect(warnings).toContainText("Đã tiếp nhận");
    await cameraFrame("ambiguous");
    await expect(row("A01")).toContainText("Chưa xác định xe/ô");
    await expect(warnings).toContainText("Xe ở sai ô");
    await cameraFrame("read", "A01", fixture.otherVehicle.plateNumber);
    await expect(row("A01")).toContainText("Không khớp");
    await expect(verification).toContainText("Không khớp biển số đã đặt");
    await expect(verification).toContainText("Đã ẩn biển khác");
    await expect(verification).not.toContainText(
      fixture.otherVehicle.plateNumber,
    );
    await expect(warnings).toContainText("Biển số khác đặt chỗ");
    await cameraFrame();
    await expect(row("A01")).toContainText("Khớp đặt chỗ");
    await expect
      .poll(async () =>
        db.visionAlert.count({
          where: { cameraId: fixture.cameraId, status: { not: "RESOLVED" } },
        }),
      )
      .toBe(0);

    await camera.screenshot({ path: testInfo.outputPath("camera-match.png") });
    const operator = await adminContext.newPage();
    await login(operator, fixture.admin.email);
    await navigate(operator, "Xe vào / ra");
    const operatorRow = operator
      .locator("tbody tr")
      .filter({ hasText: fixture.vehicle.plateNumber });
    await expect(operatorRow).toHaveCount(0);
    await navigate(page, "Xe vào / ra");
    await page
      .getByRole("combobox", { name: "Đặt chỗ hiệu lực" })
      .selectOption(reservation.id);
    await page
      .getByRole("button", { name: "Xác nhận xe đã vào bãi", exact: true })
      .click();
    await expect
      .poll(async () =>
        db.parkingSession.count({
          where: { vehicleId: fixture.vehicle.id, status: "ACTIVE" },
        }),
      )
      .toBe(1);
    await expect(operatorRow).toHaveCount(1);
    await expect(
      camera.getByRole("textbox", { name: "Lọc theo camera" }),
    ).toHaveValue(fixture.cameraId);
    await cameraFrame("empty");
    await expect(row("A01")).toContainText("Không phát hiện xe");
    await cameraFrame("lost");
    await expect(row("A01")).toContainText("Mất tín hiệu camera");
    const session = await db.parkingSession.findFirstOrThrow({
      where: { vehicleId: fixture.vehicle.id, status: "ACTIVE" },
    });
    expect(
      (
        await db.parkingSpot.findUniqueOrThrow({
          where: { id: fixture.spots[0].id },
        })
      ).status,
    ).toBe("OCCUPIED");
    const activeRow = page
      .locator("tbody tr")
      .filter({ hasText: fixture.vehicle.plateNumber });
    await expect(
      activeRow.getByRole("button", {
        name: "Xác nhận check-out",
        exact: true,
      }),
    ).toBeDisabled();
    await activeRow.getByRole("checkbox").check();
    await activeRow
      .getByRole("button", { name: "Xác nhận check-out", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await db.parkingSession.findUniqueOrThrow({
              where: { id: session.id },
            })
          ).status,
      )
      .toBe("COMPLETED");
    await expect(operatorRow).toHaveCount(0);
    expect(
      (
        await db.parkingSpot.findUniqueOrThrow({
          where: { id: fixture.spots[0].id },
        })
      ).status,
    ).toBe("AVAILABLE");
    expect(await db.auditLog.count({ where: { entityId: session.id } })).toBe(
      2,
    );
    const publicResponse = await request.get(
      `${apiURL}/api/vision/observations/latest?cameraId=${fixture.cameraId}`,
      { headers },
    );
    expect(publicResponse.status()).toBe(200);
    for (const item of (await publicResponse.json()).items) {
      expect(item.plateNormalized).toBeUndefined();
      expect(item.metadata).toBeUndefined();
    }
    expect(
      (await request.get(`${apiURL}/api/vision/alerts`, { headers })).status(),
    ).toBe(403);
    await testInfo.attach("evidence-kind", {
      body: JSON.stringify({
        kind: "CONTROLLED_TEST_FIXTURE",
        runId: fixture.runId,
        cameraId: fixture.cameraId,
      }),
      contentType: "application/json",
    });
  } finally {
    await adminContext.close();
  }
});

test("browser reconnect refetches its snapshot and mobile view remains usable", async ({
  page,
  context,
}, testInfo) => {
  await login(page, fixture.admin.email);
  await navigate(page, "Quản trị");
  const camera = page.getByRole("region", {
    name: "Lịch sử Camera AI",
    exact: true,
  });
  await camera
    .getByRole("textbox", { name: "Lọc theo camera" })
    .fill(fixture.cameraId);
  await camera.getByRole("button", { name: "Lọc", exact: true }).click();
  await cameraFrame("empty");
  await expect(camera.locator("tbody tr")).toHaveCount(4);
  await context.setOffline(true);
  try {
    await cameraFrame("read");
    await expect(page.locator(".realtime-badge").first()).toContainText(
      "Mất kết nối",
      { timeout: 35_000 },
    );
  } finally {
    await context.setOffline(false);
  }
  await expect(page.locator(".realtime-badge.connected").first()).toBeVisible();
  await expect(camera).toContainText(fixture.vehicle.plateNumber);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    camera.getByRole("textbox", { name: "Lọc theo camera" }),
  ).toBeVisible();
  await camera.screenshot({ path: testInfo.outputPath("camera-mobile.png") });
  const horizontal = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 2,
  );
  expect(horizontal).toBe(false);
});
