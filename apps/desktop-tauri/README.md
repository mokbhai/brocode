# DP Code Tauri Shell

This package is an experimental Tauri shell for DP Code. It exists to prove that the existing web UI and TypeScript backend can run inside a lighter native desktop host. The Electron desktop app remains supported while the Tauri migration is validated.

## Development

Use an isolated home directory and non-default ports when running the proof of concept alongside another DP Code instance.

Dry-run the process plan first:

```sh
env -u T3CODE_AUTH_TOKEN T3CODE_PORT_OFFSET=3158 bun run dev:desktop-tauri -- --home-dir ./.dpcode-tauri-dev --port 58090 --dry-run
```

Start the Tauri proof of concept:

```sh
env -u T3CODE_AUTH_TOKEN T3CODE_PORT_OFFSET=3158 bun run dev:desktop-tauri -- --home-dir ./.dpcode-tauri-dev --port 58090
```

The dry-run should show the backend on port `58090`, the web dev server on port `8891`, an isolated `baseDir`, and no inherited auth token. Unsetting `T3CODE_AUTH_TOKEN` matters because the browser-side WebSocket connection must match the backend auth configuration.

## Phase 1 Scope

Phase 1 supports backend startup, WebSocket connection, and a minimal `window.desktopBridge` compatibility layer for the web app.

Browser automation, updater behavior, and full native menu parity are planned for later phases. Treat missing parity in those areas as expected proof-of-concept limitations rather than regressions in the Electron desktop app.
