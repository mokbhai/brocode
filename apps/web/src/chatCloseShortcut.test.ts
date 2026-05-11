import { describe, expect, it } from "vitest";

import {
  CHAT_CLOSE_DOUBLE_PRESS_MS,
  resolveChatCloseShortcutPress,
  type PendingChatCloseShortcut,
} from "./chatCloseShortcut";

describe("resolveChatCloseShortcutPress", () => {
  it("schedules a chat close on the first press", () => {
    const result = resolveChatCloseShortcutPress({ pending: null, now: 1000 });

    expect(result.action).toBe("schedule-chat-close");
    expect(result.pending?.pressedAt).toBe(1000);
  });

  it("closes the app and cancels the pending chat close on a quick second press", () => {
    const pending: PendingChatCloseShortcut = { pressedAt: 1000 };
    const result = resolveChatCloseShortcutPress({
      pending,
      now: 1000 + CHAT_CLOSE_DOUBLE_PRESS_MS - 1,
    });

    expect(result.action).toBe("close-window");
    expect(result.pending).toBeNull();
  });

  it("treats a late second press as a new first press", () => {
    const pending: PendingChatCloseShortcut = { pressedAt: 1000 };
    const result = resolveChatCloseShortcutPress({
      pending,
      now: 1000 + CHAT_CLOSE_DOUBLE_PRESS_MS + 1,
    });

    expect(result.action).toBe("schedule-chat-close");
    expect(result.pending?.pressedAt).toBe(1000 + CHAT_CLOSE_DOUBLE_PRESS_MS + 1);
  });
});
