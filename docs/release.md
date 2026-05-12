# Release Checklist

This document covers how to run unsigned Tauri desktop releases from one tag.

## What the workflow does

- Trigger: push tag matching `v*.*.*`.
- Runs quality gates first: lint, typecheck, test.
- Builds four artifacts in parallel:
  - macOS `arm64` DMG
  - macOS `x64` DMG
  - Linux `x64` AppImage
  - Windows `x64` NSIS installer
- Publishes one GitHub Release with all produced files.
  - Versions with a suffix after `X.Y.Z` (for example `1.2.3-alpha.1`) are published as GitHub prereleases.
  - Only plain `X.Y.Z` releases are marked as the repository's latest release.
- Publishes the Tauri desktop installers produced by the platform build matrix.
- Publishes the CLI package (`apps/server`, npm package `t3`) with OIDC trusted publishing.
- Signing and auto-update metadata are Tauri follow-ups; the current workflow builds unsigned installers.

## Desktop release notes

- Runtime shell: Tauri in `apps/desktop-tauri`.
- The old Electron build path is deprecated and should not be used for install, dev, or release builds.
- `make install` builds and installs the Tauri app bundle for the current platform.
- Updater behavior is still a Tauri follow-up; release validation should focus on installability and startup.

## 0) npm OIDC trusted publishing setup (CLI)

The workflow publishes the CLI with `bun publish` from `apps/server` after bumping
the package version to the release tag version.

Checklist:

1. Confirm npm org/user owns package `t3` (or rename package first if needed).
2. In npm package settings, configure Trusted Publisher:
   - Provider: GitHub Actions
   - Repository: this repo
   - Workflow file: `.github/workflows/release.yml`
   - Environment (if used): match your npm trusted publishing config
3. Ensure npm account and org policies allow trusted publishing for the package.
4. Create release tag `vX.Y.Z` and push; workflow will:
   - set `apps/server/package.json` version to `X.Y.Z`
   - build web + server
   - run `bun publish --access public`

## BroCode notes

- `BroCode` keeps the same release architecture as upstream `T3Code`, but publishes desktop artifacts under the DP branding.
- The GitHub Release should include the generated Tauri installers.
- The published release title should read `BroCode vX.Y.Z`.
- By default, the first-party desktop release path does not require CLI publish or post-release version-bump automation.
- Optional jobs stay disabled unless repository variables enable them:
  - `BROCODE_PUBLISH_CLI=1`
  - `BROCODE_FINALIZE_RELEASE=1`

## 1) Dry-run release

Use this first to validate the release pipeline.

1. Confirm no signing secrets are required for this test.
2. Create a test tag:
   - `git tag v0.0.0-test.1`
   - `git push origin v0.0.0-test.1`
3. Wait for `.github/workflows/release.yml` to finish.
4. Verify the GitHub Release contains all platform artifacts.
5. Download each artifact and sanity-check installation on each OS.

## 2) Tauri signing follow-up

Before publishing stable desktop builds, wire Tauri-native signing and notarization for macOS and Windows. Do not reuse the removed Electron signing path; the old secrets may be useful inputs, but the build commands and verification steps need to be Tauri-specific.

## 3) Ongoing release checklist

1. Ensure `main` is green in CI.
2. Bump app version as needed.
3. Create release tag: `vX.Y.Z`.
4. Push tag.
5. Verify workflow steps:
   - preflight passes
   - all matrix builds pass
   - release job uploads expected files
6. Smoke test downloaded artifacts.

## 4) Troubleshooting

- Desktop release uploads no artifacts:
  - Check the matrix target and the collected bundle directory in `.github/workflows/release.yml`.
- Linux AppImage build fails:
  - Re-check the WebKit/GTK/AppIndicator packages in the release workflow.
- macOS or Windows signing is needed:
  - Implement and verify Tauri-native signing before removing `--no-sign`.
