#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(scriptDir, "../../web");
const args = process.argv.slice(2);

const child = spawn("bun", args, {
  cwd: webDir,
  env: {
    ...process.env,
    T3CODE_TAURI_ENTRY: "1",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
