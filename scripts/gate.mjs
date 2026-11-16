// Launch the Gate Vision + Arduino Serial service with VISION_API_KEY from apps/api/.env.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(root, "services/vision");
const executable = resolve(
  directory,
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);

const [action = "run", ...args] = process.argv.slice(2);
if (!["run", "preflight"].includes(action)) {
  throw new Error("Use npm run gate:run or npm run gate:preflight");
}
if (!existsSync(executable)) {
  throw new Error(
    "Create services/vision/.venv and install requirements-ocr.txt first",
  );
}

const apiEnv = resolve(root, "apps/api/.env");
const values = existsSync(apiEnv) ? dotenv.parse(readFileSync(apiEnv)) : {};
const key = process.env.VISION_API_KEY || values.VISION_API_KEY || "";
if (action === "run" && !key) {
  throw new Error(
    "Set VISION_API_KEY in apps/api/.env or the current environment.",
  );
}

const moduleArgs =
  action === "preflight"
    ? ["-m", "vision.preflight", ...args]
    : ["-m", "vision", ...args];

const child = spawn(executable, moduleArgs, {
  cwd: directory,
  stdio: "inherit",
  env: { ...process.env, VISION_API_KEY: key, PYTHONUNBUFFERED: "1" },
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
