#!/usr/bin/env node

throw new Error(
  [
    "The Electron desktop artifact builder has been deprecated.",
    "Use the Tauri desktop build instead:",
    "  bun run --cwd apps/desktop-tauri build -- --bundles <app|dmg>",
  ].join("\n"),
);
