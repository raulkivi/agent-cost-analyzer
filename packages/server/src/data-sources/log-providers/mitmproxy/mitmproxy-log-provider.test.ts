import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeLogProviderContract } from "../contract.js";
import { anthropicDecoder } from "./decoders/anthropic.js";
import { openAiDecoder } from "./decoders/openai.js";
import { UNRECOGNIZED_VENDOR_REASON } from "./decoders/registry.js";
import { MitmproxyLogProvider } from "./mitmproxy-log-provider.js";
import { computeSegmentSessionId } from "./session-id.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures/mitmproxy",
);

describe("MitmproxyLogProvider", () => {
  it("checkAvailability reports unavailable when no captures directory is configured", async () => {
    const provider = new MitmproxyLogProvider({ capturesDirPath: null });

    await expect(provider.checkAvailability()).resolves.toEqual({
      available: false,
      unavailableReason: "No mitmproxy captures directory is configured.",
    });
  });

  it("checkAvailability reports unavailable when the configured directory has no .har files", async () => {
    const emptyDir = path.resolve(fixturesDir, "../jsonl");
    const provider = new MitmproxyLogProvider({ capturesDirPath: emptyDir });

    const availability = await provider.checkAvailability();

    expect(availability.available).toBe(false);
    expect(availability.unavailableReason).toContain("No .har files found");
  });

  it("checkAvailability reports available when at least one .har file is present", async () => {
    const provider = new MitmproxyLogProvider({ capturesDirPath: fixturesDir });

    await expect(provider.checkAvailability()).resolves.toEqual({ available: true });
  });

  it("lists one session per .har file when no entry gap exceeds the idle-gap threshold, none from unrelated files in the directory", async () => {
    const provider = new MitmproxyLogProvider({ capturesDirPath: fixturesDir });

    const sessions = await provider.listSessions();

    expect(sessions.length).toBeGreaterThanOrEqual(9);
    for (const session of sessions) {
      expect(session.providerId).toBe("mitmproxy");
      expect(session.turns).toEqual([]);
    }
  });

  it("with zero decoders registered, every exchange comes back unavailable (unrecognized vendor)", async () => {
    const provider = new MitmproxyLogProvider({ capturesDirPath: fixturesDir, decoders: [] });
    const id = computeSegmentSessionId(path.join(fixturesDir, "anthropic-non-streamed.har"), 0);

    const session = await provider.readSession(id);

    expect(session?.usageDataAvailable).toBe(false);
    expect(session?.turns[0].usage.uncachedInput).toEqual({
      known: false,
      reason: UNRECOGNIZED_VENDOR_REASON,
    });
  });

  it("with decoders registered, decodes real usage numbers from a recognized Anthropic exchange", async () => {
    const provider = new MitmproxyLogProvider({
      capturesDirPath: fixturesDir,
      decoders: [anthropicDecoder, openAiDecoder],
    });
    const id = computeSegmentSessionId(path.join(fixturesDir, "anthropic-non-streamed.har"), 0);

    const session = await provider.readSession(id);

    expect(session?.usageDataAvailable).toBe(true);
    expect(session?.turns[0].usage.uncachedInput).toEqual({ known: true, value: 120 });
    expect(session?.model).toBe("claude-3-5-haiku-20241022");
  });

  it("sets roundsCount to 1 for every turn, since each HAR entry is one complete exchange", async () => {
    const provider = new MitmproxyLogProvider({
      capturesDirPath: fixturesDir,
      decoders: [anthropicDecoder, openAiDecoder],
    });
    const id = computeSegmentSessionId(path.join(fixturesDir, "anthropic-non-streamed.har"), 0);

    const session = await provider.readSession(id);

    expect(session?.turns[0].usage.roundsCount).toBe(1);
  });

  it("returns null for a session id no configured .har file resolves to", async () => {
    const provider = new MitmproxyLogProvider({ capturesDirPath: fixturesDir });

    await expect(provider.readSession("does-not-exist")).resolves.toBeNull();
  });

  describe("readTurnDetail", () => {
    const id = computeSegmentSessionId(path.join(fixturesDir, "anthropic-non-streamed.har"), 0);

    it("returns exactly one round with the full raw request/response body as text parts", async () => {
      const provider = new MitmproxyLogProvider({ capturesDirPath: fixturesDir });

      const detail = await provider.readTurnDetail(id, 0);

      expect(detail).not.toBeNull();
      expect(detail!.turnIndex).toBe(0);
      expect(detail!.userMessage).toEqual([]);
      expect(detail!.rounds).toHaveLength(1);
      expect(detail!.rounds[0].request.toolCalls).toEqual([]);
      expect(detail!.rounds[0].request.addedMessages[0].kind).toBe("text");
      expect(detail!.rounds[0].response.response[0].kind).toBe("text");
    });

    it("returns null for an unknown session id", async () => {
      const provider = new MitmproxyLogProvider({ capturesDirPath: fixturesDir });

      await expect(provider.readTurnDetail("does-not-exist", 0)).resolves.toBeNull();
    });

    it("returns null for a turnIndex beyond this HAR file's entry count", async () => {
      const provider = new MitmproxyLogProvider({ capturesDirPath: fixturesDir });

      await expect(provider.readTurnDetail(id, 999)).resolves.toBeNull();
    });
  });

  describe("idle-gap splitting", () => {
    const idleGapFile = path.join(fixturesDir, "idle-gap-split.har");

    it("splits one .har file into multiple sessions when a consecutive-entry gap exceeds the idle-gap threshold", async () => {
      const provider = new MitmproxyLogProvider({ capturesDirPath: fixturesDir });

      const sessions = await provider.listSessions();
      const split = sessions.filter((session) => session.title.startsWith("idle-gap-split.har"));

      expect(split).toHaveLength(2);
      expect(split.map((session) => session.title)).toEqual([
        "idle-gap-split.har (session 1 of 2)",
        "idle-gap-split.har (session 2 of 2)",
      ]);
    });

    it("a file with no gap exceeding the threshold keeps the bare filename as its title", async () => {
      const provider = new MitmproxyLogProvider({ capturesDirPath: fixturesDir });

      const sessions = await provider.listSessions();
      const session = sessions.find((s) => s.title === "anthropic-non-streamed.har");

      expect(session).toBeDefined();
    });

    it("readSession returns the first segment's 2 turns for segment 0 of the split file", async () => {
      const provider = new MitmproxyLogProvider({
        capturesDirPath: fixturesDir,
        decoders: [anthropicDecoder, openAiDecoder],
      });

      const session = await provider.readSession(computeSegmentSessionId(idleGapFile, 0));

      expect(session?.turns).toHaveLength(2);
      expect(session?.turns[0].index).toBe(0);
      expect(session?.turns[1].index).toBe(1);
    });

    it("each split segment's turn indices restart at 0", async () => {
      const provider = new MitmproxyLogProvider({
        capturesDirPath: fixturesDir,
        decoders: [anthropicDecoder, openAiDecoder],
      });

      const session = await provider.readSession(computeSegmentSessionId(idleGapFile, 1));

      expect(session?.turns).toHaveLength(1);
      expect(session?.turns[0].index).toBe(0);
    });

    it("readSession returns null for a segment index beyond the file's actual segment count", async () => {
      const provider = new MitmproxyLogProvider({ capturesDirPath: fixturesDir });

      await expect(provider.readSession(computeSegmentSessionId(idleGapFile, 5))).resolves.toBeNull();
    });

    it("readTurnDetail indexes turnIndex relative to the segment, not the whole file", async () => {
      const provider = new MitmproxyLogProvider({ capturesDirPath: fixturesDir });

      const detail = await provider.readTurnDetail(computeSegmentSessionId(idleGapFile, 1), 0);

      expect(detail).not.toBeNull();
      expect(detail!.rounds[0].request.addedMessages[0]).toEqual({ kind: "text", text: expect.stringContaining("turn 3") });
    });

    it("idleGapThresholdMs can be overridden to split on a smaller gap", async () => {
      const provider = new MitmproxyLogProvider({ capturesDirPath: fixturesDir, idleGapThresholdMs: 60_000 });

      const sessions = await provider.listSessions();
      const split = sessions.filter((session) => session.title.startsWith("idle-gap-split.har"));

      expect(split).toHaveLength(3);
    });
  });
});

describeLogProviderContract("MitmproxyLogProvider", {
  buildAvailableProvider: () =>
    new MitmproxyLogProvider({
      capturesDirPath: fixturesDir,
      decoders: [anthropicDecoder, openAiDecoder],
    }),
  knownSessionId: computeSegmentSessionId(path.join(fixturesDir, "anthropic-non-streamed.har"), 0),
  unknownSessionId: "does-not-exist",
  buildUnavailableProvider: () => new MitmproxyLogProvider({ capturesDirPath: null }),
  turnIndexWithRoundTrip: 0,
});
