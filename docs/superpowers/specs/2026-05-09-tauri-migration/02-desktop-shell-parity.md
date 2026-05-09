# Phase 2: Desktop Shell Parity

## Objective

Port the non-browser Electron desktop behavior to Tauri so the app can be used day to day without relying on Electron.

## Scope

Port the desktop shell features that are not fundamentally tied to Electron `webContents`:

- app data path resolution and legacy profile migration
- logging with rotation
- single-instance behavior
- backend startup, readiness, restart, and shutdown handling
- native menu actions and keyboard shortcuts
- native context menu support where still needed
- theme integration
- desktop notifications
- folder picker, save file, confirmation dialog, external links, and show-in-folder behavior
- voice transcription command bridge if the existing server flow still requires desktop mediation
- update state machine and update UI integration

## Bridge Compatibility

The Tauri implementation should continue exposing the existing `DesktopBridge` shape from `packages/contracts/src/ipc.ts` where possible. Any intentionally changed behavior must be documented before web code is updated.

For event-style APIs such as `onMenuAction` and `onUpdateState`, the Tauri shell should provide a subscription mechanism that behaves like the existing Electron listener cleanup pattern:

```ts
const unsubscribe = window.desktopBridge.onMenuAction(listener);
unsubscribe();
```

## Error Handling

The shell must make backend failures visible and recoverable. Startup errors should produce actionable messages instead of a blank window. Backend child process exits should be logged with command, exit code, signal, and recent stderr when available.

The Tauri shell should preserve predictable behavior during partial startup:

- window can open before backend is fully ready
- backend readiness timeout is explicit
- shutdown cleans up child processes
- stale locks or ports produce a clear error path

## Acceptance Criteria

- Tauri app supports the existing core desktop workflows without Electron
- native menu actions reach the React app
- notification settings and task-completion notifications work
- update state can be queried and rendered in the existing settings UI
- backend logs and desktop logs are written to the expected app data area
- app restart and shutdown do not leave orphan backend processes
- single-instance behavior prevents accidental duplicate desktop sessions unless explicitly supported

## Test Strategy

- unit tests for Rust modules where logic is pure enough to test
- focused web tests only when bridge-facing behavior changes
- manual smoke tests on macOS, Windows, and Linux before release work proceeds
