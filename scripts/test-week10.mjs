import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  createWriteStream,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = resolve(root, "artifacts/week10", timestamp);
mkdirSync(directory, { recursive: true });
const values = existsSync(resolve(root, "apps/api/.env"))
  ? dotenv.parse(readFileSync(resolve(root, "apps/api/.env")))
  : {};
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this command via npm run test:week10");
const python = resolve(
  root,
  "services/vision",
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
const flags = new Set(process.argv.slice(2));
const withOcr = flags.has("--ocr");
const withCamera = flags.has("--camera");
const environment = {
  ...process.env,
  RUN_DB_TESTS: "true",
  RUN_OCR_TESTS: withOcr ? "true" : "false",
  WEEK10_ARTIFACT_DIR: directory,
};
const steps = [];
let cancelled = false;
let active;
process.once("SIGINT", () => {
  cancelled = true;
  active?.kill("SIGINT");
});

async function step(name, executable, args, options = {}) {
  if (cancelled) {
    steps.push({ name, status: "SKIP", reason: "Interrupted" });
    return false;
  }
  const started = Date.now();
  const file = name.replace(/[^a-z0-9-]/gi, "-") + ".log";
  const log = createWriteStream(resolve(directory, file));
  console.log(`\n[week10] ${name}`);
  const code = await new Promise((resolveResult) => {
    active = spawn(executable, args, {
      cwd: root,
      env: environment,
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    active.stdout.on("data", (data) => {
      log.write(data);
      process.stdout.write(data);
    });
    active.stderr.on("data", (data) => {
      log.write(data);
      process.stderr.write(data);
    });
    active.on("error", (error) => {
      log.write(error.message);
      resolveResult(1);
    });
    active.on("close", (result) => resolveResult(result ?? 1));
  });
  log.end();
  active = undefined;
  steps.push({
    name,
    status: code === 0 ? "PASS" : "FAIL",
    exitCode: code,
    durationMs: Date.now() - started,
    log: file,
  });
  return code === 0;
}
const npm = (name, args) => step(name, process.execPath, [npmCli, ...args]);
await npm("format", ["run", "format:check"]);
await npm("lint", ["run", "lint"]);
await npm("lint-e2e", ["run", "lint:e2e"]);
const built = await npm("build", ["run", "build"]);
const databaseReady = await step(
  "database-migrations",
  process.execPath,
  [resolve(root, "node_modules/prisma/build/index.js"), "migrate", "status"],
  { cwd: resolve(root, "apps/api") },
);
if (databaseReady)
  await npm("api-postgresql-websocket", [
    "run",
    "test",
    "--workspace",
    "apps/api",
    "--",
    "--reporter=default",
    "--reporter=json",
    `--outputFile=${resolve(directory, "vitest.json")}`,
  ]);
else
  steps.push({
    name: "api-postgresql-websocket",
    status: "SKIP",
    reason: "Database unavailable or migrations pending",
  });
const pythonReady = existsSync(python);
if (pythonReady) {
  await step(
    "python",
    python,
    ["-m", "unittest", "discover", "-s", "tests", "-v"],
    { cwd: resolve(root, "services/vision") },
  );
  await step(
    "python-syntax",
    python,
    ["-m", "compileall", "-q", "vision", "tests"],
    { cwd: resolve(root, "services/vision") },
  );
  await step(
    "hardware-diagnostics",
    python,
    [
      "-m",
      "vision.preflight",
      "--output",
      resolve(directory, "hardware.json"),
      ...(withCamera ? ["--read-frame"] : []),
    ],
    {
      cwd: resolve(root, "services/vision"),
      env: {
        ...environment,
        VISION_API_KEY:
          process.env.VISION_API_KEY || values.VISION_API_KEY || "",
      },
    },
  );
} else
  steps.push({
    name: "python",
    status: "FAIL",
    reason: "Create services/vision/.venv and install requirements-ocr.txt",
  });
if (
  built &&
  databaseReady &&
  pythonReady &&
  existsSync(chromium.executablePath())
)
  await npm("browser-python-http-realtime", ["run", "test:e2e"]);
else
  steps.push({
    name: "browser-python-http-realtime",
    status: "FAIL",
    reason:
      "Build, database, Python and Playwright Chromium must be ready; run npm run test:browser:install if the browser is missing",
  });

const hardwarePath = resolve(directory, "hardware.json");
const hardware = existsSync(hardwarePath)
  ? JSON.parse(readFileSync(hardwarePath, "utf8"))
  : null;
const summary = {
  generatedAt: new Date().toISOString(),
  status: steps.some((item) => item.status !== "PASS")
    ? "INCOMPLETE_OR_FAILED"
    : "PASS_SOFTWARE_ONLY",
  evidence: {
    controlledDetectionOcrInBrowserFlow: true,
    realPaddleRuntimeOnSyntheticText: withOcr,
    physicalRecognitionVerified: false,
    physicalCameraFrameProbeRequested: withCamera,
  },
  hardware,
  steps,
};
writeFileSync(
  resolve(directory, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
const markdown = [
  "# Week 10 software integration report",
  "",
  `Result: **${summary.status}**`,
  "",
  "Controlled detections/OCR are used only in the isolated browser fixture. This is not a physical-camera accuracy report.",
  `Physical camera frame probe: **${hardware?.cameraCheck ?? "NOT_RUN"}**. Physical recognition verification: **MANUAL_REQUIRED**.`,
  "",
  "| Step | Status | Time | Log |",
  "| --- | --- | --- | --- |",
  ...steps.map(
    (item) =>
      `| ${item.name} | ${item.status} | ${item.durationMs ? (item.durationMs / 1000).toFixed(1) + "s" : "—"} | ${item.log ? `[log](${item.log})` : item.reason} |`,
  ),
  "",
  "Physical recognition across the four real parking positions still requires the manual protocol in docs/week10-integration.md.",
  "",
].join("\n");
writeFileSync(resolve(directory, "summary.md"), markdown);
console.log(`\nWeek 10: ${summary.status}\nReport: ${directory}`);
process.exitCode = summary.status === "PASS_SOFTWARE_ONLY" ? 0 : 1;
