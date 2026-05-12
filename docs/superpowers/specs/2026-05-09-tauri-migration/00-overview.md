# Tauri Migration Overview

## Goal

Reduce BroCode desktop memory use and improve smoothness on low-end PCs by replacing the Electron desktop shell with a Tauri/Rust shell while preserving the existing TypeScript web UI, TypeScript backend, and shared contracts.

The migration should not become a full Rust rewrite. Rust should own native desktop responsibilities: window lifecycle, process supervision, system integrations, update plumbing, and browser runtime launch/control where it is a better fit. Product logic, orchestration, provider runtime handling, contracts, and React UI should remain in the current TypeScript packages unless a later measured bottleneck proves otherwise.

## Current Constraints

BroCode is not just a browser-wrapped web app. The current Electron desktop package owns:

- starting and supervising the local backend process
- exposing `window.desktopBridge` to the React app
- native folder and save dialogs
- confirmation dialogs
- external links and show-in-folder behavior
- native menus and menu actions
- desktop notifications
- theme integration
- app update flow
- app data paths, logging, and single-instance behavior
- voice transcription IPC
- an Electron-shaped in-app browser runtime using `webContents`, `<webview>`, screenshots, CDP commands, navigation state, and browser-use pipe support

Most of these map cleanly to Tauri. The browser runtime is the main architectural change.

## Target Architecture

Keep the existing TypeScript packages:

```txt
apps/web        React/Vite/TypeScript UI
apps/server     existing TypeScript backend and provider orchestration
packages/*      shared contracts, schemas, and runtime utilities
```

Replace the Electron desktop package with a Tauri shell:

```txt
apps/desktop    Tauri/Rust shell
  Rust command handlers
  backend process supervisor
  system integration bridge
  update and packaging configuration
  external Chromium-family browser runtime controller
```

The web app should keep consuming a `desktopBridge`-compatible API initially. That compatibility layer reduces migration blast radius and lets the Tauri shell land without rewriting all web consumers at once.

## Browser Runtime Strategy

Do not recreate Electron's embedded Chromium runtime inside Tauri as the first target. Instead, use an installed Chromium-family browser for automation:

- Google Chrome
- Microsoft Edge
- Chromium or compatible derivatives where CDP support is adequate

Safari is not a first-class automation target because browser-use and the current `executeCdp` contract expect Chrome DevTools Protocol behavior.

Browser automation modes:

1. **Isolated BroCode browser profile**, default and recommended.
   BroCode launches an installed Chromium-family browser with a dedicated profile and remote debugging enabled. This avoids bundling Chromium while keeping cookies, tabs, extensions, and user browsing state separate from the user's normal browser.

2. **Connect to existing debug browser**, advanced.
   BroCode connects to a user-provided CDP endpoint such as `http://127.0.0.1:9222`. This supports power users who intentionally start a debug-enabled browser.

BroCode should not silently attach to the user's ordinary active browser. In most cases that browser is not attachable without remote debugging, and silent attachment would be a privacy and reliability risk.

## Required Phases

1. [Phase 1: Tauri Proof Of Concept](./01-tauri-proof-of-concept.md)
2. [Phase 2: Desktop Shell Parity](./02-desktop-shell-parity.md)
3. [Phase 3: External Browser Runtime](./03-external-browser-runtime.md)
4. [Phase 4: Browser UX Adaptation](./04-browser-ux-adaptation.md)
5. [Phase 5: Release And Performance Validation](./05-release-and-performance-validation.md)

Each phase should produce working software that can be tested independently. Electron should remain available until the Tauri shell passes release and performance validation.

## Completion Criteria

The migration is complete when:

- the Tauri app can install and run on macOS, Windows, and Linux release targets
- the app starts the existing backend and connects the existing web UI reliably
- the existing web app can use desktop bridge features without Electron
- browser automation works through an isolated installed Chromium-family browser by default
- advanced users can connect to an existing CDP endpoint
- update, logging, single-instance, app data, notification, dialog, and shell features have parity or explicitly accepted replacements
- memory use, startup time, and idle CPU are measured against Electron and show meaningful improvement on low-end hardware
- Electron packaging can be removed or formally kept as a fallback with an explicit support policy

## Risks

The main risk is browser parity. Electron provides direct `webContents`, `<webview>`, and Chromium debugger APIs. Tauri does not provide a drop-in equivalent. The target design intentionally changes the browser model to an external browser runtime so the migration serves the memory goal instead of reproducing Electron's heaviest behavior.

The second risk is platform variance. Tauri uses system webviews and OS integration layers, so Windows, macOS, and Linux behavior must be validated separately.

The third risk is packaging complexity. The current release process is Electron-builder based. Tauri requires new signing, updater, artifact, and smoke-test wiring.

## Current Status

Status: Tauri is the supported desktop shell, the backend-managed external Chromium browser runtime is implemented, and macOS unsigned install/startup has been smoke tested. Remaining validation is release hardening: native signing/notarization, updater behavior, full native menu parity, and Windows/Linux install and runtime smoke tests.
