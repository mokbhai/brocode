#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const requireFromRepo = createRequire(`${repoRoot}/package.json`);

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

function copyRuntimePackage(packageName) {
  const packageJsonPath = requireFromRepo.resolve(`${packageName}/package.json`, {
    paths: [resolve(repoRoot, "apps/server")],
  });
  const packageDir = dirname(packageJsonPath);
  const targetDir = resolve(repoRoot, "apps/server/dist/node_modules", packageName);

  rmSync(targetDir, { recursive: true, force: true });
  cpSync(packageDir, targetDir, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
  });

  if (process.platform !== "win32" && packageName === "node-pty") {
    const prebuildsDir = resolve(targetDir, "prebuilds");
    if (!existsSync(prebuildsDir)) {
      return;
    }

    for (const entry of readdirSync(prebuildsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const spawnHelperPath = resolve(prebuildsDir, entry.name, "spawn-helper");
      if (existsSync(spawnHelperPath)) {
        chmodSync(spawnHelperPath, 0o755);
      }
    }
  }
}

run("web build", ["run", "--cwd", "apps/web", "build"], {
  env: { T3CODE_TAURI_ENTRY: "1" },
});
run("server build", ["run", "--cwd", "apps/server", "build"]);

copyRuntimePackage("node-pty");
