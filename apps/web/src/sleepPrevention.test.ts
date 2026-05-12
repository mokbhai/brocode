import { describe, expect, it } from "vitest";

import {
  hasRunningChatSession,
  shouldPreventSystemSleep,
  type SleepPreventionSession,
} from "./sleepPrevention";

describe("hasRunningChatSession", () => {
  it("returns true when any orchestration session is running", () => {
    const sessions: SleepPreventionSession[] = [
      { status: "ready", orchestrationStatus: "ready" },
      { status: "ready", orchestrationStatus: "running" },
    ];

    expect(hasRunningChatSession(sessions)).toBe(true);
  });

  it("does not treat stopped, closed, or missing sessions as running", () => {
    const sessions: SleepPreventionSession[] = [
      null,
      { status: "closed", orchestrationStatus: "stopped" },
      { status: "error", orchestrationStatus: "error" },
    ];

    expect(hasRunningChatSession(sessions)).toBe(false);
  });
});

describe("shouldPreventSystemSleep", () => {
  it("only prevents sleep when the setting is enabled and a chat is running", () => {
    expect(
      shouldPreventSystemSleep({
        enabled: true,
        hasRunningChat: true,
      }),
    ).toBe(true);

    expect(
      shouldPreventSystemSleep({
        enabled: false,
        hasRunningChat: true,
      }),
    ).toBe(false);

    expect(
      shouldPreventSystemSleep({
        enabled: true,
        hasRunningChat: false,
      }),
    ).toBe(false);
  });
});
