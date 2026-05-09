import * as NodeServices from "@effect/platform-node/NodeServices";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  createDevRunnerEnv,
  ensureResolvedPortAvailability,
  findFirstAvailableOffset,
  MODE_ARGS,
  resolveModePortOffsets,
  resolveOffset,
  validateModeOptions,
} from "./dev-runner.ts";

it.layer(NodeServices.layer)("dev-runner", (it) => {
  describe("resolveOffset", () => {
    it.effect("uses explicit T3CODE_PORT_OFFSET when provided", () =>
      Effect.sync(() => {
        const result = resolveOffset({ portOffset: 12, devInstance: undefined });
        assert.deepStrictEqual(result, {
          offset: 12,
          source: "T3CODE_PORT_OFFSET=12",
        });
      }),
    );

    it.effect("hashes non-numeric instance values", () =>
      Effect.sync(() => {
        const result = resolveOffset({ portOffset: undefined, devInstance: "feature-branch" });
        assert.ok(result.offset >= 1);
        assert.ok(result.offset <= 3000);
      }),
    );

    it.effect("throws for negative port offset", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          Effect.try({
            try: () => resolveOffset({ portOffset: -1, devInstance: undefined }),
            catch: (cause) => String(cause),
          }),
        );

        assert.ok(error.includes("Invalid T3CODE_PORT_OFFSET"));
      }),
    );
  });

  describe("createDevRunnerEnv", () => {
    it.effect("defaults T3CODE_HOME to ~/.dpcode when not provided", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          t3Home: undefined,
          authToken: undefined,
          noBrowser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.T3CODE_HOME, resolve(homedir(), ".dpcode"));
      }),
    );

    it.effect("supports explicit typed overrides", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev:server",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          t3Home: "/tmp/custom-t3",
          authToken: "secret",
          noBrowser: true,
          autoBootstrapProjectFromCwd: false,
          logWebSocketEvents: true,
          host: "0.0.0.0",
          port: 4222,
          devUrl: new URL("http://localhost:7331"),
        });

        assert.equal(env.T3CODE_HOME, resolve("/tmp/custom-t3"));
        assert.equal(env.T3CODE_PORT, "4222");
        assert.equal(env.VITE_WS_URL, "ws://[::1]:4222");
        assert.equal(env.T3CODE_NO_BROWSER, "1");
        assert.equal(env.T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD, "0");
        assert.equal(env.T3CODE_LOG_WS_EVENTS, "1");
        assert.equal(env.T3CODE_HOST, "0.0.0.0");
        assert.equal(env.VITE_DEV_SERVER_URL, "http://localhost:7331/");
      }),
    );

    it.effect("does not force websocket logging on in dev mode when unset", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {
            T3CODE_LOG_WS_EVENTS: "keep-me-out",
          },
          serverOffset: 0,
          webOffset: 0,
          t3Home: undefined,
          authToken: undefined,
          noBrowser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.T3CODE_MODE, "web");
        assert.equal(env.T3CODE_LOG_WS_EVENTS, undefined);
      }),
    );

    it.effect("forwards explicit websocket logging false without coercing it away", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          t3Home: undefined,
          authToken: undefined,
          noBrowser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: false,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.T3CODE_LOG_WS_EVENTS, "0");
      }),
    );

    it.effect("uses custom t3Home when provided", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          t3Home: "/tmp/my-t3",
          authToken: undefined,
          noBrowser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.T3CODE_HOME, resolve("/tmp/my-t3"));
        assert.equal(env.DPCODE_HOME, resolve("/tmp/my-t3"));
      }),
    );

    it.effect("sets isolated desktop env for Tauri dev mode", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev:desktop-tauri",
          baseEnv: {
            ELECTRON_RENDERER_PORT: "9999",
            T3CODE_AUTH_TOKEN: "inherited-token",
          },
          serverOffset: 3158,
          webOffset: 3158,
          t3Home: "/tmp/tauri-t3",
          authToken: undefined,
          noBrowser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: 58090,
          devUrl: undefined,
        });

        assert.equal(env.T3CODE_MODE, "desktop");
        assert.equal(env.T3CODE_NO_BROWSER, "1");
        assert.equal(env.T3CODE_PORT, "58090");
        assert.equal(env.PORT, "8891");
        assert.equal(env.T3CODE_HOME, resolve("/tmp/tauri-t3"));
        assert.equal(env.DPCODE_HOME, resolve("/tmp/tauri-t3"));
        assert.equal(env.T3CODE_AUTH_TOKEN, undefined);
        assert.equal(env.ELECTRON_RENDERER_PORT, undefined);
      }),
    );
  });

  describe("findFirstAvailableOffset", () => {
    it.effect("returns the starting offset when required ports are available", () =>
      Effect.gen(function* () {
        const offset = yield* findFirstAvailableOffset({
          startOffset: 0,
          requireServerPort: true,
          requireWebPort: true,
          checkPortAvailability: () => Effect.succeed(true),
        });

        assert.equal(offset, 0);
      }),
    );

    it.effect("advances until all required ports are available", () =>
      Effect.gen(function* () {
        const taken = new Set([3773, 5733, 3774, 5734]);
        const offset = yield* findFirstAvailableOffset({
          startOffset: 0,
          requireServerPort: true,
          requireWebPort: true,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.equal(offset, 2);
      }),
    );

    it.effect("allows offsets where only non-required ports exceed max", () =>
      Effect.gen(function* () {
        const offset = yield* findFirstAvailableOffset({
          startOffset: 59_803,
          requireServerPort: true,
          requireWebPort: false,
          checkPortAvailability: () => Effect.succeed(true),
        });

        assert.equal(offset, 59_803);
      }),
    );
  });

  describe("resolveModePortOffsets", () => {
    it.effect("uses a shared fallback offset for dev mode", () =>
      Effect.gen(function* () {
        const taken = new Set([3773, 5733]);
        const offsets = yield* resolveModePortOffsets({
          mode: "dev",
          startOffset: 0,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: false,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 1, webOffset: 1 });
      }),
    );

    it.effect("keeps server offset stable for dev:web and only shifts web offset", () =>
      Effect.gen(function* () {
        const taken = new Set([5733]);
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:web",
          startOffset: 0,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: false,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 0, webOffset: 1 });
      }),
    );

    it.effect("shifts only server offset for dev:server", () =>
      Effect.gen(function* () {
        const taken = new Set([3773]);
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:server",
          startOffset: 0,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: false,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 1, webOffset: 1 });
      }),
    );

    it.effect("respects explicit dev-url override for dev:web", () =>
      Effect.gen(function* () {
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:web",
          startOffset: 0,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: true,
          checkPortAvailability: () => Effect.succeed(false),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 0, webOffset: 0 });
      }),
    );

    it.effect("respects explicit server port override for dev:server", () =>
      Effect.gen(function* () {
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:server",
          startOffset: 0,
          hasExplicitServerPort: true,
          hasExplicitDevUrl: false,
          checkPortAvailability: () => Effect.succeed(false),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 0, webOffset: 0 });
      }),
    );

    it.effect("requires server and web ports for Tauri dev mode", () =>
      Effect.gen(function* () {
        const taken = new Set([3773, 5733]);
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:desktop-tauri",
          startOffset: 0,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: false,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 1, webOffset: 1 });
      }),
    );

    it.effect("requires a web port for Tauri dev mode even when dev-url is present", () =>
      Effect.gen(function* () {
        const taken = new Set([5733]);
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:desktop-tauri",
          startOffset: 0,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: true,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 1, webOffset: 1 });
      }),
    );
  });

  describe("validateModeOptions", () => {
    it.effect("rejects explicit dev-url for Tauri dev mode", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          validateModeOptions({
            mode: "dev:desktop-tauri",
            devUrl: new URL("http://127.0.0.1:9999"),
          }),
        );

        assert.ok(error.message.includes("dev:desktop-tauri does not support --dev-url"));
      }),
    );
  });

  describe("ensureResolvedPortAvailability", () => {
    it.effect("checks explicit server and resolved web ports for Tauri dev mode", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          ensureResolvedPortAvailability({
            mode: "dev:desktop-tauri",
            env: {
              T3CODE_PORT: "58090",
              PORT: "8891",
            },
            checkPortAvailability: (port) => Effect.succeed(port !== 58090),
          }),
        );

        assert.ok(error.message.includes("T3CODE_PORT=58090 is already in use"));
      }),
    );

    it.effect("rejects identical server and web ports for Tauri dev mode", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          ensureResolvedPortAvailability({
            mode: "dev:desktop-tauri",
            env: {
              T3CODE_PORT: "5733",
              PORT: "5733",
            },
            checkPortAvailability: () => Effect.succeed(true),
          }),
        );

        assert.equal(error.message, "dev:desktop-tauri requires distinct server and web ports.");
      }),
    );
  });

  describe("MODE_ARGS", () => {
    it("runs only the Tauri desktop package for Tauri dev mode", () => {
      assert.deepStrictEqual(MODE_ARGS["dev:desktop-tauri"], [
        "run",
        "dev",
        "--filter=@t3tools/desktop-tauri",
      ]);
    });
  });
});
