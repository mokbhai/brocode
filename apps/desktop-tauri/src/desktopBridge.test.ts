import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installDesktopBridge } from "./desktopBridge";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout,
      desktopBridge: undefined,
    },
  });
});

describe("installDesktopBridge", () => {
  it("resolves only after the initial websocket URL is available", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_ws_url") return "ws://127.0.0.1:58090";
      return null;
    });

    const installed = installDesktopBridge();

    expect(window.desktopBridge?.getWsUrl()).toBe(null);

    await installed;

    expect(window.desktopBridge?.getWsUrl()).toBe("ws://127.0.0.1:58090");
  });

  it("routes browser open requests through the backend instead of the Phase 1 unsupported stub", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_ws_url") return "ws://127.0.0.1:58090";
      return null;
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        threadId: "thread-1",
        version: 1,
        open: true,
        activeTabId: "tab-1",
        tabs: [
          {
            id: "tab-1",
            url: "about:blank",
            title: "New tab",
            status: "live",
            isLoading: false,
            canGoBack: false,
            canGoForward: false,
            faviconUrl: null,
            lastCommittedUrl: "about:blank",
            lastError: null,
          },
        ],
        lastError: null,
      }),
    }));
    Object.assign(window, { fetch: fetchMock });

    await installDesktopBridge();
    const state = await window.desktopBridge?.browser.open({ threadId: "thread-1" });

    expect(state?.open).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:58090/api/browser/open",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ threadId: "thread-1" }),
      }),
    );
  });

  it("routes notification support and show requests through Tauri commands", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_ws_url") return "ws://127.0.0.1:58090";
      if (command === "notifications_is_supported") return true;
      if (command === "notifications_show") return true;
      return null;
    });

    await installDesktopBridge();

    await expect(window.desktopBridge?.notifications.isSupported()).resolves.toBe(true);
    await expect(
      window.desktopBridge?.notifications.show({
        title: "Activity notification",
        body: "Done",
        silent: false,
        threadId: "thread-1",
      }),
    ).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("notifications_is_supported");
    expect(invokeMock).toHaveBeenCalledWith("notifications_show", {
      input: {
        title: "Activity notification",
        body: "Done",
        silent: false,
        threadId: "thread-1",
      },
    });
  });
});
