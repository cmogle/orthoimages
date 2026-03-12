import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENV_PATH = `${ROOT}/.env.local`;

if (typeof process.loadEnvFile === "function" && existsSync(ENV_PATH)) {
  process.loadEnvFile(ENV_PATH);
}
