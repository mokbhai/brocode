#!/usr/bin/env node

import { spawn } from "node:child_process";

const DEFAULT_WEB_PORT = 5733;

function resolvePort(value) {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_WEB_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }

  return port;
}

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const args = rawArgs.filter((arg) => arg !== "--dry-run");
const webPort = resolvePort(process.env.PORT);
const devUrl = `http://127.0.0.1:${webPort}`;
const config = {
  build: {
    beforeDevCommand: {
      script: `node scripts/run-web-with-tauri-entry.js run dev -- --host 127.0.0.1 --port ${webPort}`,
      cwd: "..",
      wait: false,
    },
    devUrl,
  },
};
const tauriArgs = ["tauri", "dev", "--config", JSON.stringify(config), ...args];

if (dryRun) {
  console.log(JSON.stringify({ command: "bun", args: tauriArgs, config }, null, 2));
  process.exit(0);
}

const child = spawn("bun", tauriArgs, {
  env: process.env,
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
