import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

const values = dotenv.parse(readFileSync("apps/api/.env"));
const apiPort = process.env.WEEK10_API_PORT || "4101";
const webPort = process.env.WEEK10_WEB_PORT || "5174";
const apiURL = `http://127.0.0.1:${apiPort}`;
const baseURL = `http://127.0.0.1:${webPort}`;
process.env.WEEK10_API_URL = apiURL;
const artifacts = resolve(
  process.env.WEEK10_ARTIFACT_DIR || "artifacts/week10/latest",
);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: resolve(artifacts, "playwright.json") }],
    [
      "html",
      { outputFolder: resolve(artifacts, "browser-report"), open: "never" },
    ],
  ],
  outputDir: resolve(artifacts, "browser-results"),
  use: {
    baseURL,
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  webServer: [
    {
      command: `${npm} run dev --workspace apps/api`,
      url: `${apiURL}/health`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        ...values,
        NODE_ENV: "test",
        PORT: apiPort,
        WEB_ORIGIN: baseURL,
        HTTP_RATE_LIMIT_MAX: "1000",
      },
    },
    {
      command: `${npm} run dev --workspace apps/web -- --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 90_000,
      env: { VITE_API_BASE_URL: apiURL },
    },
  ],
});
