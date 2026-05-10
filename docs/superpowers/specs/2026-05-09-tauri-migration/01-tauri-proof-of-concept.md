# Phase 1: Tauri Proof Of Concept

## Objective

Prove that a Tauri shell can host the existing BroCode web UI, start the existing backend, and expose a minimal desktop bridge without disturbing the current Electron app.

## Scope

Create an experimental Tauri desktop target alongside the current Electron implementation. The proof of concept should be intentionally narrow: it should validate the architecture, not attempt full feature parity.

Required behavior:

- build or load the existing `apps/web` output
- start the existing `apps/server` backend with isolated dev ports and home directory support
- wait for backend readiness before considering startup complete
- expose a `window.desktopBridge`-compatible surface for:
  - `getWsUrl`
  - `pickFolder`
  - `saveFile`
  - `confirm`
  - `openExternal`
  - `showInFolder`
- connect the web UI to the backend WebSocket through the bridge URL
- run in development without colliding with a user's existing BroCode instance

## Non-Goals

- replacing Electron packaging
- porting updater behavior
- porting browser automation
- matching every menu, notification, or shell integration
- changing the server or web app architecture

## Design Notes

The Tauri shell should preserve the existing `desktopBridge` contract initially. The web app already centralizes desktop calls behind `window.desktopBridge` and `wsNativeApi`, so bridge compatibility keeps the first phase small and testable.

The backend supervisor should be designed as a Rust module with a small public surface:

```txt
start_backend(config) -> BackendHandle
stop_backend(handle)
backend_ws_url(handle) -> String
wait_for_backend_ready(handle) -> Result
```

The proof of concept may launch the server through the existing built artifact or dev command, but the decision must be documented because packaged releases will need deterministic sidecar behavior.

## Acceptance Criteria

- a developer can start the Tauri proof of concept without starting Electron
- the web UI renders inside the Tauri window
- the UI receives a valid WebSocket URL from `desktopBridge.getWsUrl`
- project/thread state can load from the backend
- folder picker, save file, confirm dialog, open external, and show-in-folder work through Tauri commands
- stopping the Tauri app terminates the backend child process
- the existing Electron app remains unchanged and runnable

## Test Strategy

- focused unit tests for backend command construction and readiness parsing where practical
- manual development smoke test for startup, WebSocket connection, and bridge commands
- no full workspace `bun fmt`, `bun lint`, or `bun typecheck` until the final verification pass for the implementation task, per project instructions
