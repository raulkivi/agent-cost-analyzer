import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeLogProviderContract } from "../log-providers/contract.js";
import { ClaudeCodeLogProvider } from "./claude-code-log-provider.js";
import { computeClaudeCodeFileHash } from "./session-id.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/claude-code",
);

describe("ClaudeCodeLogProvider", () => {
  it("checkAvailability reports unavailable when no projects directory is configured", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: null });

    await expect(provider.checkAvailability()).resolves.toEqual({
      available: false,
      unavailableReason: "No Claude Code projects directory is configured.",
    });
  });

  it("checkAvailability reports unavailable when the configured directory does not exist", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: path.join(fixturesDir, "-home-dev-project", "does-not-exist") });

    const availability = await provider.checkAvailability();

    expect(availability.available).toBe(false);
    expect(availability.unavailableReason).toContain("does not exist");
  });

  it("checkAvailability reports available when at least one session file is present", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

    await expect(provider.checkAvailability()).resolves.toEqual({ available: true });
  });

  it("lists one session per file, with providerId set and turns empty", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

    const sessions = await provider.listSessions();
    const normal = sessions.find((s) => s.id === computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "normal-session.jsonl")));

    expect(normal).toBeDefined();
    expect(normal?.providerId).toBe("claude-code");
    expect(normal?.turns).toEqual([]);
    expect(normal?.mode).toBe("analyze");
    expect(normal?.title).toBe("Add widget form validation");
  });

  it("lists sessions ordered from most recent to oldest by startedAt", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

    const sessions = await provider.listSessions();
    const startedAts = sessions.map((s) => s.startedAt);

    expect(startedAts).toEqual([...startedAts].sort().reverse());
  });

  it("readSession returns real per-turn usage numbers for the normal fixture, summed once per round rather than per content-block entry", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
    const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "normal-session.jsonl"));

    const session = await provider.readSession(id);

    expect(session?.usageDataAvailable).toBe(true);
    expect(session?.turns).toHaveLength(2);
    // Turn 0 spans two rounds (msg_turn0 + msg_turn0b): 1250+15 input, etc.
    expect(session?.turns[0].usage.uncachedInput).toEqual({ known: true, value: 1265 });
    expect(session?.turns[0].usage.output).toEqual({ known: true, value: 460 });
    expect(session?.turns[0].usage.cacheRead).toEqual({ known: true, value: 3300 });
    expect(session?.turns[0].usage.cacheWrite).toEqual({ known: true, value: 300 });
    expect(session?.turns[0].usage.reasoning).toEqual({ known: true, value: 40 });
    expect(session?.turns[0].usage.roundsCount).toBe(2);
    expect(session?.turns[0].toolCalls).toHaveLength(1);
    expect(session?.turns[0].toolCalls[0].name).toBe("Read");
    expect(session?.turns[0].usage.costAiCredits.known).toBe(false);
    expect(session?.turns[0].usage.tool.known).toBe(false);
    expect(session?.turns[1].usage.roundsCount).toBe(1);
    expect(session?.model).toBe("claude-sonnet-5");
  });

  it("reports the folder, branch and turn times from the normal fixture's entries (step 15.1)", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
    const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "normal-session.jsonl"));

    const session = await provider.readSession(id);
    const listed = (await provider.listSessions()).find((s) => s.id === id);

    expect(session?.workspace).toEqual({ known: true, cwd: "/home/dev/project", branch: "main" });
    expect(listed?.workspace).toEqual(session?.workspace);
    expect(session?.turns.map((turn) => turn.startedAt)).toEqual(["2026-09-01T10:00:01.000Z", "2026-09-01T10:05:00.000Z"]);
    // Both turns ran where the session did, so neither carries its own workspace.
    expect(session?.turns.every((turn) => turn.workspace === undefined)).toBe(true);
  });

  it("readSession marks usageDataAvailable false when the assistant message carries no usage data at all", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
    const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "no-usage-session.jsonl"));

    const session = await provider.readSession(id);

    expect(session?.usageDataAvailable).toBe(false);
    expect(session?.turns[0].usage.output.known).toBe(false);
  });

  it("readSession skips malformed lines without throwing", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
    const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "malformed-lines-session.jsonl"));

    const session = await provider.readSession(id);

    expect(session?.turns).toHaveLength(1);
    expect(session?.turns[0].usage.output).toEqual({ known: true, value: 15 });
  });

  it("readSession returns null for an unknown id", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

    await expect(provider.readSession("does-not-exist")).resolves.toBeNull();
  });

  it("readSession follows the active leaf named by last-prompt for a forked file, tagging the resent turn as triggeredEvent: fork", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
    const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "forked-session.jsonl"));

    const session = await provider.readSession(id);

    expect(session?.turns).toHaveLength(2);
    expect(session?.turns[0].triggeredEvent).toBeUndefined();
    expect(session?.turns[1].triggeredEvent).toBe("fork");
    // The active branch is the *resent* instruction, not the original one
    // it superseded.
    expect(session?.turns[1].userMessage).toContain("go ahead with the full codebase rename");
    expect(session?.turns[1].assistantResponse).toContain("Renamed");
  });

  it("readSession returns real per-round tool calls for the parallel-tool-calls fixture (round-grouper's core scenario)", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
    const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "tool-results-and-image-session.jsonl"));

    const session = await provider.readSession(id);

    expect(session?.turns).toHaveLength(1);
    expect(session?.turns[0].usage.roundsCount).toBe(3);
    expect(session?.turns[0].toolCalls.map((t) => t.name)).toEqual([
      "Read",
      "Read",
      "mcp__playwright__browser_take_screenshot",
    ]);
  });

  // Phase 14 step 14.3: a compaction starts a new parentUuid chain, which
  // the active branch must cross to reach the turns before it.
  describe("a compacted session", () => {
    const id = () => computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "compacted-session.jsonl"));

    it("readSession keeps the turns before the compaction, the summary opening no turn of its own", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

      const session = await provider.readSession(id());

      expect(session?.turns.map((turn) => turn.userMessage)).toEqual(["Please tidy the made-up widget module.", "Now add made-up tests for the widget."]);
      expect(session?.turns[0].usage.roundsCount).toBe(2);
      expect(session?.turns[0].usage.cacheWrite).toEqual({ known: true, value: 2030 });
      expect(session?.turns[0].toolCalls.map((call) => call.name)).toEqual(["Read"]);
      expect(session?.turns[0].assistantResponse).toBe("Tidied the made-up widget module.");
      expect(session?.turns[1].usage.roundsCount).toBe(1);
      expect(session?.startedAt).toBe("2026-09-02T10:00:00.000Z");
      expect(session?.title).toBe("tidy-widget-module");
    });

    it("tags the turn holding the first request after the compaction as triggeredEvent: compaction", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

      const session = await provider.readSession(id());

      expect(session?.turns.map((turn) => turn.triggeredEvent)).toEqual([undefined, "compaction"]);
    });

    it("readRequestTrace traces every request, marking the first after the compaction", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

      const trace = await provider.readRequestTrace(id());

      expect(trace?.requests.map((r) => [r.turnIndex, r.uncachedInput, r.cacheRead, r.cacheWrite, r.event])).toEqual([
        [0, 100, 0, 2000, undefined],
        [0, 20, 2000, 30, undefined],
        [1, 300, 0, 1500, "compaction"],
      ]);
    });

    it("readTurnDetail reads the turn before the compaction by its own index", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

      const before = await provider.readTurnDetail(id(), 0);
      const after = await provider.readTurnDetail(id(), 1);

      expect(before?.rounds).toHaveLength(2);
      expect(before?.rounds[0].request.toolCalls.map((call) => call.name)).toEqual(["Read"]);
      expect(after?.rounds).toHaveLength(1);
      expect(after?.rounds[0].request.addedMessages).toEqual([]);
    });
  });

  describe("CLI-written entries (isMeta user lines, <synthetic> assistant lines)", () => {
    const id = () => computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "meta-and-synthetic-session.jsonl"));

    it("readSession keeps a response split by an isMeta line in one turn, counted once", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

      const session = await provider.readSession(id());

      expect(session?.turns.map((turn) => turn.userMessage)).toEqual(["Run the made-up checks.", "And once more?"]);
      expect(session?.turns[0].usage.roundsCount).toBe(1);
      expect(session?.turns[0].usage.output).toEqual({ known: true, value: 70 });
      expect(session?.turns[0].assistantResponse).toBe("The made-up checks pass.");
    });

    it("never takes <synthetic> as a model: not the turn's, not the session's", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

      const session = await provider.readSession(id());

      expect(session?.turns[1].usage.roundsCount).toBe(0);
      expect(session?.turns[1].usage.model).toBe("unknown");
      expect(session?.model).toBe("claude-sonnet-5");
    });

    it("readRequestTrace makes one request of the split response and none of the synthetic line", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

      const trace = await provider.readRequestTrace(id());

      expect(trace?.requests.map((r) => [r.turnIndex, r.model, r.uncachedInput, r.output, r.event])).toEqual([[0, "claude-sonnet-5", 500, 70, undefined]]);
      expect(trace?.notTraced.map((t) => t.turnIndex)).toEqual([1]);
    });
  });

  // Phase 14 step 14.2: the per-request trace a replay reads.
  describe("readRequestTrace", () => {
    const idOf = (file: string) => computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", `${file}.jsonl`));

    it("gives one record per request in the session's own turns", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

      const trace = await provider.readRequestTrace(idOf("normal-session"));

      expect(trace?.requests.map((r) => [r.turnIndex, r.uncachedInput, r.cacheRead, r.cacheWrite, r.output])).toEqual([
        [0, 1250, 1500, 300, 120],
        [0, 15, 1800, 0, 340],
        [1, 1900, 3200, 150, 210],
      ]);
      expect(trace?.notTraced).toEqual([]);
      // Its turns are the session's: the same count as readSession's.
      const session = await provider.readSession(idOf("normal-session"));
      expect(new Set(trace?.requests.map((r) => r.turnIndex)).size).toBe(session?.turns.length);
    });

    it("follows only the active branch of a forked session", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

      const trace = await provider.readRequestTrace(idOf("forked-session"));

      expect(trace?.requests.map((r) => [r.turnIndex, r.uncachedInput, r.cacheRead])).toEqual([
        [0, 300, 100],
        [1, 420, 500],
        [1, 90, 900],
      ]);
    });

    it("lists a turn without usage as not traced, with the reason", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

      const trace = await provider.readRequestTrace(idOf("no-usage-session"));

      expect(trace?.requests).toEqual([]);
      expect(trace?.notTraced).toHaveLength(1);
    });

    it("returns null for an unknown session id", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

      await expect(provider.readRequestTrace("does-not-exist")).resolves.toBeNull();
    });
  });

  describe("readTurnDetail", () => {
    it("returns rounds for a known session/turn", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
      const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "normal-session.jsonl"));

      const detail = await provider.readTurnDetail(id, 0);

      expect(detail).not.toBeNull();
      expect(detail!.rounds).toHaveLength(2);
      expect(detail!.rounds[0].request.toolCalls).toHaveLength(1);
      expect(detail!.userMessage.length).toBeGreaterThan(0);
    });

    it("returns null for an unknown session id", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

      await expect(provider.readTurnDetail("does-not-exist", 0)).resolves.toBeNull();
    });

    it("returns null for a turnIndex beyond the session's turn count", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
      const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "normal-session.jsonl"));

      await expect(provider.readTurnDetail(id, 999)).resolves.toBeNull();
    });
  });
});

describeLogProviderContract("ClaudeCodeLogProvider", {
  buildAvailableProvider: () => new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir }),
  knownSessionId: computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "normal-session.jsonl")),
  unknownSessionId: "does-not-exist",
  buildUnavailableProvider: () => new ClaudeCodeLogProvider({ projectsDirPath: null }),
  turnIndexWithRoundTrip: 0,
});
