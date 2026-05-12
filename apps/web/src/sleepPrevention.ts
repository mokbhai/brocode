export type SleepPreventionSession = {
  readonly status?: string | null | undefined;
  readonly orchestrationStatus?: string | null | undefined;
} | null;

export function isRunningChatSession(session: SleepPreventionSession): boolean {
  return session?.orchestrationStatus === "running" || session?.status === "running";
}

export function hasRunningChatSession(sessions: Iterable<SleepPreventionSession>): boolean {
  for (const session of sessions) {
    if (isRunningChatSession(session)) {
      return true;
    }
  }

  return false;
}

export function shouldPreventSystemSleep(input: {
  readonly enabled: boolean;
  readonly hasRunningChat: boolean;
}): boolean {
  return input.enabled && input.hasRunningChat;
}
