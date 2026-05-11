import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { assert, describe, it } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = resolve(import.meta.dirname, "run-tauri-dev.js");
const tauriConfigPath = resolve(import.meta.dirname, "../src-tauri/tauri.conf.json");

describe("run-tauri-dev", () => {
  it("uses PORT for Tauri devUrl and beforeDevCommand", async () => {
    const { stdout } = await execFileAsync("node", [scriptPath, "--dry-run"], {
      env: {
        ...process.env,
        PORT: "8891",
      },
    });
    const dryRun = JSON.parse(stdout) as {
      readonly args: ReadonlyArray<string>;
      readonly config: {
        readonly build: {
          readonly beforeDevCommand: { readonly cwd: string; readonly script: string };
          readonly devUrl: string;
        };
      };
    };

    assert.equal(dryRun.config.build.devUrl, "http://127.0.0.1:8891");
    assert.ok(dryRun.config.build.beforeDevCommand.script.includes("--port 8891"));
    assert.equal(dryRun.config.build.beforeDevCommand.cwd, "..");
    assert.ok(dryRun.args.includes(JSON.stringify(dryRun.config)));
  });

  it("leaves DOM drag and drop available to the web app", async () => {
    const config = JSON.parse(await readFile(tauriConfigPath, "utf8")) as {
      readonly app?: {
        readonly windows?: ReadonlyArray<{
          readonly dragDropEnabled?: boolean;
        }>;
      };
    };

    assert.equal(config.app?.windows?.[0]?.dragDropEnabled, false);
  });
});
