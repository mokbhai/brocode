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
const BROWSER_EVENT_POLL_MS = 750;
const BROWSER_STATE_POLL_MS = 1_000;

let cachedWsUrl: string | null = null;
const browserStateListeners = new Set<(state: ThreadBrowserState) => void>();
const browserPanelRequestListeners = new Set<() => void>();
const observedBrowserThreadIds = new Set<ThreadId>();
let browserStatePollId: number | null = null;
let browserEventPollId: number | null = null;
let lastOpenPanelRequestSequence: number | null = null;

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

function httpBaseUrlFromWsUrl(wsUrl: string | null): string | null {
  if (!wsUrl) return null;
  try {
    const url = new URL(wsUrl);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function requireBrowserHttpBaseUrl(): string {
  const baseUrl = httpBaseUrlFromWsUrl(cachedWsUrl);
  if (!baseUrl) {
    throw new Error("BroCode backend is not ready for browser automation.");
  }
  return baseUrl;
}

function base64ToUint8Array(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function browserRequest<T>(action: string, input: unknown = {}): Promise<T> {
  const response = await window.fetch(`${requireBrowserHttpBaseUrl()}/api/browser/${action}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Browser automation failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function emitBrowserState(state: ThreadBrowserState): ThreadBrowserState {
  observedBrowserThreadIds.add(state.threadId);
  for (const listener of browserStateListeners) {
    listener(state);
  }
  return state;
}

async function browserStateRequest(
  action: string,
  input: BrowserThreadInput | BrowserTabInput | BrowserOpenInput | BrowserNavigateInput | BrowserNewTabInput,
): Promise<ThreadBrowserState> {
  const state = await browserRequest<ThreadBrowserState>(action, input);
  return emitBrowserState(state);
}

function startBrowserStatePolling(): void {
  if (browserStatePollId !== null || browserStateListeners.size === 0) return;
  browserStatePollId = window.setInterval(() => {
    for (const threadId of observedBrowserThreadIds) {
      void browserRequest<ThreadBrowserState>("getState", { threadId })
        .then(emitBrowserState)
        .catch(() => undefined);
    }
  }, BROWSER_STATE_POLL_MS);
}

function stopBrowserStatePollingIfIdle(): void {
  if (browserStateListeners.size > 0 || browserStatePollId === null) return;
  window.clearInterval(browserStatePollId);
  browserStatePollId = null;
}

function startBrowserEventPolling(): void {
  if (browserEventPollId !== null || browserPanelRequestListeners.size === 0) return;
  browserEventPollId = window.setInterval(() => {
    void browserRequest<{ openPanelRequestSequence: number }>("events")
      .then((eventState) => {
        if (lastOpenPanelRequestSequence === null) {
          lastOpenPanelRequestSequence = eventState.openPanelRequestSequence;
          return;
        }
        if (eventState.openPanelRequestSequence <= lastOpenPanelRequestSequence) return;
        lastOpenPanelRequestSequence = eventState.openPanelRequestSequence;
        for (const listener of browserPanelRequestListeners) {
          listener();
        }
      })
      .catch(() => undefined);
  }, BROWSER_EVENT_POLL_MS);
}

function stopBrowserEventPollingIfIdle(): void {
  if (browserPanelRequestListeners.size > 0 || browserEventPollId === null) return;
  window.clearInterval(browserEventPollId);
  browserEventPollId = null;
  lastOpenPanelRequestSequence = null;
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
    power: {
      setPreventSleep: async () => false,
    },
    browser: {
      open: (input: BrowserOpenInput) => browserStateRequest("open", input),
      close: async (input: BrowserThreadInput) => {
        const state = await browserStateRequest("close", input);
        observedBrowserThreadIds.delete(input.threadId);
        return state;
      },
      hide: async (input: BrowserThreadInput) => {
        await browserRequest("hide", input);
      },
      getState: (input: BrowserThreadInput) => browserStateRequest("getState", input),
      setPanelBounds: async (input: BrowserSetPanelBoundsInput) => {
        await browserRequest("setPanelBounds", input);
      },
      attachWebview: (input: BrowserAttachWebviewInput) => browserStateRequest("attachWebview", input),
      copyScreenshotToClipboard: async (input: BrowserTabInput) => {
        const result = await browserRequest<
          Omit<BrowserCaptureScreenshotResult, "bytes"> & { bytesBase64: string }
        >("captureScreenshot", input);
        const screenshot = {
          name: result.name,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          bytes: base64ToUint8Array(result.bytesBase64),
        } satisfies BrowserCaptureScreenshotResult;
        const clipboard = window.navigator.clipboard;
        if (!clipboard || typeof ClipboardItem === "undefined") {
          throw new Error("Image clipboard writes are unavailable in this desktop webview.");
        }
        await clipboard.write([
          new ClipboardItem({
            [screenshot.mimeType]: new Blob([screenshot.bytes], { type: screenshot.mimeType }),
          }),
        ]);
      },
      captureScreenshot: async (input: BrowserTabInput): Promise<BrowserCaptureScreenshotResult> => {
        const result = await browserRequest<
          Omit<BrowserCaptureScreenshotResult, "bytes"> & { bytesBase64: string }
        >("captureScreenshot", input);
        return {
          name: result.name,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          bytes: base64ToUint8Array(result.bytesBase64),
        };
      },
      executeCdp: (input: BrowserExecuteCdpInput): Promise<unknown> =>
        browserRequest("executeCdp", input),
      navigate: (input: BrowserNavigateInput) => browserStateRequest("navigate", input),
      reload: (input: BrowserTabInput) => browserStateRequest("reload", input),
      goBack: (input: BrowserTabInput) => browserStateRequest("goBack", input),
      goForward: (input: BrowserTabInput) => browserStateRequest("goForward", input),
      newTab: (input: BrowserNewTabInput) => browserStateRequest("newTab", input),
      closeTab: (input: BrowserTabInput) => browserStateRequest("closeTab", input),
      selectTab: (input: BrowserTabInput) => browserStateRequest("selectTab", input),
      openDevTools: async (input: BrowserTabInput) => {
        await browserRequest("openDevTools", input);
      },
      onState: (listener) => {
        browserStateListeners.add(listener);
        startBrowserStatePolling();
        return () => {
          browserStateListeners.delete(listener);
          stopBrowserStatePollingIfIdle();
        };
      },
      onBrowserUseOpenPanelRequest: (listener) => {
        browserPanelRequestListeners.add(listener);
        startBrowserEventPolling();
        return () => {
          browserPanelRequestListeners.delete(listener);
          stopBrowserEventPollingIfIdle();
        };
      },
    },
  };
}

export async function installDesktopBridge(): Promise<void> {
  cachedWsUrl = null;
  window.__BROCODE_DESKTOP_RUNTIME = "tauri";
  window.desktopBridge = createDesktopBridge();
  cachedWsUrl = await waitForWsUrl();
}
