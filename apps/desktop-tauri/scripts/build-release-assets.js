#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");

function run(label, args, options = {}) {
  const result = spawnSync("bun", args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...options.env,
    },
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }

  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status ?? 1}`);
    process.exit(result.status ?? 1);
  }
}

run("web build", ["run", "--cwd", "apps/web", "build"], {
  env: { T3CODE_TAURI_ENTRY: "1" },
});
run("server build", ["run", "--cwd", "apps/server", "build"]);
