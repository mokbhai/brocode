export const CHAT_CLOSE_DOUBLE_PRESS_MS = 320;

export interface PendingChatCloseShortcut {
  readonly pressedAt: number;
}

export type ChatCloseShortcutAction = "schedule-chat-close" | "close-window";

export function resolveChatCloseShortcutPress(input: {
  readonly pending: PendingChatCloseShortcut | null;
  readonly now: number;
}): {
  readonly action: ChatCloseShortcutAction;
  readonly pending: PendingChatCloseShortcut | null;
} {
  if (
    input.pending &&
    input.now - input.pending.pressedAt >= 0 &&
    input.now - input.pending.pressedAt <= CHAT_CLOSE_DOUBLE_PRESS_MS
  ) {
    return {
      action: "close-window",
      pending: null,
    };
  }

  return {
    action: "schedule-chat-close",
    pending: { pressedAt: input.now },
  };
}
