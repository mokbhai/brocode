import { defineConfig } from "tsdown";

const externalRuntimePackages = ["node-pty", "@effect/sql-sqlite-bun"] as const;

function matchesPackageOrSubpath(id: string, packageName: string): boolean {
  return id === packageName || id.startsWith(`${packageName}/`);
}

export function shouldBundleServerDependency(id: string): boolean {
  // Desktop bundles only apps/server/dist, so regular JS deps must be inlined.
  // Native/runtime-specific packages stay external because they cannot be made portable by tsdown.
  return !externalRuntimePackages.some((packageName) => matchesPackageOrSubpath(id, packageName));
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  checks: {
    legacyCjs: false,
  },
  outDir: "dist",
  sourcemap: true,
  clean: true,
  noExternal: shouldBundleServerDependency,
  inlineOnly: false,
  banner: {
    js: "#!/usr/bin/env node\n",
  },
});
