// Regenerate src/api/schema.d.ts from the backend's OpenAPI schema.
// openapi-typescript runs via npx (isolated) because it pins a TypeScript 5 peer.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const backend = resolve(import.meta.dirname, "../../backend");
const venvPython = process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python";
const python = existsSync(resolve(backend, venvPython)) ? resolve(backend, venvPython) : "python";
const schema = resolve(import.meta.dirname, "../src/api/openapi.json");

execFileSync(python, ["scripts/export_openapi.py", schema], { cwd: backend, stdio: "inherit" });
// Relative paths: on Windows npx goes through the shell, which would split paths containing spaces.
execFileSync("npx", ["--yes", "openapi-typescript@7", "src/api/openapi.json", "-o", "src/api/schema.d.ts"], {
  cwd: resolve(import.meta.dirname, ".."),
  stdio: "inherit",
  shell: process.platform === "win32",
});
