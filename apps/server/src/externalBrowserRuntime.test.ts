import { describe, expect, it } from "vitest";

import {
  buildChromiumLaunchArgs,
  resolveChromiumExecutable,
  resolveDefaultBrowserUsePipePath,
} from "./externalBrowserRuntime";

describe("resolveChromiumExecutable", () => {
  it("uses an explicit browser executable before platform candidates", () => {
    const executable = resolveChromiumExecutable({
      env: { BROCODE_BROWSER_EXECUTABLE: "/opt/custom/chrome" },
      pathExists: (path) => path === "/opt/custom/chrome",
      pathLookup: () => null,
      platform: "darwin",
    });

    expect(executable).toEqual({
      kind: "custom",
      name: "Custom Chromium",
      path: "/opt/custom/chrome",
    });
  });

  it("prefers Google Chrome over Edge and Chromium on macOS", () => {
    const executable = resolveChromiumExecutable({
      env: {},
      pathExists: (path) => path.includes("Google Chrome.app"),
      pathLookup: () => null,
      platform: "darwin",
    });

    expect(executable?.name).toBe("Google Chrome");
  });

  it("falls back to PATH lookup on Linux", () => {
    const executable = resolveChromiumExecutable({
      env: {},
      pathExists: () => false,
      pathLookup: (name) => (name === "microsoft-edge" ? "/usr/bin/microsoft-edge" : null),
      platform: "linux",
    });

    expect(executable).toEqual({
      kind: "edge",
      name: "Microsoft Edge",
      path: "/usr/bin/microsoft-edge",
    });
  });
});

describe("buildChromiumLaunchArgs", () => {
  it("constructs an isolated remote-debugging launch command", () => {
    expect(
      buildChromiumLaunchArgs({
        port: 9222,
        userDataDir: "/tmp/brocode-browser",
      }),
    ).toEqual([
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=9222",
      "--user-data-dir=/tmp/brocode-browser",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ]);
  });
});

describe("resolveDefaultBrowserUsePipePath", () => {
  it("uses a stable desktop backend socket path under the BroCode home directory", () => {
    expect(resolveDefaultBrowserUsePipePath("/Users/me/.brocode", "darwin")).toBe(
      "/Users/me/.brocode/browser-use.sock",
    );
  });

  it("uses a named pipe on Windows", () => {
    expect(resolveDefaultBrowserUsePipePath("C:/Users/me/.brocode", "win32")).toBe(
      String.raw`\\.\pipe\brocode-browser-use`,
    );
  });
});
