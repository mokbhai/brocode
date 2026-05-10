# Phase 4: Browser UX Adaptation

## Objective

Adapt the browser UI so it fits the external browser runtime instead of assuming Electron `<webview>` embedding.

## Current Problem

The existing browser panel creates an Electron `<webview>`, adopts its `webContents`, syncs panel bounds, captures screenshots from that webContents, and keeps browser-use automation aligned with the visible embedded page.

That model is intentionally not the target for Tauri. Recreating it would undermine the memory goal and add platform-specific complexity.

## Target UX

The Tauri browser panel should become a lightweight controller and status surface for the external browser runtime.

It should show:

- connected browser name and runtime mode
- current URL
- tab list
- page title and loading state
- latest screenshot preview when available
- navigation controls
- screenshot actions
- button to focus or open the controlled browser window
- warning state when automation is attached to an existing debug browser

The actual browser page should run in the external Chromium-family browser. This keeps BroCode lightweight and avoids embedding another heavy browser surface.

## Interaction Model

Default isolated mode:

- opening the browser feature launches or focuses the isolated BroCode browser window
- BroCode panel mirrors the active tab state
- browser-use automation operates on the same controlled browser
- screenshots can be inserted into prompts from the panel

Existing debug endpoint mode:

- BroCode connects to the configured endpoint
- the panel shows which endpoint is connected
- the panel avoids implying that BroCode owns the browser process
- disconnect is explicit

## Web App Changes

Remove or isolate Electron-specific assumptions in `BrowserPanel`:

- no direct creation of `<webview>` for Tauri runtime
- no reliance on `getWebContentsId`
- no panel bounds sync for native `webContents`
- no Electron overlay occlusion logic for the Tauri path

The preferred shape is a runtime capability switch:

```txt
embedded-electron-browser
external-cdp-browser
fallback-browser-state
```

This lets Electron remain functional during migration while Tauri uses the external browser model.

## Acceptance Criteria

- the Tauri app does not render an Electron `<webview>`
- browser controls still support navigation, tabs, screenshots, and prompt attachment workflows
- browser-use requests can open or focus the browser panel/status surface
- users can understand whether BroCode launched an isolated browser or connected to an existing endpoint
- browser errors are visible without freezing or blanking the chat UI

## Test Strategy

- focused component tests for runtime capability rendering
- browser panel logic tests for external runtime states
- manual UX smoke test with isolated profile and existing debug endpoint modes
