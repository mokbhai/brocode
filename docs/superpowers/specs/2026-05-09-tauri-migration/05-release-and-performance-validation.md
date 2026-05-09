# Phase 5: Release And Performance Validation

## Objective

Prepare the Tauri desktop app for real distribution and prove that it improves the low-end PC experience enough to justify replacing Electron.

## Release Scope

Replace or parallel the current Electron-builder release flow with Tauri-compatible packaging:

- macOS DMG or app bundle
- Windows installer
- Linux AppImage or equivalent accepted target
- code signing and notarization where required
- updater metadata and update server/feed integration
- release smoke tests
- artifact naming and GitHub release upload compatibility

Electron should remain available until the Tauri release pipeline has passed smoke tests on all supported targets.

## Performance Measurements

Compare Electron and Tauri builds under the same scenarios:

- cold startup time
- time until UI is interactive
- idle memory after startup
- memory with one active agent session
- memory with browser automation disabled
- memory with isolated external browser active
- idle CPU
- transcript rendering responsiveness during streaming output
- backend process cleanup after exit

The measurement should separate:

- DP Code shell memory
- DP Code backend memory
- external browser memory
- total user-visible workflow memory

This distinction matters because the goal is not just moving memory from Electron to Chrome. The isolated external browser should be launched only when the browser feature is needed, so normal chat usage benefits immediately.

## Acceptance Criteria

- Tauri artifacts can be built for supported platforms
- update flow works or has an explicitly accepted replacement for the first Tauri release
- release smoke tests cover startup, backend connection, bridge commands, and shutdown
- low-end hardware measurements show meaningful memory reduction versus Electron for normal chat usage
- browser automation memory impact is opt-in and understandable to users
- docs explain browser detection, isolated profile behavior, and advanced debug endpoint mode

## Rollout Strategy

Ship Tauri as an alpha or preview channel first. Keep Electron as a fallback until:

- crash reports and user feedback are acceptable
- browser automation reliability is comparable or the UX differences are clearly documented
- update flow is proven
- there is a rollback path for users who hit platform-specific webview issues

## Test Strategy

- release smoke tests for packaged artifacts
- manual cross-platform install and update tests
- performance measurement script or checklist checked into the repo
- final full verification pass with the repository's required commands when implementation reaches completion
