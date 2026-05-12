import { Buffer } from "node:buffer";
import { spawn, type ChildProcess } from "node:child_process";
import * as FS from "node:fs";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";

import WebSocket from "ws";
import type {
  BrowserCaptureScreenshotResult,
  BrowserExecuteCdpInput,
  BrowserNavigateInput,
  BrowserNewTabInput,
  BrowserOpenInput,
  BrowserTabInput,
  BrowserTabState,
  BrowserThreadInput,
  ThreadBrowserState,
  ThreadId,
} from "@t3tools/contracts";

const ABOUT_BLANK_URL = "about:blank";
const SEARCH_URL_PREFIX = "https://www.google.com/search?q=";
const DEFAULT_REMOTE_DEBUGGING_PORT = 9222;
const BROWSER_LAUNCH_READY_TIMEOUT_MS = 10_000;
const BROWSER_LAUNCH_READY_POLL_MS = 150;
const BROWSER_USE_HEADER_BYTES = 4;
const BROWSER_USE_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const BROCODE_BROWSER_USE_PIPE_ENV = "BROCODE_BROWSER_USE_PIPE_PATH";
const DPCODE_BROWSER_USE_PIPE_ENV = "DPCODE_BROWSER_USE_PIPE_PATH";
const T3CODE_BROWSER_USE_PIPE_ENV = "T3CODE_BROWSER_USE_PIPE_PATH";

export interface ChromiumExecutable {
  kind: "chrome" | "edge" | "chromium" | "custom";
  name: string;
  path: string;
}

interface ResolveChromiumExecutableInput {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  pathExists?: (path: string) => boolean;
  pathLookup?: (name: string) => string | null;
}

interface BuildChromiumLaunchArgsInput {
  port: number;
  userDataDir: string;
}

interface CdpTarget {
  id: string;
  type: string;
  title?: string;
  url?: string;
  faviconUrl?: string;
  webSocketDebuggerUrl?: string;
}

interface BrowserRuntimeConfig {
  baseDir: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

type BrowserStateListener = (state: ThreadBrowserState) => void;
type BrowserUseRpcId = string | number;

interface BrowserUseRpcRequest {
  id?: BrowserUseRpcId;
  method?: string;
  params?: unknown;
}

interface BrowserUseTrackedTab {
  id: number;
  threadId: ThreadId;
  tabId: string;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requireStringField(input: unknown, field: string): string {
  const value = asString(asObject(input)?.[field]);
  if (!value) {
    throw new Error(`Missing required browser ${field}.`);
  }
  return value;
}

function requireThreadId(input: unknown): ThreadId {
  return requireStringField(input, "threadId") as ThreadId;
}

function requireTabId(input: unknown): string {
  return requireStringField(input, "tabId");
}

function requireSessionId(params: unknown): string {
  const sessionId = asString(asObject(params)?.session_id);
  if (!sessionId) {
    throw new Error("Missing required browser session_id");
  }
  return sessionId;
}

function cloneThreadState(state: ThreadBrowserState): ThreadBrowserState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => ({ ...tab })),
  };
}

function defaultTitleForUrl(url: string): string {
  if (url === ABOUT_BLANK_URL) return "New tab";
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function screenshotFileNameForUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.trim().toLowerCase();
    const slug = hostname.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `${slug || "browser"}-${Date.now()}.png`;
  } catch {
    return `browser-${Date.now()}.png`;
  }
}

function looksLikeUrlInput(value: string): boolean {
  return (
    value.includes(".") ||
    value.startsWith("localhost") ||
    value.startsWith("127.0.0.1") ||
    value.startsWith("0.0.0.0") ||
    value.startsWith("[::1]")
  );
}

function normalizeUrlInput(input: string | undefined): string {
  const trimmed = input?.trim() ?? "";
  if (trimmed.length === 0) return ABOUT_BLANK_URL;

  try {
    const withScheme = new URL(trimmed);
    if (
      withScheme.protocol === "http:" ||
      withScheme.protocol === "https:" ||
      withScheme.protocol === "about:"
    ) {
      return withScheme.toString();
    }
  } catch {
    // Fall through to browser-like heuristics.
  }

  if (trimmed.includes(" ")) {
    return `${SEARCH_URL_PREFIX}${encodeURIComponent(trimmed)}`;
  }

  if (looksLikeUrlInput(trimmed)) {
    const scheme =
      trimmed.startsWith("localhost") ||
      trimmed.startsWith("127.0.0.1") ||
      trimmed.startsWith("0.0.0.0") ||
      trimmed.startsWith("[::1]")
        ? "http"
        : "https";
    try {
      return new URL(`${scheme}://${trimmed}`).toString();
    } catch {
      return `${SEARCH_URL_PREFIX}${encodeURIComponent(trimmed)}`;
    }
  }

  return `${SEARCH_URL_PREFIX}${encodeURIComponent(trimmed)}`;
}

function defaultBrowserState(threadId: ThreadId): ThreadBrowserState {
  return {
    threadId,
    version: 0,
    open: false,
    activeTabId: null,
    tabs: [],
    lastError: null,
  };
}

function lookupExecutable(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const pathEnv = env.PATH ?? "";
  for (const dir of pathEnv.split(Path.delimiter)) {
    if (!dir) continue;
    const candidate = Path.join(dir, name);
    if (FS.existsSync(candidate)) return candidate;
    if (process.platform === "win32" && FS.existsSync(`${candidate}.exe`)) {
      return `${candidate}.exe`;
    }
  }
  return null;
}

export function resolveChromiumExecutable(
  input: ResolveChromiumExecutableInput = {},
): ChromiumExecutable | null {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const pathExists = input.pathExists ?? ((path: string) => FS.existsSync(path));
  const pathLookup = input.pathLookup ?? ((name: string) => lookupExecutable(name, env));
  const custom =
    env.BROCODE_BROWSER_EXECUTABLE?.trim() ||
    env.DPCODE_BROWSER_EXECUTABLE?.trim() ||
    env.T3CODE_BROWSER_EXECUTABLE?.trim();
  if (custom) {
    return { kind: "custom", name: "Custom Chromium", path: custom };
  }

  const home = OS.homedir();
  const candidates =
    platform === "darwin"
      ? [
          {
            kind: "chrome" as const,
            name: "Google Chrome",
            path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          },
          {
            kind: "chrome" as const,
            name: "Google Chrome",
            path: Path.join(
              home,
              "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            ),
          },
          {
            kind: "edge" as const,
            name: "Microsoft Edge",
            path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          },
          {
            kind: "chromium" as const,
            name: "Chromium",
            path: "/Applications/Chromium.app/Contents/MacOS/Chromium",
          },
        ]
      : platform === "win32"
        ? [
            {
              kind: "chrome" as const,
              name: "Google Chrome",
              path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            },
            {
              kind: "edge" as const,
              name: "Microsoft Edge",
              path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
            },
            {
              kind: "chromium" as const,
              name: "Chromium",
              path: "C:\\Program Files\\Chromium\\Application\\chrome.exe",
            },
          ]
        : [];

  for (const candidate of candidates) {
    if (pathExists(candidate.path)) return candidate;
  }

  for (const candidate of [
    { kind: "chrome" as const, name: "Google Chrome", command: "google-chrome" },
    { kind: "chrome" as const, name: "Google Chrome", command: "google-chrome-stable" },
    { kind: "edge" as const, name: "Microsoft Edge", command: "microsoft-edge" },
    { kind: "chromium" as const, name: "Chromium", command: "chromium" },
    { kind: "chromium" as const, name: "Chromium", command: "chromium-browser" },
  ]) {
    const path = pathLookup(candidate.command);
    if (path) return { kind: candidate.kind, name: candidate.name, path };
  }

  return null;
}

export function buildChromiumLaunchArgs(input: BuildChromiumLaunchArgsInput): string[] {
  return [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${input.port}`,
    `--user-data-dir=${input.userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    ABOUT_BLANK_URL,
  ];
}

export function resolveDefaultBrowserUsePipePath(
  baseDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return String.raw`\\.\pipe\brocode-browser-use`;
  }
  return Path.join(baseDir, "browser-use.sock");
}

export function resolveConfiguredBrowserUsePipePath(
  baseDir: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return (
    env[BROCODE_BROWSER_USE_PIPE_ENV]?.trim() ||
    env[DPCODE_BROWSER_USE_PIPE_ENV]?.trim() ||
    env[T3CODE_BROWSER_USE_PIPE_ENV]?.trim() ||
    resolveDefaultBrowserUsePipePath(baseDir, platform)
  );
}

async function findAvailablePort(startPort = DEFAULT_REMOTE_DEBUGGING_PORT): Promise<number> {
  for (let offset = 0; offset < 200; offset += 1) {
    const port = startPort + offset;
    const available = await new Promise<boolean>((resolve) => {
      const server = Net.createServer();
      server.once("error", () => resolve(false));
      server.listen({ host: "127.0.0.1", port }, () => {
        server.close(() => resolve(true));
      });
    });
    if (available) return port;
  }
  throw new Error("No available Chrome remote debugging port found.");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Browser runtime request failed with status ${response.status}.`);
  }
  return (await response.json()) as T;
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Browser runtime request failed with status ${response.status}.`);
  }
  return response.text();
}

class ExternalBrowserManager {
  private config: BrowserRuntimeConfig = {
    baseDir: Path.join(OS.homedir(), ".brocode"),
  };
  private child: ChildProcess | null = null;
  private endpoint: string | null = null;
  private launchPromise: Promise<string> | null = null;
  private readonly states = new Map<ThreadId, ThreadBrowserState>();
  private readonly listeners = new Set<BrowserStateListener>();
  private readonly refreshTimers = new Map<ThreadId, ReturnType<typeof setTimeout>>();
  private activeThreadId: ThreadId | null = null;
  private openPanelRequestSequence = 0;

  configure(config: BrowserRuntimeConfig): void {
    this.config = config;
  }

  subscribe(listener: BrowserStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getOpenPanelRequestSequence(): number {
    return this.openPanelRequestSequence;
  }

  requestOpenPanel(): void {
    this.openPanelRequestSequence += 1;
  }

  getOpenStates(): ThreadBrowserState[] {
    return Array.from(this.states.values())
      .filter((state) => state.open)
      .map(cloneThreadState);
  }

  getBrowserUseSnapshot(): { threadId: ThreadId; state: ThreadBrowserState } | null {
    if (this.activeThreadId) {
      const state = this.states.get(this.activeThreadId);
      if (state?.open) {
        return { threadId: this.activeThreadId, state: cloneThreadState(state) };
      }
    }

    for (const [threadId, state] of this.states) {
      if (state.open) return { threadId, state: cloneThreadState(state) };
    }
    return null;
  }

  async dispose(): Promise<void> {
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
    this.states.clear();
    this.listeners.clear();
    this.endpoint = null;
    this.launchPromise = null;
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
  }

  async open(input: BrowserOpenInput): Promise<ThreadBrowserState> {
    const endpoint = await this.ensureBrowser();
    const state = this.getOrCreateState(input.threadId);
    state.open = true;
    this.activeThreadId = input.threadId;
    if (state.tabs.length === 0) {
      const target = await this.createTarget(normalizeUrlInput(input.initialUrl), endpoint);
      state.tabs = [this.tabFromTarget(target)];
      state.activeTabId = target.id;
    }
    await this.refreshThreadState(input.threadId);
    this.emit(input.threadId);
    return this.getState({ threadId: input.threadId });
  }

  async close(input: BrowserThreadInput): Promise<ThreadBrowserState> {
    const state = this.getOrCreateState(input.threadId);
    for (const tab of state.tabs) {
      await this.closeTarget(tab.id).catch(() => undefined);
    }
    state.open = false;
    state.activeTabId = null;
    state.tabs = [];
    state.lastError = null;
    this.markChanged(state);
    if (this.activeThreadId === input.threadId) {
      this.activeThreadId = null;
    }
    this.emit(input.threadId);
    return cloneThreadState(state);
  }

  hide(_input: BrowserThreadInput): void {
    // The external browser remains visible; the BroCode panel is just a controller.
  }

  async getState(input: BrowserThreadInput): Promise<ThreadBrowserState> {
    const state = this.getOrCreateState(input.threadId);
    if (state.open) {
      await this.refreshThreadState(input.threadId).catch((error) => {
        state.lastError = error instanceof Error ? error.message : String(error);
        this.markChanged(state);
      });
    }
    return cloneThreadState(state);
  }

  async navigate(input: BrowserNavigateInput): Promise<ThreadBrowserState> {
    await this.ensureBrowser();
    const state = this.getOrCreateState(input.threadId);
    const tab = this.resolveTab(state, input.tabId);
    const url = normalizeUrlInput(input.url);
    await this.executeCdp({ threadId: input.threadId, tabId: tab.id, method: "Page.navigate", params: { url } });
    tab.url = url;
    tab.title = defaultTitleForUrl(url);
    tab.isLoading = true;
    tab.lastError = null;
    state.activeTabId = tab.id;
    this.markChanged(state);
    this.emit(input.threadId);
    this.scheduleRefresh(input.threadId);
    return cloneThreadState(state);
  }

  async reload(input: BrowserTabInput): Promise<ThreadBrowserState> {
    await this.executeCdp({ ...input, method: "Page.reload" });
    this.scheduleRefresh(input.threadId);
    return this.getState({ threadId: input.threadId });
  }

  async goBack(input: BrowserTabInput): Promise<ThreadBrowserState> {
    await this.executeCdp({ ...input, method: "Page.navigateToHistoryEntry", params: await this.resolveHistoryEntry(input, -1) });
    this.scheduleRefresh(input.threadId);
    return this.getState({ threadId: input.threadId });
  }

  async goForward(input: BrowserTabInput): Promise<ThreadBrowserState> {
    await this.executeCdp({ ...input, method: "Page.navigateToHistoryEntry", params: await this.resolveHistoryEntry(input, 1) });
    this.scheduleRefresh(input.threadId);
    return this.getState({ threadId: input.threadId });
  }

  async newTab(input: BrowserNewTabInput): Promise<ThreadBrowserState> {
    const endpoint = await this.ensureBrowser();
    const state = this.getOrCreateState(input.threadId);
    const target = await this.createTarget(normalizeUrlInput(input.url), endpoint);
    state.open = true;
    state.tabs = [...state.tabs, this.tabFromTarget(target)];
    if (input.activate !== false || !state.activeTabId) {
      state.activeTabId = target.id;
      this.activeThreadId = input.threadId;
      await this.activateTarget(target.id);
    }
    this.markChanged(state);
    await this.refreshThreadState(input.threadId);
    this.emit(input.threadId);
    return cloneThreadState(state);
  }

  async closeTab(input: BrowserTabInput): Promise<ThreadBrowserState> {
    const state = this.getOrCreateState(input.threadId);
    await this.closeTarget(input.tabId).catch(() => undefined);
    state.tabs = state.tabs.filter((tab) => tab.id !== input.tabId);
    if (state.tabs.length === 0) {
      state.open = false;
      state.activeTabId = null;
    } else if (!state.tabs.some((tab) => tab.id === state.activeTabId)) {
      state.activeTabId = state.tabs[0]?.id ?? null;
    }
    this.markChanged(state);
    this.emit(input.threadId);
    return cloneThreadState(state);
  }

  async selectTab(input: BrowserTabInput): Promise<ThreadBrowserState> {
    const state = this.getOrCreateState(input.threadId);
    const tab = this.resolveTab(state, input.tabId);
    state.activeTabId = tab.id;
    this.activeThreadId = input.threadId;
    await this.activateTarget(tab.id);
    this.markChanged(state);
    await this.refreshThreadState(input.threadId);
    this.emit(input.threadId);
    return cloneThreadState(state);
  }

  async openDevTools(input: BrowserTabInput): Promise<void> {
    await this.selectTab(input);
  }

  async captureScreenshot(input: BrowserTabInput): Promise<BrowserCaptureScreenshotResult> {
    const state = this.getOrCreateState(input.threadId);
    const tab = this.resolveTab(state, input.tabId);
    await this.activateTarget(tab.id).catch(() => undefined);
    const result = asObject(
      await this.executeCdp({
        threadId: input.threadId,
        tabId: tab.id,
        method: "Page.captureScreenshot",
        params: { format: "png", captureBeyondViewport: false },
      }),
    );
    const data = asString(result?.data);
    if (!data) {
      throw new Error("Couldn't capture a browser screenshot.");
    }
    const bytes = Buffer.from(data, "base64");
    return {
      name: screenshotFileNameForUrl(tab.lastCommittedUrl ?? tab.url),
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
      bytes: Uint8Array.from(bytes),
    };
  }

  async executeCdp(input: BrowserExecuteCdpInput): Promise<unknown> {
    await this.ensureBrowser();
    const state = this.getOrCreateState(input.threadId);
    const tab = this.resolveTab(state, input.tabId);
    const result = await this.sendCdpCommand(tab.id, input.method, input.params ?? {});
    this.scheduleRefresh(input.threadId);
    return result;
  }

  async attachBrowserUseTab(input: BrowserTabInput): Promise<void> {
    await this.selectTab(input);
    await this.executeCdp({ ...input, method: "Page.enable" }).catch(() => undefined);
    await this.executeCdp({ ...input, method: "Runtime.enable" }).catch(() => undefined);
  }

  subscribeToCdpEvents(
    input: BrowserTabInput,
    listener: (event: { method: string; params?: unknown }) => void,
  ): () => void {
    let socket: WebSocket | null = null;
    let closed = false;

    void this.connectTarget(input.tabId)
      .then((ws) => {
        if (closed) {
          ws.close();
          return;
        }
        socket = ws;
        ws.on("message", (raw) => {
          const message = JSON.parse(raw.toString()) as { method?: string; params?: unknown };
          if (typeof message.method === "string") {
            listener({
              method: message.method,
              ...(message.params !== undefined ? { params: message.params } : {}),
            });
          }
        });
      })
      .catch(() => undefined);

    return () => {
      closed = true;
      socket?.close();
    };
  }

  private getOrCreateState(threadId: ThreadId): ThreadBrowserState {
    const existing = this.states.get(threadId);
    if (existing) return existing;
    const state = defaultBrowserState(threadId);
    this.states.set(threadId, state);
    return state;
  }

  private resolveTab(state: ThreadBrowserState, tabId?: string): BrowserTabState {
    const resolvedTabId = tabId ?? state.activeTabId ?? state.tabs[0]?.id ?? null;
    const tab = resolvedTabId ? state.tabs.find((candidate) => candidate.id === resolvedTabId) : null;
    if (!tab) {
      throw new Error("No browser tab is available.");
    }
    return tab;
  }

  private markChanged(state: ThreadBrowserState): void {
    state.version += 1;
  }

  private emit(threadId: ThreadId): void {
    const state = this.states.get(threadId);
    if (!state) return;
    const snapshot = cloneThreadState(state);
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private scheduleRefresh(threadId: ThreadId): void {
    const existing = this.refreshTimers.get(threadId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.refreshTimers.delete(threadId);
      void this.refreshThreadState(threadId)
        .then(() => this.emit(threadId))
        .catch(() => undefined);
    }, 350);
    this.refreshTimers.set(threadId, timer);
  }

  private async ensureBrowser(): Promise<string> {
    if (this.endpoint) {
      try {
        await fetchJson(`${this.endpoint}/json/version`);
        return this.endpoint;
      } catch {
        this.endpoint = null;
      }
    }
    if (this.launchPromise) return this.launchPromise;
    this.launchPromise = this.launchBrowser();
    try {
      return await this.launchPromise;
    } finally {
      this.launchPromise = null;
    }
  }

  private async launchBrowser(): Promise<string> {
    const executable = resolveChromiumExecutable({
      env: this.config.env,
      platform: this.config.platform,
    });
    if (!executable) {
      throw new Error("No compatible Chromium-family browser was found.");
    }

    const port = await findAvailablePort();
    const userDataDir = Path.join(this.config.baseDir, "browser-profile");
    FS.mkdirSync(userDataDir, { recursive: true });
    const args = buildChromiumLaunchArgs({ port, userDataDir });
    const child = spawn(executable.path, args, {
      detached: false,
      stdio: "ignore",
    });
    child.once("exit", () => {
      if (this.child === child) {
        this.child = null;
        this.endpoint = null;
      }
    });
    this.child = child;

    const endpoint = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + BROWSER_LAUNCH_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        await fetchJson(`${endpoint}/json/version`);
        this.endpoint = endpoint;
        return endpoint;
      } catch {
        await sleep(BROWSER_LAUNCH_READY_POLL_MS);
      }
    }

    if (!child.killed) {
      child.kill();
    }
    if (this.child === child) {
      this.child = null;
    }
    throw new Error(`${executable.name} did not expose a CDP endpoint in time.`);
  }

  private endpointUrl(path: string): string {
    if (!this.endpoint) {
      throw new Error("Browser runtime is not connected.");
    }
    return `${this.endpoint}${path}`;
  }

  private async listTargets(): Promise<CdpTarget[]> {
    await this.ensureBrowser();
    const targets = await fetchJson<CdpTarget[]>(this.endpointUrl("/json/list"));
    return targets.filter((target) => target.type === "page");
  }

  private async createTarget(url: string, endpoint = this.endpoint): Promise<CdpTarget> {
    if (!endpoint) throw new Error("Browser runtime is not connected.");
    const targetUrl = `${endpoint}/json/new?${encodeURIComponent(url)}`;
    try {
      return await fetchJson<CdpTarget>(targetUrl, { method: "PUT" });
    } catch {
      return await fetchJson<CdpTarget>(targetUrl);
    }
  }

  private async closeTarget(tabId: string): Promise<void> {
    await this.ensureBrowser();
    await fetchText(this.endpointUrl(`/json/close/${encodeURIComponent(tabId)}`));
  }

  private async activateTarget(tabId: string): Promise<void> {
    await this.ensureBrowser();
    await fetchText(this.endpointUrl(`/json/activate/${encodeURIComponent(tabId)}`));
  }

  private tabFromTarget(target: CdpTarget): BrowserTabState {
    const url = target.url?.trim() || ABOUT_BLANK_URL;
    return {
      id: target.id,
      url,
      title: target.title?.trim() || defaultTitleForUrl(url),
      status: "live",
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      faviconUrl: target.faviconUrl ?? null,
      lastCommittedUrl: url,
      lastError: null,
    };
  }

  private async refreshThreadState(threadId: ThreadId): Promise<void> {
    const state = this.getOrCreateState(threadId);
    if (!state.open || state.tabs.length === 0) return;
    const targets = await this.listTargets();
    const targetById = new Map(targets.map((target) => [target.id, target]));
    const nextTabs = state.tabs
      .map((tab) => {
        const target = targetById.get(tab.id);
        return target ? { ...tab, ...this.tabFromTarget(target) } : null;
      })
      .filter((tab): tab is BrowserTabState => Boolean(tab));

    state.tabs = nextTabs;
    if (nextTabs.length === 0) {
      state.open = false;
      state.activeTabId = null;
    } else if (!nextTabs.some((tab) => tab.id === state.activeTabId)) {
      state.activeTabId = nextTabs[0]?.id ?? null;
    }

    const activeTab = state.activeTabId
      ? nextTabs.find((tab) => tab.id === state.activeTabId)
      : null;
    if (activeTab) {
      await this.applyNavigationState(activeTab).catch(() => undefined);
    }

    state.lastError = null;
    this.markChanged(state);
  }

  private async applyNavigationState(tab: BrowserTabState): Promise<void> {
    const result = asObject(await this.sendCdpCommand(tab.id, "Page.getNavigationHistory", {}));
    const currentIndex = asNumber(result?.currentIndex);
    const entries = Array.isArray(result?.entries) ? result.entries : [];
    if (currentIndex === null) return;
    tab.canGoBack = currentIndex > 0;
    tab.canGoForward = currentIndex < entries.length - 1;
  }

  private async resolveHistoryEntry(
    input: BrowserTabInput,
    offset: -1 | 1,
  ): Promise<{ entryId: number }> {
    const result = asObject(
      await this.executeCdp({ ...input, method: "Page.getNavigationHistory" }),
    );
    const currentIndex = asNumber(result?.currentIndex);
    const entries = Array.isArray(result?.entries) ? result.entries : [];
    const entry = currentIndex === null ? null : asObject(entries[currentIndex + offset]);
    const entryId = asNumber(entry?.id);
    if (entryId === null) {
      throw new Error(offset < 0 ? "No previous browser history entry." : "No next browser history entry.");
    }
    return { entryId };
  }

  private async connectTarget(tabId: string): Promise<WebSocket> {
    const target = (await this.listTargets()).find((candidate) => candidate.id === tabId);
    if (!target?.webSocketDebuggerUrl) {
      throw new Error("Browser tab CDP endpoint is unavailable.");
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return ws;
  }

  private async sendCdpCommand(
    tabId: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const ws = await this.connectTarget(tabId);
    let nextId = 1;
    const id = nextId;
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const cleanup = () => {
          ws.off("message", onMessage);
          ws.off("error", onError);
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onMessage = (raw: WebSocket.RawData) => {
          const message = JSON.parse(raw.toString()) as {
            id?: number;
            result?: unknown;
            error?: { message?: string };
          };
          if (message.id !== id) return;
          cleanup();
          if (message.error) {
            reject(new Error(message.error.message ?? `CDP ${method} failed.`));
            return;
          }
          resolve(message.result);
        };
        ws.on("message", onMessage);
        ws.on("error", onError);
        ws.send(JSON.stringify({ id, method, params }));
      });
    } finally {
      ws.close();
    }
  }
}

export const externalBrowserManager = new ExternalBrowserManager();

function encodeBrowserUseFrame(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(BROWSER_USE_HEADER_BYTES);
  if (OS.endianness() === "LE") {
    header.writeUInt32LE(payload.length, 0);
  } else {
    header.writeUInt32BE(payload.length, 0);
  }
  return Buffer.concat([header, payload]);
}

function decodeBrowserUseFrames(buffer: Buffer): { messages: string[]; remaining: Buffer } | null {
  let offset = 0;
  const messages: string[] = [];
  while (buffer.length - offset >= BROWSER_USE_HEADER_BYTES) {
    const messageLength =
      OS.endianness() === "LE" ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    if (messageLength > BROWSER_USE_MAX_MESSAGE_BYTES) return null;
    const frameLength = BROWSER_USE_HEADER_BYTES + messageLength;
    if (buffer.length - offset < frameLength) break;
    messages.push(
      buffer.subarray(offset + BROWSER_USE_HEADER_BYTES, offset + frameLength).toString("utf8"),
    );
    offset += frameLength;
  }
  return { messages, remaining: buffer.subarray(offset) };
}

function cleanupPipePath(pipePath: string): void {
  if (process.platform === "win32") return;
  try {
    const stat = FS.lstatSync(pipePath);
    if (stat.isSocket() || stat.isFile()) FS.unlinkSync(pipePath);
  } catch {
    // Ignore stale socket cleanup failures.
  }
}

export class ExternalBrowserUsePipeServer {
  private readonly sockets = new Set<Net.Socket>();
  private readonly pendingBySocket = new Map<Net.Socket, Buffer>();
  private readonly trackedTabByKey = new Map<string, BrowserUseTrackedTab>();
  private readonly trackedTabById = new Map<number, BrowserUseTrackedTab>();
  private readonly selectedTrackedTabIdBySessionId = new Map<string, number>();
  private readonly cdpListenerDisposeBySessionId = new Map<string, () => void>();
  private readonly server = Net.createServer((socket) => this.handleSocketConnection(socket));
  private nextTrackedTabId = 1;
  private started = false;

  constructor(private readonly pipePath: string) {}

  async start(): Promise<void> {
    if (this.started) return;
    if (process.platform !== "win32") {
      FS.mkdirSync(Path.dirname(this.pipePath), { recursive: true });
      cleanupPipePath(this.pipePath);
    }
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.pipePath, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    this.started = true;
  }

  async dispose(): Promise<void> {
    for (const dispose of this.cdpListenerDisposeBySessionId.values()) dispose();
    this.cdpListenerDisposeBySessionId.clear();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.pendingBySocket.clear();
    if (this.started) {
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
      });
      this.started = false;
    }
    cleanupPipePath(this.pipePath);
  }

  private handleSocketConnection(socket: Net.Socket): void {
    this.sockets.add(socket);
    this.pendingBySocket.set(socket, Buffer.alloc(0));
    socket.on("data", (chunk) => this.handleSocketData(socket, chunk));
    socket.on("close", () => {
      this.sockets.delete(socket);
      this.pendingBySocket.delete(socket);
    });
    socket.on("error", () => {
      this.sockets.delete(socket);
      this.pendingBySocket.delete(socket);
      socket.destroy();
    });
  }

  private handleSocketData(socket: Net.Socket, chunk: Buffer): void {
    const decoded = decodeBrowserUseFrames(
      Buffer.concat([this.pendingBySocket.get(socket) ?? Buffer.alloc(0), chunk]),
    );
    if (!decoded) {
      this.pendingBySocket.delete(socket);
      socket.destroy();
      return;
    }
    this.pendingBySocket.set(socket, decoded.remaining);
    for (const message of decoded.messages) {
      void this.handleIncomingMessage(socket, message);
    }
  }

  private async handleIncomingMessage(socket: Net.Socket, rawMessage: string): Promise<void> {
    let request: BrowserUseRpcRequest;
    try {
      request = JSON.parse(rawMessage) as BrowserUseRpcRequest;
    } catch {
      return;
    }
    if (request.id === undefined || typeof request.method !== "string") return;

    try {
      const result = await this.handleRequest(request.method, request.params);
      socket.write(encodeBrowserUseFrame({ jsonrpc: "2.0", id: request.id, result }));
    } catch (error) {
      socket.write(
        encodeBrowserUseFrame({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: 1, message: error instanceof Error ? error.message : String(error) },
        }),
      );
    }
  }

  private async handleRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "ping":
        return "pong";
      case "getInfo":
        return {
          name: "BroCode External Browser",
          version: "0.1.0",
          type: "external-cdp",
        };
      case "getTabs":
        return this.getTabsForSession(requireSessionId(params));
      case "createTab":
        return this.createTabForSession(requireSessionId(params));
      case "nameSession":
        requireSessionId(params);
        return {};
      case "attach":
        return this.attachForSession(requireSessionId(params), params);
      case "detach":
        return this.detachForSession(requireSessionId(params));
      case "executeCdp":
        return this.executeCdpForSession(requireSessionId(params), params);
      default:
        throw new Error(`No handler registered for method: ${method}`);
    }
  }

  private browserUseThreadId(sessionId: string): ThreadId {
    return `browser-use:${sessionId}` as ThreadId;
  }

  private trackTab(threadId: ThreadId, tabId: string): BrowserUseTrackedTab {
    const key = `${threadId}:${tabId}`;
    const existing = this.trackedTabByKey.get(key);
    if (existing) return existing;
    const tracked = { id: this.nextTrackedTabId, threadId, tabId };
    this.nextTrackedTabId += 1;
    this.trackedTabByKey.set(key, tracked);
    this.trackedTabById.set(tracked.id, tracked);
    return tracked;
  }

  private getSnapshotOrSessionState(sessionId: string) {
    return externalBrowserManager.getBrowserUseSnapshot() ?? null;
  }

  private getTabsForSession(sessionId: string) {
    const snapshot = this.getSnapshotOrSessionState(sessionId);
    if (!snapshot) return [];
    const selectedTrackedTabId = this.selectedTrackedTabIdBySessionId.get(sessionId) ?? null;
    return snapshot.state.tabs.map((tab) => {
      const tracked = this.trackTab(snapshot.threadId, tab.id);
      return {
        id: tracked.id,
        title: tab.title,
        active:
          selectedTrackedTabId === tracked.id ||
          (selectedTrackedTabId === null && snapshot.state.activeTabId === tab.id),
        url: tab.lastCommittedUrl ?? tab.url,
      };
    });
  }

  private async createTabForSession(sessionId: string) {
    let snapshot = this.getSnapshotOrSessionState(sessionId);
    if (!snapshot) {
      externalBrowserManager.requestOpenPanel();
      const threadId = this.browserUseThreadId(sessionId);
      const state = await externalBrowserManager.open({ threadId });
      snapshot = { threadId, state };
    }
    const nextState = await externalBrowserManager.newTab({
      threadId: snapshot.threadId,
      url: ABOUT_BLANK_URL,
      activate: true,
    });
    const activeTab =
      nextState.tabs.find((tab) => tab.id === nextState.activeTabId) ?? nextState.tabs[0] ?? null;
    if (!activeTab) throw new Error("Could not create a browser tab.");
    const tracked = this.trackTab(snapshot.threadId, activeTab.id);
    this.selectedTrackedTabIdBySessionId.set(sessionId, tracked.id);
    return {
      id: tracked.id,
      title: activeTab.title,
      active: true,
      url: activeTab.lastCommittedUrl ?? activeTab.url,
    };
  }

  private resolveTrackedTabForSession(sessionId: string, params: unknown): BrowserUseTrackedTab {
    const requestedTrackedTabId = asNumber(asObject(params)?.tabId);
    const trackedTabId =
      requestedTrackedTabId ?? this.selectedTrackedTabIdBySessionId.get(sessionId) ?? null;
    if (trackedTabId === null) throw new Error("No browser tab selected for this session.");
    const tracked = this.trackedTabById.get(trackedTabId);
    if (!tracked) throw new Error(`Unknown tab: ${trackedTabId}`);
    return tracked;
  }

  private async attachForSession(sessionId: string, params: unknown) {
    const tracked = this.resolveTrackedTabForSession(sessionId, params);
    this.selectedTrackedTabIdBySessionId.set(sessionId, tracked.id);
    this.cdpListenerDisposeBySessionId.get(sessionId)?.();
    await externalBrowserManager.attachBrowserUseTab({
      threadId: tracked.threadId,
      tabId: tracked.tabId,
    });
    const dispose = externalBrowserManager.subscribeToCdpEvents(
      { threadId: tracked.threadId, tabId: tracked.tabId },
      (event) => {
        this.broadcastNotification("onCDPEvent", {
          source: { tabId: tracked.id },
          method: event.method,
          ...(event.params !== undefined ? { params: event.params } : {}),
        });
      },
    );
    this.cdpListenerDisposeBySessionId.set(sessionId, dispose);
    return {};
  }

  private async detachForSession(sessionId: string) {
    this.cdpListenerDisposeBySessionId.get(sessionId)?.();
    this.cdpListenerDisposeBySessionId.delete(sessionId);
    return {};
  }

  private async executeCdpForSession(sessionId: string, params: unknown) {
    const request = asObject(params);
    const method = asString(request?.method);
    if (!method) throw new Error("executeCdp requires a method");
    const tracked = this.resolveTrackedTabForSession(sessionId, asObject(request?.target) ?? null);
    this.selectedTrackedTabIdBySessionId.set(sessionId, tracked.id);
    const commandParams = asObject(request?.commandParams);
    return externalBrowserManager.executeCdp({
      threadId: tracked.threadId,
      tabId: tracked.tabId,
      method,
      ...(commandParams ? { params: commandParams } : {}),
    });
  }

  private broadcastNotification(method: string, params: unknown): void {
    const payload = encodeBrowserUseFrame({ jsonrpc: "2.0", method, params });
    for (const socket of this.sockets) {
      if (!socket.destroyed) socket.write(payload);
    }
  }
}

let browserUsePipeServer: ExternalBrowserUsePipeServer | null = null;

export async function startExternalBrowserRuntime(config: BrowserRuntimeConfig): Promise<void> {
  externalBrowserManager.configure(config);
  const pipePath = resolveConfiguredBrowserUsePipePath(
    config.baseDir,
    config.env ?? process.env,
    config.platform ?? process.platform,
  );
  if (!browserUsePipeServer) {
    browserUsePipeServer = new ExternalBrowserUsePipeServer(pipePath);
    await browserUsePipeServer.start();
  }
}

export async function stopExternalBrowserRuntime(): Promise<void> {
  await browserUsePipeServer?.dispose();
  browserUsePipeServer = null;
  await externalBrowserManager.dispose();
}

export async function handleExternalBrowserAction(
  action: string,
  input: unknown,
): Promise<unknown> {
  switch (action) {
    case "open":
      return externalBrowserManager.open(input as BrowserOpenInput);
    case "close":
      return externalBrowserManager.close(input as BrowserThreadInput);
    case "hide":
      externalBrowserManager.hide(input as BrowserThreadInput);
      return {};
    case "getState":
      return externalBrowserManager.getState({ threadId: requireThreadId(input) });
    case "setPanelBounds":
    case "attachWebview":
      return externalBrowserManager.getState({ threadId: requireThreadId(input) });
    case "captureScreenshot": {
      const screenshot = await externalBrowserManager.captureScreenshot(input as BrowserTabInput);
      return {
        name: screenshot.name,
        mimeType: screenshot.mimeType,
        sizeBytes: screenshot.sizeBytes,
        bytesBase64: Buffer.from(screenshot.bytes).toString("base64"),
      };
    }
    case "executeCdp":
      return externalBrowserManager.executeCdp(input as BrowserExecuteCdpInput);
    case "navigate":
      return externalBrowserManager.navigate(input as BrowserNavigateInput);
    case "reload":
      return externalBrowserManager.reload(input as BrowserTabInput);
    case "goBack":
      return externalBrowserManager.goBack(input as BrowserTabInput);
    case "goForward":
      return externalBrowserManager.goForward(input as BrowserTabInput);
    case "newTab":
      return externalBrowserManager.newTab(input as BrowserNewTabInput);
    case "closeTab":
      return externalBrowserManager.closeTab(input as BrowserTabInput);
    case "selectTab":
      return externalBrowserManager.selectTab(input as BrowserTabInput);
    case "openDevTools":
      await externalBrowserManager.openDevTools(input as BrowserTabInput);
      return {};
    case "listStates":
      return { states: externalBrowserManager.getOpenStates() };
    case "events":
      return { openPanelRequestSequence: externalBrowserManager.getOpenPanelRequestSequence() };
    default:
      throw new Error(`Unknown browser action: ${action}`);
  }
}
