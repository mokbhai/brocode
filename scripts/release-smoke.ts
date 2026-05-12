// FILE: release-smoke.ts
// Purpose: Smoke-tests release version alignment for release-only workflow steps.
// Layer: Release verification script
// Depends on: update-release-package-versions.ts.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const workspaceFiles = [
  "package.json",
  "bun.lock",
  "apps/server/package.json",
  "apps/desktop-tauri/package.json",
  "apps/desktop-tauri/src-tauri/tauri.conf.json",
  "apps/web/package.json",
  "apps/marketing/package.json",
  "packages/contracts/package.json",
  "packages/effect-acp/package.json",
  "packages/shared/package.json",
  "scripts/package.json",
] as const;

function copyWorkspaceManifestFixture(targetRoot: string): void {
  for (const relativePath of workspaceFiles) {
    const sourcePath = resolve(repoRoot, relativePath);
    const destinationPath = resolve(targetRoot, relativePath);
    mkdirSync(dirname(destinationPath), { recursive: true });
    cpSync(sourcePath, destinationPath);
  }
}

function assertContains(haystack: string, needle: string, message: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(message);
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), "brocode-release-smoke-"));

try {
  copyWorkspaceManifestFixture(tempRoot);

  execFileSync(
    process.execPath,
    [
      resolve(repoRoot, "scripts/update-release-package-versions.ts"),
      "9.9.9-smoke.0",
      "--root",
      tempRoot,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );

  execFileSync("bun", ["install", "--lockfile-only", "--ignore-scripts"], {
    cwd: tempRoot,
    stdio: "inherit",
  });

  const lockfile = readFileSync(resolve(tempRoot, "bun.lock"), "utf8");
  assertContains(
    lockfile,
    `"version": "9.9.9-smoke.0"`,
    "Expected bun.lock to contain the smoke version.",
  );

  const tauriConfig = readFileSync(
    resolve(tempRoot, "apps/desktop-tauri/src-tauri/tauri.conf.json"),
    "utf8",
  );
  assertContains(
    tauriConfig,
    `"version": "9.9.9-smoke.0"`,
    "Expected Tauri config to contain the smoke version.",
  );

  console.log("Release smoke checks passed.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
