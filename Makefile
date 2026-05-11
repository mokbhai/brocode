SHELL := /bin/sh

.DEFAULT_GOAL := help

BROCODE_HOME ?= ./.brocode-tauri-dev
BROCODE_PORT ?= 58090
BROCODE_PORT_OFFSET ?= 3158
BROCODE_RELEASE_DIR ?= release
BROCODE_APP_DIR ?= /Applications
BROCODE_BIN_DIR ?= $(HOME)/.local/bin
UNAME_M := $(shell uname -m 2>/dev/null || printf unknown)
BROCODE_DESKTOP_ARCH ?= $(shell if [ "$(UNAME_M)" = arm64 ] || [ "$(UNAME_M)" = aarch64 ]; then printf arm64; elif [ "$(UNAME_M)" = x86_64 ] || [ "$(UNAME_M)" = amd64 ]; then printf x64; else printf '%s' "$(UNAME_M)"; fi)
BROCODE_BUILD_ARGS ?=
BROCODE_WINDOWS_INSTALLER_ARGS ?=

.PHONY: help deps install install-macos install-linux install-windows desktop start start-desktop start-desktop-tauri desktop-dry-run start-desktop-electron clean

help:
	@printf '%s\n' 'BroCode desktop targets:'
	@printf '%s\n' '  make deps                    Install workspace dependencies'
	@printf '%s\n' '  make install                 Build and install the desktop app for this OS'
	@printf '%s\n' '  make install-macos           Build a macOS DMG and copy BroCode to /Applications'
	@printf '%s\n' '  make install-linux           Build an AppImage and install it as brocode'
	@printf '%s\n' '  make install-windows         Build and run the Windows installer'
	@printf '%s\n' '  make start                   Dry-run, then start the Tauri desktop app'
	@printf '%s\n' '  make desktop-dry-run         Show resolved desktop ports/env without starting'
	@printf '%s\n' '  make start-desktop-electron  Start the legacy Electron desktop app'
	@printf '%s\n' ''
	@printf '%s\n' 'Overrides:'
	@printf '%s\n' '  BROCODE_HOME=... BROCODE_PORT=... BROCODE_PORT_OFFSET=...'
	@printf '%s\n' '  BROCODE_RELEASE_DIR=... BROCODE_APP_DIR=... BROCODE_BIN_DIR=...'
	@printf '%s\n' '  BROCODE_DESKTOP_ARCH=arm64|x64|universal BROCODE_BUILD_ARGS=...'

deps:
	bun install

install:
	@case "$$(uname -s 2>/dev/null || printf unknown)" in \
		Darwin) $(MAKE) --no-print-directory install-macos ;; \
		Linux) $(MAKE) --no-print-directory install-linux ;; \
		MINGW*|MSYS*|CYGWIN*) $(MAKE) --no-print-directory install-windows ;; \
		*) printf '%s\n' "Unsupported OS for desktop install: $$(uname -s 2>/dev/null || printf unknown)"; exit 1 ;; \
	esac

install-macos:
	bun run dist:desktop:artifact -- --platform mac --target dmg --arch $(BROCODE_DESKTOP_ARCH) --output-dir $(BROCODE_RELEASE_DIR) $(BROCODE_BUILD_ARGS)
	@dmg=$$(ls -t "$(BROCODE_RELEASE_DIR)"/BroCode-*-"$(BROCODE_DESKTOP_ARCH)".dmg 2>/dev/null | head -n 1); \
	if [ -z "$$dmg" ]; then \
		printf '%s\n' "Could not find a macOS DMG in $(BROCODE_RELEASE_DIR) for arch $(BROCODE_DESKTOP_ARCH)."; \
		exit 1; \
	fi; \
	mount_dir=$$(mktemp -d "$${TMPDIR:-/tmp}/brocode-dmg.XXXXXX"); \
	cleanup() { hdiutil detach "$$mount_dir" >/dev/null 2>&1 || true; rmdir "$$mount_dir" >/dev/null 2>&1 || true; }; \
	trap cleanup EXIT INT TERM; \
	hdiutil attach "$$dmg" -nobrowse -readonly -mountpoint "$$mount_dir" >/dev/null; \
	app=$$(find "$$mount_dir" -maxdepth 2 -type d -name '*.app' -print | head -n 1); \
	if [ -z "$$app" ]; then \
		printf '%s\n' "Mounted $$dmg, but no .app bundle was found."; \
		exit 1; \
	fi; \
	mkdir -p "$(BROCODE_APP_DIR)"; \
	dest="$(BROCODE_APP_DIR)/$$(basename "$$app")"; \
	tmp_dest="$(BROCODE_APP_DIR)/.$$(basename "$$app").tmp.$$$$"; \
	rm -rf "$$tmp_dest"; \
	ditto "$$app" "$$tmp_dest"; \
	rm -rf "$$dest"; \
	mv "$$tmp_dest" "$$dest"; \
	printf '%s\n' "Installed $$dest"

install-linux:
	bun run dist:desktop:artifact -- --platform linux --target AppImage --arch $(BROCODE_DESKTOP_ARCH) --output-dir $(BROCODE_RELEASE_DIR) $(BROCODE_BUILD_ARGS)
	@artifact=$$(ls -t "$(BROCODE_RELEASE_DIR)"/BroCode-*-"$(BROCODE_DESKTOP_ARCH)".AppImage 2>/dev/null | head -n 1); \
	if [ -z "$$artifact" ]; then \
		printf '%s\n' "Could not find a Linux AppImage in $(BROCODE_RELEASE_DIR) for arch $(BROCODE_DESKTOP_ARCH)."; \
		exit 1; \
	fi; \
	mkdir -p "$(BROCODE_BIN_DIR)"; \
	tmp_bin="$(BROCODE_BIN_DIR)/.brocode.tmp.$$$$"; \
	rm -f "$$tmp_bin"; \
	cp "$$artifact" "$$tmp_bin"; \
	chmod 755 "$$tmp_bin"; \
	mv "$$tmp_bin" "$(BROCODE_BIN_DIR)/brocode"; \
	printf '%s\n' "Installed $(BROCODE_BIN_DIR)/brocode"; \
	printf '%s\n' "Make sure $(BROCODE_BIN_DIR) is on PATH."

install-windows:
	bun run dist:desktop:artifact -- --platform win --target nsis --arch $(BROCODE_DESKTOP_ARCH) --output-dir $(BROCODE_RELEASE_DIR) $(BROCODE_BUILD_ARGS)
	@installer=$$(ls -t "$(BROCODE_RELEASE_DIR)"/BroCode-*-"$(BROCODE_DESKTOP_ARCH)".exe 2>/dev/null | head -n 1); \
	if [ -z "$$installer" ]; then \
		printf '%s\n' "Could not find a Windows installer in $(BROCODE_RELEASE_DIR) for arch $(BROCODE_DESKTOP_ARCH)."; \
		exit 1; \
	fi; \
	case "$$(uname -s 2>/dev/null || printf unknown)" in \
		MINGW*|MSYS*|CYGWIN*) \
			if command -v powershell.exe >/dev/null 2>&1; then \
				win_installer=$$(cygpath -w "$$installer" 2>/dev/null || printf '%s' "$$installer"); \
				powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -Wait -FilePath '$$win_installer'"; \
			else \
				"$$installer" $(BROCODE_WINDOWS_INSTALLER_ARGS); \
			fi ;; \
		*) \
			printf '%s\n' "Built Windows installer at $$installer"; \
			printf '%s\n' "Run it on Windows to install BroCode." ;; \
	esac

desktop: start-desktop

start: start-desktop

start-desktop: desktop-dry-run
	env -u T3CODE_AUTH_TOKEN T3CODE_PORT_OFFSET=$(BROCODE_PORT_OFFSET) bun run dev:desktop-tauri -- --home-dir $(BROCODE_HOME) --port $(BROCODE_PORT)

start-desktop-tauri: start-desktop

desktop-dry-run:
	env -u T3CODE_AUTH_TOKEN T3CODE_PORT_OFFSET=$(BROCODE_PORT_OFFSET) bun run dev:desktop-tauri -- --home-dir $(BROCODE_HOME) --port $(BROCODE_PORT) --dry-run

start-desktop-electron:
	bun run electron:dev

clean:
	bun run clean
