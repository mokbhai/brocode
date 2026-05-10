# BroCode

BroCode is a minimal web GUI for coding agents (currently Claude Code, Codex, Gemini, OpenCode, more coming soon).

BroCode is a fork of DP Code, which itself began as a fork of [T3Code](https://github.com/pingdotgg/t3code). This lineage gave the project a strong starting point, but BroCode is now being developed as its own product with separate branding, packaging, release wiring, desktop runtime work, and product-level behavior.

Key enhancements include a Rust-based desktop engine and a much lighter memory profile. In our current testing, the desktop shell dropped from roughly 600+ MB in the previous Electron-based runtime to about 60 MB with the Rust/Tauri direction, a ~10x reduction intended to make the app smoother on low-end machines.

Current desktop testing has been performed on macOS Tahoe, version 26.4.1.

![BroCode screenshot](./assets/prod/readme-screenshot.png)

## How to use

> [!WARNING]
> You need to have [Codex CLI](https://github.com/openai/codex) installed and authorized for BroCode to work.

You can also just install the desktop app. It's cooler.

Install the [desktop app from the Releases page](https://github.com/Emanuele-web04/brocode/releases)

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

## If you REALLY want to contribute still.... read this first

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
