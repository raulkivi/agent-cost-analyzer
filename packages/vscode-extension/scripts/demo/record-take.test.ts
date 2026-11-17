// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { recordTake } from "./record-take.mts";

// A fake recorder that logs into the same list as the scene's callbacks, so the order is visible.
function fakeRecorder(log: string[], failures: { ready?: boolean; stop?: boolean } = {}) {
  return {
    ready: async () => {
      log.push("ready");
      if (failures.ready) throw new Error("ffmpeg exited");
    },
    stop: async () => {
      log.push("stop");
      if (failures.stop) throw new Error("ffmpeg hung");
    },
    discard: async () => {
      log.push("discard");
    },
  };
}

describe("recordTake", () => {
  it("stops the recording after the play and before the end checks", async () => {
    const log: string[] = [];
    await recordTake(fakeRecorder(log), {
      play: async () => void log.push("play"),
      endChecks: async () => void log.push("endChecks"),
    });
    expect(log).toEqual(["ready", "play", "stop", "endChecks"]);
  });

  it("keeps the master when the end checks pass", async () => {
    const log: string[] = [];
    await recordTake(fakeRecorder(log), { play: async () => undefined, endChecks: async () => undefined });
    expect(log).not.toContain("discard");
  });

  it("works without end checks", async () => {
    const log: string[] = [];
    await recordTake(fakeRecorder(log), { play: async () => void log.push("play") });
    expect(log).toEqual(["ready", "play", "stop"]);
  });

  it("discards the master and rethrows when an end check fails", async () => {
    const log: string[] = [];
    const failing = recordTake(fakeRecorder(log), {
      play: async () => void log.push("play"),
      endChecks: async () => {
        log.push("endChecks");
        throw new Error("Privacy probe: leaked");
      },
    });
    await expect(failing).rejects.toThrow("Privacy probe: leaked");
    expect(log).toEqual(["ready", "play", "stop", "endChecks", "discard"]);
  });

  it("discards the master and rethrows when the play fails, without running the end checks", async () => {
    const log: string[] = [];
    const failing = recordTake(fakeRecorder(log), {
      play: async () => {
        throw new Error("click target missing");
      },
      endChecks: async () => void log.push("endChecks"),
    });
    await expect(failing).rejects.toThrow("click target missing");
    expect(log).toEqual(["ready", "discard"]);
  });

  it("discards the master when the recorder never gets ready, without playing", async () => {
    const log: string[] = [];
    const failing = recordTake(fakeRecorder(log, { ready: true }), { play: async () => void log.push("play") });
    await expect(failing).rejects.toThrow("ffmpeg exited");
    expect(log).toEqual(["ready", "discard"]);
  });

  it("discards the master and skips the end checks when the recorder fails to stop", async () => {
    const log: string[] = [];
    const failing = recordTake(fakeRecorder(log, { stop: true }), { play: async () => undefined, endChecks: async () => void log.push("endChecks") });
    await expect(failing).rejects.toThrow("ffmpeg hung");
    expect(log).toEqual(["ready", "stop", "discard"]);
  });
});
