import { describe, expect, it, vi } from "vitest";

import { getVoiceRecordingUnavailableReason, resolveGetUserMedia } from "./voiceRecorder";

describe("voice recorder media support", () => {
  it("binds modern mediaDevices.getUserMedia to the mediaDevices object", async () => {
    const stream = {} as MediaStream;
    const mediaDevices = {
      getUserMedia: vi.fn(function (this: unknown) {
        expect(this).toBe(mediaDevices);
        return Promise.resolve(stream);
      }),
    };

    const getUserMedia = resolveGetUserMedia({ mediaDevices });

    await expect(getUserMedia?.({ audio: true })).resolves.toBe(stream);
  });

  it("wraps legacy browser getUserMedia when mediaDevices is missing", async () => {
    const stream = {} as MediaStream;
    const legacyGetUserMedia = vi.fn((constraints, resolve) => {
      expect(constraints).toEqual({ audio: true });
      resolve(stream);
    });

    const getUserMedia = resolveGetUserMedia({ webkitGetUserMedia: legacyGetUserMedia });

    await expect(getUserMedia?.({ audio: true })).resolves.toBe(stream);
  });

  it("explains insecure contexts before falling back to generic browser support copy", () => {
    expect(
      getVoiceRecordingUnavailableReason({
        isSecureContext: false,
        navigator: {},
      }),
    ).toContain("secure browser context");

    expect(
      getVoiceRecordingUnavailableReason({
        isSecureContext: true,
        navigator: {},
      }),
    ).toBe("Microphone recording is unavailable in this browser.");
  });
});
