# Tauri Migration Backlog

These ideas are not required for the initial migration target.

## Optional Improvements

- provide a custom browser executable picker in settings
- support Brave, Vivaldi, Arc, or other Chromium-family browsers after Chrome, Edge, and Chromium are stable
- add per-project browser profiles
- add an import/export flow for isolated browser profile data
- add a memory saver mode that automatically closes the external browser after inactivity
- add a browser runtime diagnostics panel for CDP version, process ID, profile path, and active targets
- add a guided command generator for users who want to launch their own debug browser
- support remote browser endpoints beyond loopback only after a security review
- keep an Electron build as a legacy fallback if Tauri has unacceptable platform gaps

## Explicit Non-Goals For Now

- rewriting the TypeScript backend in Rust
- rewriting the React web UI
- silently attaching to the user's everyday active browser
- bundling a dedicated Chromium binary as the default browser automation path
