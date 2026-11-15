// Reuse the API's dotenv rules without printing/copying its secret into JSON.
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
const [action, ...args] = process.argv.slice(2);
if (!["setup", "run"].includes(action))
  throw new Error("Use npm run vision:setup or npm run vision:run");
if (!existsSync(executable))
  throw new Error(
    "Create services/vision/.venv and install requirements-ocr.txt first",
  );
const apiEnv = resolve(root, "apps/api/.env");
const values = existsSync(apiEnv) ? dotenv.parse(readFileSync(apiEnv)) : {};
const key = process.env.VISION_API_KEY || values.VISION_API_KEY;
if (!key)
  throw new Error(
    "Set VISION_API_KEY in apps/api/.env or the current environment. No key was printed or saved.",
  );
const parameters =
  action === "setup"
    ? ["-m", "vision.calibrate", ...args]
    : ["-m", "vision", ...args];
const child = spawn(executable, parameters, {
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
