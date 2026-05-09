# Tauri Migration Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an experimental Tauri proof of concept that hosts the existing web UI, starts the existing backend, and exposes the minimal desktop bridge needed for a connected DP Code session.

**Complete Target:** Replace the Electron desktop shell with a lower-memory Tauri/Rust shell while keeping the TypeScript web UI, TypeScript backend, and shared contracts; browser automation will move to an installed Chromium-family browser in later phases.

**Architecture:** Add a parallel Tauri app target so Electron remains untouched during the proof of concept. The Tauri Rust side owns backend process supervision and native commands; the web side receives a `window.desktopBridge`-compatible object from a small Tauri bridge script. Phase 1 deliberately avoids updater, browser automation, and full native menu parity.

**Tech Stack:** Tauri v2, Rust, Bun workspaces, React/Vite web app, existing `apps/server` backend, Tauri command API, Tauri dialog/opener/shell plugins as needed.

**Spec Source:** `docs/superpowers/specs/2026-05-09-tauri-migration/00-overview.md` + `docs/superpowers/specs/2026-05-09-tauri-migration/01-tauri-proof-of-concept.md`

**Phase:** Phase 1: Tauri Proof Of Concept

**Next Required Phase:** Phase 2: Desktop Shell Parity, `docs/superpowers/specs/2026-05-09-tauri-migration/02-desktop-shell-parity.md`

---

## References

- Tauri Vite config docs: `https://v2.tauri.app/start/frontend/vite/`
- Tauri command docs: `https://v2.tauri.app/develop/calling-rust/`
- Tauri Node sidecar docs: `https://v2.tauri.app/learn/sidecar-nodejs/`
- Current Electron bridge contract: `packages/contracts/src/ipc.ts`
- Current Electron preload bridge: `apps/desktop/src/preload.ts`
- Current Electron backend startup shell: `apps/desktop/src/main.ts`
- Current dev isolation rules: `AGENTS.md`

## File Structure

Create a new experimental app instead of replacing `apps/desktop` immediately:

- Create `apps/desktop-tauri/package.json`
  Owns Bun scripts for Tauri dev/build/test commands.
- Create `apps/desktop-tauri/src-tauri/Cargo.toml`
  Rust package metadata and Tauri/plugin dependencies.
- Create `apps/desktop-tauri/src-tauri/build.rs`
  Tauri build script required by `tauri::generate_context!`.
- Create `apps/desktop-tauri/src-tauri/tauri.conf.json`
  Tauri app config, Vite dev URL, frontend dist, identifier, and capabilities.
- Create `apps/desktop-tauri/src-tauri/capabilities/default.json`
  Minimal command permissions for the main window.
- Create `apps/desktop-tauri/src-tauri/src/main.rs`
  Tauri bootstrap, command registration, process state setup, and shutdown cleanup.
- Create `apps/desktop-tauri/src-tauri/src/backend.rs`
  Backend child process supervisor and readiness polling.
- Create `apps/desktop-tauri/src-tauri/src/bridge.rs`
  Rust command handlers for bridge methods.
- Create `apps/desktop-tauri/src-tauri/src/paths.rs`
  App home, dev home, and repo path resolution helpers.
- Create `apps/desktop-tauri/src-tauri/src/errors.rs`
  Shared error type serializable to the frontend.
- Create `apps/desktop-tauri/src/desktopBridge.ts`
  Frontend-side `window.desktopBridge` adapter backed by `@tauri-apps/api/core`.
- Create `apps/desktop-tauri/src/main.ts`
  Imports the bridge adapter, then imports the existing web entry.
- Modify `package.json`
  Add root scripts for the experimental Tauri app.
- Modify `scripts/dev-runner.ts`
  Add a `dev:desktop-tauri` mode with isolated default ports/home and no Electron assumptions.
- Modify `apps/web/vite.config.ts`
  Add an alias or entry override only if needed so Tauri can use `apps/desktop-tauri/src/main.ts`.
- Do not modify `apps/desktop` in this phase except if a shared helper is extracted with clear benefit.

## Task 1: Add Workspace Package And Tauri Skeleton

**Files:**
- Create: `apps/desktop-tauri/package.json`
- Create: `apps/desktop-tauri/src-tauri/Cargo.toml`
- Create: `apps/desktop-tauri/src-tauri/build.rs`
- Create: `apps/desktop-tauri/src-tauri/tauri.conf.json`
- Create: `apps/desktop-tauri/src-tauri/capabilities/default.json`
- Create: `apps/desktop-tauri/src-tauri/src/main.rs`
- Create: `apps/desktop-tauri/src-tauri/src/errors.rs`
- Modify: `package.json`

- [ ] **Step 1: Create package manifest**

Add `apps/desktop-tauri/package.json`:

```json
{
  "name": "@t3tools/desktop-tauri",
  "version": "0.0.42",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build",
    "typecheck": "tsc --noEmit",
    "test": "cargo test --manifest-path src-tauri/Cargo.toml"
  },
  "dependencies": {
    "@tauri-apps/api": "^2"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "@t3tools/web": "workspace:*",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 2: Add Tauri Rust manifest**

Add `apps/desktop-tauri/src-tauri/Cargo.toml`:

```toml
[package]
name = "dpcode_desktop_tauri"
version = "0.0.42"
description = "DP Code Tauri desktop shell proof of concept"
edition = "2021"

[lib]
name = "dpcode_desktop_tauri"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-opener = "2"
tokio = { version = "1", features = ["process", "rt-multi-thread", "sync", "time"] }
```

- [ ] **Step 3: Add Tauri build script**

Add `apps/desktop-tauri/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build();
}
```

- [ ] **Step 4: Add Tauri config**

Add `apps/desktop-tauri/src-tauri/tauri.conf.json`. Use Tauri v2 `devUrl`/`frontendDist` shape from the official Vite docs.

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "DP Code Tauri (POC)",
  "version": "0.0.42",
  "identifier": "com.t3tools.dpcode.tauri.dev",
  "build": {
    "beforeDevCommand": "bun run --cwd ../web dev -- --host 127.0.0.1",
    "beforeBuildCommand": "bun run --cwd ../web build",
    "devUrl": "http://127.0.0.1:5733",
    "frontendDist": "../../web/dist"
  },
  "app": {
    "windows": [
      {
        "title": "DP Code Tauri (POC)",
        "width": 1280,
        "height": 820,
        "minWidth": 960,
        "minHeight": 640
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": false,
    "targets": "all"
  }
}
```

If the relative `--cwd ../web` path does not resolve from Tauri's actual working directory, adjust it during implementation to `../../web` or use a small Node helper that resolves paths from `CARGO_MANIFEST_DIR`. If the Vite dev server port is controlled by `PORT`, set `PORT=5733` cross-platform through that helper instead of shell-specific syntax.

- [ ] **Step 5: Add minimal capability file**

Add `apps/desktop-tauri/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Main window permissions for the DP Code Tauri proof of concept.",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    "opener:default"
  ]
}
```

- [ ] **Step 6: Add initial Rust entrypoint**

Add `apps/desktop-tauri/src-tauri/src/main.rs`:

```rust
mod errors;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("failed to run DP Code Tauri shell");
}
```

- [ ] **Step 7: Add shared error shell**

Add `apps/desktop-tauri/src-tauri/src/errors.rs`:

```rust
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct BridgeError {
    pub message: String,
}

impl BridgeError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}
```

- [ ] **Step 8: Add root scripts**

Modify root `package.json` scripts:

```json
{
  "dev:desktop-tauri": "node scripts/dev-runner.ts dev:desktop-tauri",
  "start:desktop-tauri": "turbo run dev --filter=@t3tools/desktop-tauri"
}
```

Use the existing script ordering and naming style.

- [ ] **Step 9: Run targeted install/check**

Run:

```bash
bun install
bun --cwd apps/desktop-tauri run test
```

Expected:

- dependencies resolve
- `cargo test` compiles the empty Tauri shell or reports only environment setup issues that must be fixed before continuing

- [ ] **Step 10: Commit**

```bash
git add package.json apps/desktop-tauri
git commit -m "Add Tauri desktop proof of concept shell"
```

## Task 2: Add Backend Process Supervisor

**Files:**
- Create: `apps/desktop-tauri/src-tauri/src/backend.rs`
- Create: `apps/desktop-tauri/src-tauri/src/paths.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/main.rs`
- Test: `apps/desktop-tauri/src-tauri/src/backend.rs`

- [ ] **Step 1: Write backend config and URL tests**

Add tests inside `backend.rs` for URL construction and readiness endpoint selection:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_loopback_ws_url() {
        let config = BackendConfig {
            port: 58090,
            host: "127.0.0.1".to_string(),
            home_dir: ".dpcode-tauri-dev".into(),
            repo_root: "/repo".into(),
        };

        assert_eq!(config.ws_url(), "ws://127.0.0.1:58090");
        assert_eq!(config.http_url(), "http://127.0.0.1:58090");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun --cwd apps/desktop-tauri run test
```

Expected: FAIL because `BackendConfig` does not exist.

- [ ] **Step 3: Implement backend config and supervisor skeleton**

Add `apps/desktop-tauri/src-tauri/src/backend.rs`:

```rust
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::errors::BridgeError;

#[derive(Debug, Clone)]
pub struct BackendConfig {
    pub port: u16,
    pub host: String,
    pub home_dir: PathBuf,
    pub repo_root: PathBuf,
}

impl BackendConfig {
    pub fn http_url(&self) -> String {
        format!("http://{}:{}", self.host, self.port)
    }

    pub fn ws_url(&self) -> String {
        format!("ws://{}:{}", self.host, self.port)
    }
}

#[derive(Default)]
pub struct BackendState {
    child: Mutex<Option<Child>>,
    ws_url: Mutex<Option<String>>,
}

impl BackendState {
    pub async fn ws_url(&self) -> Option<String> {
        self.ws_url.lock().await.clone()
    }

    async fn set_ws_url(&self, value: String) {
        *self.ws_url.lock().await = Some(value);
    }
}

pub type SharedBackendState = Arc<BackendState>;

pub async fn start_backend(state: SharedBackendState, config: BackendConfig) -> Result<(), BridgeError> {
    let mut guard = state.child.lock().await;
    if guard.is_some() {
        return Ok(());
    }

    let mut command = Command::new("bun");
    command
        .arg("run")
        .arg("dev:server")
        .current_dir(&config.repo_root)
        .env("T3CODE_MODE", "desktop")
        .env("T3CODE_HOST", &config.host)
        .env("T3CODE_PORT", config.port.to_string())
        .env("T3CODE_HOME", &config.home_dir)
        .env("DPCODE_HOME", &config.home_dir)
        .env("T3CODE_NO_BROWSER", "1")
        .env_remove("T3CODE_AUTH_TOKEN")
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let child = command.spawn().map_err(|error| {
        BridgeError::new(format!("Failed to start DP Code backend: {error}"))
    })?;

    *guard = Some(child);
    drop(guard);

    wait_for_http_ready(&config.http_url()).await?;
    state.set_ws_url(config.ws_url()).await;
    Ok(())
}

pub async fn stop_backend(state: SharedBackendState) {
    if let Some(mut child) = state.child.lock().await.take() {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

async fn wait_for_http_ready(base_url: &str) -> Result<(), BridgeError> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(BridgeError::new(format!(
                "Timed out waiting for backend readiness at {base_url}"
            )));
        }

        match reqwest::get(base_url).await {
            Ok(response) if response.status().is_success() => return Ok(()),
            _ => tokio::time::sleep(Duration::from_millis(100)).await,
        }
    }
}
```

Add `reqwest` to `Cargo.toml`:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }
```

If `bun run dev:server` recursively uses `scripts/dev-runner.ts` in a way that is unsuitable from Rust, switch the command to `bun run --cwd apps/server dev` with equivalent environment variables.

- [ ] **Step 4: Add repo path helper**

Add `apps/desktop-tauri/src-tauri/src/paths.rs`:

```rust
use std::path::PathBuf;

use crate::errors::BridgeError;

pub fn repo_root() -> Result<PathBuf, BridgeError> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(|path| path.parent())
        .and_then(|path| path.parent())
        .map(PathBuf::from)
        .ok_or_else(|| BridgeError::new("Failed to resolve repository root"))
}

pub fn default_dev_home(repo_root: &std::path::Path) -> PathBuf {
    repo_root.join(".dpcode-tauri-dev")
}
```

- [ ] **Step 5: Wire startup and shutdown**

Modify `main.rs`:

```rust
mod backend;
mod errors;
mod paths;

use std::sync::Arc;

use backend::{BackendConfig, BackendState};

fn main() {
    let backend_state = Arc::new(BackendState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(backend_state.clone())
        .setup(move |app| {
            let state = backend_state.clone();
            let repo_root = paths::repo_root()?;
            let config = BackendConfig {
                port: std::env::var("T3CODE_PORT")
                    .ok()
                    .and_then(|value| value.parse::<u16>().ok())
                    .unwrap_or(58090),
                host: "127.0.0.1".to_string(),
                home_dir: std::env::var("DPCODE_HOME")
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|_| paths::default_dev_home(&repo_root)),
                repo_root,
            };

            tauri::async_runtime::spawn(async move {
                if let Err(error) = backend::start_backend(state, config).await {
                    eprintln!("[desktop-tauri] {message}", message = error.message);
                }
            });

            Ok(())
        })
        .on_window_event(move |_window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let state = backend_state.clone();
                tauri::async_runtime::spawn(async move {
                    backend::stop_backend(state).await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run DP Code Tauri shell");
}
```

Fix ownership if Rust complains about moving `backend_state` into both closures; prefer a small `AppState` wrapper if needed.

- [ ] **Step 6: Run targeted Rust tests**

Run:

```bash
bun --cwd apps/desktop-tauri run test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop-tauri/src-tauri
git commit -m "Start backend from Tauri shell"
```

## Task 3: Implement Minimal Tauri Desktop Bridge

**Files:**
- Create: `apps/desktop-tauri/src-tauri/src/bridge.rs`
- Modify: `apps/desktop-tauri/src-tauri/src/main.rs`
- Modify: `apps/desktop-tauri/src-tauri/Cargo.toml`
- Create: `apps/desktop-tauri/src/desktopBridge.ts`
- Create: `apps/desktop-tauri/src/main.ts`
- Modify: `apps/web/vite.config.ts` only if an entry alias is required

- [ ] **Step 1: Add Rust command handlers**

Create `apps/desktop-tauri/src-tauri/src/bridge.rs`:

```rust
use std::fs;

use serde::Deserialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::backend::BackendState;
use crate::errors::BridgeError;

#[derive(Debug, Deserialize)]
pub struct SaveFileInput {
    pub default_filename: String,
    pub contents: String,
}

#[tauri::command]
pub async fn get_ws_url(state: State<'_, std::sync::Arc<BackendState>>) -> Result<Option<String>, BridgeError> {
    Ok(state.ws_url().await)
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, BridgeError> {
    let result = app.dialog().file().blocking_pick_folder();
    Ok(result.map(|path| path.to_string()))
}

#[tauri::command]
pub async fn save_file(app: AppHandle, input: SaveFileInput) -> Result<Option<String>, BridgeError> {
    let path = app
        .dialog()
        .file()
        .set_file_name(&input.default_filename)
        .blocking_save_file();

    let Some(path) = path else {
        return Ok(None);
    };

    let path_string = path.to_string();
    fs::write(&path_string, input.contents)
        .map_err(|error| BridgeError::new(format!("Failed to save file: {error}")))?;
    Ok(Some(path_string))
}

#[tauri::command]
pub async fn confirm(_app: AppHandle, message: String) -> Result<bool, BridgeError> {
    // Phase 1 keeps this deliberately simple. Replace with native message dialog in Phase 2.
    Ok(!message.trim().is_empty())
}

#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> Result<bool, BridgeError> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| BridgeError::new(format!("Failed to open external URL: {error}")))?;
    Ok(true)
}

#[tauri::command]
pub async fn show_in_folder(app: AppHandle, path: String) -> Result<(), BridgeError> {
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|error| BridgeError::new(format!("Failed to show item in folder: {error}")))
}
```

Adjust API calls to exact Tauri plugin signatures during implementation; keep command names stable.

- [ ] **Step 2: Register commands**

Modify `main.rs`:

```rust
mod bridge;

// inside Builder chain
.invoke_handler(tauri::generate_handler![
    bridge::get_ws_url,
    bridge::pick_folder,
    bridge::save_file,
    bridge::confirm,
    bridge::open_external,
    bridge::show_in_folder,
])
```

- [ ] **Step 3: Add frontend bridge adapter**

Create `apps/desktop-tauri/src/desktopBridge.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { DesktopBridge, DesktopUpdateState, ThreadBrowserState, ThreadId } from "@t3tools/contracts";

let resolvedWsUrl: string | null = null;

function emptyBrowserState(threadId: ThreadId): ThreadBrowserState {
  return {
    threadId,
    version: 0,
    open: false,
    activeTabId: null,
    tabs: [],
    lastError: null,
  };
}

function disabledUpdateState(): DesktopUpdateState {
  return {
    enabled: false,
    status: "disabled",
    currentVersion: "0.0.42",
    hostArch: "other",
    appArch: "other",
    runningUnderArm64Translation: false,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: "Updates are not available in the Tauri proof of concept.",
    errorContext: null,
    canRetry: false,
  };
}

const unsupportedBrowserBridge: DesktopBridge["browser"] = {
  open: async () => {
    throw new Error("Browser automation is not available in the Tauri proof of concept.");
  },
  close: async () => {
    throw new Error("Browser automation is not available in the Tauri proof of concept.");
  },
  hide: async () => {},
  getState: async (input) => emptyBrowserState(input.threadId),
  setPanelBounds: async () => {},
  attachWebview: async (input) => emptyBrowserState(input.threadId),
  copyScreenshotToClipboard: async () => {
    throw new Error("Browser screenshots are not available in the Tauri proof of concept.");
  },
  captureScreenshot: async () => {
    throw new Error("Browser screenshots are not available in the Tauri proof of concept.");
  },
  executeCdp: async () => {
    throw new Error("Browser automation is not available in the Tauri proof of concept.");
  },
  navigate: async (input) => emptyBrowserState(input.threadId),
  reload: async (input) => emptyBrowserState(input.threadId),
  goBack: async (input) => emptyBrowserState(input.threadId),
  goForward: async (input) => emptyBrowserState(input.threadId),
  newTab: async (input) => emptyBrowserState(input.threadId),
  closeTab: async (input) => emptyBrowserState(input.threadId),
  selectTab: async (input) => emptyBrowserState(input.threadId),
  openDevTools: async () => {},
  onState: () => () => {},
  onBrowserUseOpenPanelRequest: () => () => {},
};

export async function installDesktopBridge(): Promise<void> {
  resolvedWsUrl = await invoke<string | null>("get_ws_url");

  window.desktopBridge = {
    getWsUrl: () => resolvedWsUrl,
    pickFolder: () => invoke<string | null>("pick_folder"),
    saveFile: (input) =>
      invoke<string | null>("save_file", {
        input: {
          default_filename: input.defaultFilename,
          contents: input.contents,
        },
      }),
    confirm: (message) => invoke<boolean>("confirm", { message }),
    setTheme: async () => {},
    showContextMenu: async () => null,
    openExternal: (url) => invoke<boolean>("open_external", { url }),
    showInFolder: (path) => invoke<void>("show_in_folder", { path }),
    shell: {
      showInFolder: (path) => invoke<void>("show_in_folder", { path }),
    },
    onMenuAction: () => () => {},
    getUpdateState: async () => disabledUpdateState(),
    checkForUpdates: async () => disabledUpdateState(),
    downloadUpdate: async () => ({
      accepted: false,
      completed: false,
      state: disabledUpdateState(),
    }),
    installUpdate: async () => ({
      accepted: false,
      completed: false,
      state: disabledUpdateState(),
    }),
    onUpdateState: () => () => {},
    notifications: {
      isSupported: async () => false,
      show: async () => false,
    },
    browser: unsupportedBrowserBridge,
  };
}
```

The important behavior is that the bridge is installed before importing the existing React entry. If the backend is not ready yet, either wait briefly and retry `get_ws_url` here or make the Rust command wait for startup completion.

- [ ] **Step 4: Add Tauri web entry**

Create `apps/desktop-tauri/src/main.ts`:

```ts
import { installDesktopBridge } from "./desktopBridge";

await installDesktopBridge();
await import("../../web/src/main");
```

If Vite cannot import the web entry across package boundaries cleanly, add a Vite config mode or alias instead of duplicating React bootstrap code.

- [ ] **Step 5: Run targeted checks**

Run:

```bash
bun --cwd apps/desktop-tauri run typecheck
bun --cwd apps/desktop-tauri run test
```

Expected: PASS after adjusting exact Tauri API signatures and contract shapes.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop-tauri apps/web/vite.config.ts
git commit -m "Expose minimal Tauri desktop bridge"
```

## Task 4: Add Isolated Dev Runner Mode

**Files:**
- Modify: `scripts/dev-runner.ts`
- Test: existing tests if present, otherwise add focused tests near `scripts/dev-runner.ts` only if the repo already has a test pattern for scripts
- Modify: `package.json`

- [ ] **Step 1: Add failing expectation for mode mapping**

If script tests exist, add a case that `dev:desktop-tauri` sets:

```txt
T3CODE_MODE=desktop
T3CODE_NO_BROWSER=1
T3CODE_HOME=<configured isolated home>
DPCODE_HOME=<configured isolated home>
PORT=<web port>
T3CODE_PORT=<server port>
```

If no script test harness exists, document the dry-run command in the implementation PR and keep this as a manual verification.

- [ ] **Step 2: Update mode args**

Modify `MODE_ARGS` in `scripts/dev-runner.ts`:

```ts
"dev:desktop-tauri": [
  "run",
  "dev",
  "--filter=@t3tools/desktop-tauri",
  "--filter=@t3tools/web",
]
```

Then update `DevMode` flow so this mode:

- requires both server and web ports to be available
- sets `T3CODE_MODE=desktop`
- sets `T3CODE_NO_BROWSER=1`
- unsets inherited `T3CODE_AUTH_TOKEN` unless explicitly provided
- supports `--home-dir`, `--port`, `--dry-run`, and `T3CODE_PORT_OFFSET`

- [ ] **Step 3: Add root script if not already added**

Ensure root `package.json` includes:

```json
"dev:desktop-tauri": "node scripts/dev-runner.ts dev:desktop-tauri"
```

- [ ] **Step 4: Run dry-run conflict check**

Run:

```bash
env -u T3CODE_AUTH_TOKEN T3CODE_PORT_OFFSET=3158 bun run dev:desktop-tauri -- --home-dir ./.dpcode-tauri-dev --port 58090 --dry-run
```

Expected:

- no process starts
- output shows server port `58090`
- output shows isolated home `./.dpcode-tauri-dev`
- output does not inherit `T3CODE_AUTH_TOKEN`

- [ ] **Step 5: Commit**

```bash
git add scripts/dev-runner.ts package.json
git commit -m "Add isolated Tauri desktop dev mode"
```

## Task 5: Manual Smoke Test And Phase 1 Notes

**Files:**
- Create: `apps/desktop-tauri/README.md`
- Modify: `docs/superpowers/specs/2026-05-09-tauri-migration/00-overview.md`

- [ ] **Step 1: Add Tauri POC README**

Create `apps/desktop-tauri/README.md`:

```md
# DP Code Tauri Proof Of Concept

This package is an experimental Tauri shell for DP Code. It exists to validate a lower-memory desktop runtime while the Electron app remains supported.

## Development

Run a dry run first:

```bash
env -u T3CODE_AUTH_TOKEN T3CODE_PORT_OFFSET=3158 bun run dev:desktop-tauri -- --home-dir ./.dpcode-tauri-dev --port 58090 --dry-run
```

Start the Tauri proof of concept:

```bash
env -u T3CODE_AUTH_TOKEN T3CODE_PORT_OFFSET=3158 bun run dev:desktop-tauri -- --home-dir ./.dpcode-tauri-dev --port 58090
```

Phase 1 supports backend startup, WebSocket connection, and a minimal desktop bridge. Browser automation, updater behavior, and full native menu parity are later migration phases.
```

- [ ] **Step 2: Update spec status**

Modify `docs/superpowers/specs/2026-05-09-tauri-migration/00-overview.md`:

```md
## Current Status

Status: Phase 1 implementation in progress.
```

After the smoke test passes, update it to:

```md
Status: Phase 1 proof of concept complete; Phase 2 is next.
```

- [ ] **Step 3: Start the POC**

Run:

```bash
env -u T3CODE_AUTH_TOKEN T3CODE_PORT_OFFSET=3158 bun run dev:desktop-tauri -- --home-dir ./.dpcode-tauri-dev --port 58090
```

Expected:

- Tauri window opens
- backend starts on `127.0.0.1:58090`
- web UI connects through `desktopBridge.getWsUrl`
- no default Electron app starts

- [ ] **Step 4: Verify bridge commands manually**

From the UI:

- open settings or a flow that calls folder picker
- save a generated markdown file if a save action is available
- click an external link
- use show-in-folder where available

Expected:

- commands resolve through Tauri
- failures show actionable errors
- app remains responsive

- [ ] **Step 5: Stop and verify cleanup**

Close the Tauri window, then run:

```bash
lsof -nP -iTCP:58090 -sTCP:LISTEN
```

Expected:

- no listener remains on port `58090`
- no orphan `bun run dev:server` child process remains

- [ ] **Step 6: Final focused verification**

Run targeted checks:

```bash
bun --cwd apps/desktop-tauri run typecheck
bun --cwd apps/desktop-tauri run test
```

Expected: PASS.

Do not run workspace `bun fmt`, `bun lint`, or `bun typecheck` unless the user explicitly requests the heavyweight final pass for this implementation task.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop-tauri docs/superpowers/specs/2026-05-09-tauri-migration/00-overview.md
git commit -m "Document Tauri proof of concept usage"
```

## Handoff Notes

Phase 1 is intentionally successful only when it proves the shell architecture works. Do not port browser automation, updater behavior, native menu parity, or release packaging while executing this plan. Those belong to later phase specs.

If Tauri command APIs differ from the snippets above, prefer the current official Tauri v2 API over preserving the exact snippet. Keep command names and web-facing bridge behavior stable so the React app does not need broad changes in Phase 1.
