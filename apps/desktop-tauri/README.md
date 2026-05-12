# BroCode Tauri Shell

This package is the supported desktop shell for BroCode. It hosts the existing web UI and TypeScript backend inside a lighter native Tauri runtime. The old Electron package is kept only as deprecated source history and is no longer wired into install, dev, or release builds.

## Development

Use an isolated home directory and non-default ports when running the proof of concept alongside another BroCode instance.

Dry-run the process plan first:

```sh
env -u T3CODE_AUTH_TOKEN T3CODE_PORT_OFFSET=3158 bun run dev:desktop-tauri -- --home-dir ./.brocode-tauri-dev --port 58090 --dry-run
```

Start the Tauri desktop app:

```sh
env -u T3CODE_AUTH_TOKEN T3CODE_PORT_OFFSET=3158 bun run dev:desktop-tauri -- --home-dir ./.brocode-tauri-dev --port 58090
```

The dry-run should show the backend on port `58090`, the web dev server on port `8891`, an isolated `baseDir`, and no inherited auth token. Unsetting `T3CODE_AUTH_TOKEN` matters because the browser-side WebSocket connection must match the backend auth configuration.

## Current Scope

The Tauri shell supports backend startup, WebSocket connection, and a `window.desktopBridge` compatibility layer for the web app.

Browser automation is implemented through the backend-managed external Chromium runtime. Tauri does not create an Electron-style embedded `<webview>`; the browser panel is a lightweight controller for an isolated Chrome, Edge, or Chromium process exposed through the same desktop bridge shape and browser-use pipe.

Updater behavior and full native menu parity are still being migrated. Treat gaps in those areas as Tauri follow-up work, not as a reason to route builds back through Electron.
