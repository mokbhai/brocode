import { invoke } from "@tauri-apps/api/core";
import type {
  BrowserAttachWebviewInput,
  BrowserCaptureScreenshotResult,
  BrowserExecuteCdpInput,
  BrowserNavigateInput,
  BrowserNewTabInput,
  BrowserOpenInput,
  BrowserSetPanelBoundsInput,
  BrowserTabInput,
  BrowserThreadInput,
  DesktopBridge,
  DesktopTheme,
  DesktopUpdateActionResult,
  DesktopUpdateState,
  ThreadBrowserState,
  ThreadId,
} from "@t3tools/contracts";

const WS_URL_ATTEMPTS = 160;
const WS_URL_RETRY_DELAY_MS = 200;
const UNSUPPORTED_BROWSER_MESSAGE =
  "Tauri desktop browser automation is not implemented in Phase 1.";

let cachedWsUrl: string | null = null;
let wsUrlResolutionStarted = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readWsUrl(): Promise<string | null> {
  return invoke<string | null>("get_ws_url");
}

async function waitForWsUrl(): Promise<string | null> {
  for (let attempt = 0; attempt < WS_URL_ATTEMPTS; attempt += 1) {
    try {
      const wsUrl = await readWsUrl();
      if (wsUrl) return wsUrl;
    } catch {
      // The bridge is intentionally non-blocking; keep polling within the bounded window.
    }

    if (attempt < WS_URL_ATTEMPTS - 1) {
      await sleep(WS_URL_RETRY_DELAY_MS);
    }
  }

  return null;
}

function startWsUrlResolution(): void {
  if (wsUrlResolutionStarted) return;
  wsUrlResolutionStarted = true;

  void waitForWsUrl().then((wsUrl) => {
    cachedWsUrl = wsUrl;
  });
}

function unsupportedBrowserError(): Error {
  return new Error(UNSUPPORTED_BROWSER_MESSAGE);
}

function emptyBrowserState(threadId: ThreadId): ThreadBrowserState {
  return {
    threadId,
    version: 0,
    open: false,
    activeTabId: null,
    tabs: [],
    lastError: UNSUPPORTED_BROWSER_MESSAGE,
  };
}

function disabledUpdateState(): DesktopUpdateState {
  return {
    enabled: false,
    status: "disabled",
    currentVersion: import.meta.env.APP_VERSION || "0.0.0",
    hostArch: "other",
    appArch: "other",
    runningUnderArm64Translation: false,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: "Desktop updates are not implemented in the Tauri Phase 1 shell.",
    errorContext: null,
    canRetry: false,
  };
}

function disabledUpdateActionResult(): DesktopUpdateActionResult {
  return {
    accepted: false,
    completed: false,
    state: disabledUpdateState(),
  };
}

function createDesktopBridge(): DesktopBridge {
  return {
    getWsUrl: () => cachedWsUrl,
    pickFolder: () => invoke<string | null>("pick_folder"),
    saveFile: (input) =>
      invoke<string | null>("save_file", {
        defaultFilename: input.defaultFilename,
        contents: input.contents,
        filters: input.filters,
      }),
    confirm: (message) => invoke<boolean>("confirm", { message }),
    setTheme: async (_theme: DesktopTheme) => {},
    showContextMenu: async () => null,
    openExternal: (url) => invoke<boolean>("open_external", { url }),
    showInFolder: (path) => invoke<void>("show_in_folder", { path }),
    closeWindow: () => invoke<void>("close_window"),
    shell: {
      showInFolder: (path) => invoke<void>("show_in_folder", { path }),
    },
    onMenuAction: () => () => {},
    getUpdateState: async () => disabledUpdateState(),
    checkForUpdates: async () => disabledUpdateState(),
    downloadUpdate: async () => disabledUpdateActionResult(),
    installUpdate: async () => disabledUpdateActionResult(),
    onUpdateState: () => () => {},
    notifications: {
      isSupported: () => invoke<boolean>("notifications_is_supported"),
      show: (input) => invoke<boolean>("notifications_show", { input }),
    },
    browser: {
      open: async (input: BrowserOpenInput) => emptyBrowserState(input.threadId),
      close: async (input: BrowserThreadInput) => emptyBrowserState(input.threadId),
      hide: async () => {},
      getState: async (input: BrowserThreadInput) => emptyBrowserState(input.threadId),
      setPanelBounds: async (_input: BrowserSetPanelBoundsInput) => {},
      attachWebview: async (input: BrowserAttachWebviewInput) => emptyBrowserState(input.threadId),
      copyScreenshotToClipboard: async (_input: BrowserTabInput) => {
        throw unsupportedBrowserError();
      },
      captureScreenshot: async (
        _input: BrowserTabInput,
      ): Promise<BrowserCaptureScreenshotResult> => {
        throw unsupportedBrowserError();
      },
      executeCdp: async (_input: BrowserExecuteCdpInput): Promise<unknown> => {
        throw unsupportedBrowserError();
      },
      navigate: async (input: BrowserNavigateInput) => emptyBrowserState(input.threadId),
      reload: async (input: BrowserTabInput) => emptyBrowserState(input.threadId),
      goBack: async (input: BrowserTabInput) => emptyBrowserState(input.threadId),
      goForward: async (input: BrowserTabInput) => emptyBrowserState(input.threadId),
      newTab: async (input: BrowserNewTabInput) => emptyBrowserState(input.threadId),
      closeTab: async (input: BrowserTabInput) => emptyBrowserState(input.threadId),
      selectTab: async (input: BrowserTabInput) => emptyBrowserState(input.threadId),
      openDevTools: async (_input: BrowserTabInput) => {
        throw unsupportedBrowserError();
      },
      onState: () => () => {},
      onBrowserUseOpenPanelRequest: () => () => {},
    },
  };
}

export function installDesktopBridge(): void {
  window.desktopBridge = createDesktopBridge();
  startWsUrlResolution();
}
