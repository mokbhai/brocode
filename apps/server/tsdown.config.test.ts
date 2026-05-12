import { describe, expect, it } from "vitest";

import config, { shouldBundleServerDependency } from "./tsdown.config";

describe("server tsdown config", () => {
  it("bundles runtime dependencies needed by the packaged desktop backend", () => {
    expect(shouldBundleServerDependency("@effect/platform-node/NodeRuntime")).toBe(true);
    expect(shouldBundleServerDependency("effect/Effect")).toBe(true);
    expect(shouldBundleServerDependency("@opencode-ai/sdk/v2")).toBe(true);
    expect(shouldBundleServerDependency("@anthropic-ai/claude-agent-sdk")).toBe(true);
    expect(shouldBundleServerDependency("@t3tools/contracts")).toBe(true);
  });

  it("keeps native or non-Node runtime packages external", () => {
    expect(shouldBundleServerDependency("node-pty")).toBe(false);
    expect(shouldBundleServerDependency("node-pty/lib/index.js")).toBe(false);
    expect(shouldBundleServerDependency("@effect/sql-sqlite-bun/SqliteClient")).toBe(false);
  });

  it("wires the dependency bundling predicate into tsdown", () => {
    expect(config.noExternal).toBe(shouldBundleServerDependency);
  });
});
