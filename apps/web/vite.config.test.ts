import { describe, expect, it } from "vitest";

import config from "./vite.config";

describe("Vite Tauri entry config", () => {
  it("runs the Tauri entry HTML transform before Vite discovers the production entry", () => {
    const plugin = config.plugins.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        "name" in candidate &&
        candidate.name === "brocode-tauri-entry",
    );

    expect(plugin).toBeTruthy();
    expect(plugin?.transformIndexHtml).toEqual(
      expect.objectContaining({
        order: "pre",
      }),
    );
  });
});
