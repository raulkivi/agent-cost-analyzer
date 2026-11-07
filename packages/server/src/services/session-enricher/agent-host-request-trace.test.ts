import path from "node:path";
import { describe, expect, it } from "vitest";
import { requestTraceSchema } from "@agent-cost-analyzer/domain";
import { readCopilotEventLog } from "../../data-sources/agent-host/copilot-event-log-reader.js";
import { COPILOT_CLI_FIXTURE_HOME, copilotCliFixtureRows, copilotCliFixtureTurnRefs, type CopilotCliFixtureName } from "../../test-support/copilot-cli-fixtures.js";
import { TURN_EVENT_ALREADY_TAKEN_REASON } from "./copilot-turn-segmenter.js";
import { buildAgentHostRequestTrace, NO_MAIN_REQUEST_REASON, UNUSABLE_USAGE_REASON } from "./agent-host-request-trace.js";

// Phase 14 step 14.2 (docs/plans/analyze-session-replay.md §4.1, §5): an
// Agent Host session as one record per main-chain model call, from the
// Copilot CLI event log's session.usage_record events, in the session's
// turns (the same matching as the turn inspector, copilot-turn-segmenter).

async function eventLogOf(name: CopilotCliFixtureName) {
  const sdk = copilotCliFixtureRows.sdkSessionIds[name];
  const log = await readCopilotEventLog(path.join(COPILOT_CLI_FIXTURE_HOME, "session-state", sdk, "events.jsonl"));
  return { status: "read" as const, events: log!.events, turnRefs: copilotCliFixtureTurnRefs(name) };
}

describe("buildAgentHostRequestTrace", () => {
  it("gives each main-chain call its turn, with uncached input net of reads and writes", async () => {
    const trace = buildAgentHostRequestTrace("s8", 4, await eventLogOf("usageRecords"));

    expect(requestTraceSchema.parse(trace)).toEqual(trace);
    expect(trace.harness).toBe("copilot-agent-host");
    expect(trace.requests.map((r) => [r.turnIndex, r.uncachedInput, r.cacheRead, r.cacheWrite, r.output, r.reasoning])).toEqual([
      [0, 200, 600, 200, 80, 30],
      [0, 400, 1000, 100, 120, 0],
      [1, 300, 500, 100, 60, 10],
      [1, 250, 800, 50, 70, 25],
      // cacheDetailsReported: false: the write count isn't reliable, so it's
      // unknown and the uncached input holds the writes (never a 0).
      [3, 500, 1500, null, 100, 40],
    ]);
    expect(trace.requests[0]).toMatchObject({ startedAt: "2026-10-30T10:00:10.000Z", model: "claude-sonnet-5" });
    expect(trace.notTraced).toEqual([{ turnIndex: 2, reason: NO_MAIN_REQUEST_REASON }]);
  });

  it("leaves a sub-agent's calls out of the main chain (D6), and a turn the matcher couldn't place out with its reason", async () => {
    const trace = buildAgentHostRequestTrace("s2", 5, await eventLogOf("steeringAbortSubagent"));

    expect(trace.requests.map((r) => [r.turnIndex, r.model])).toEqual([
      [0, "claude-sonnet-5"],
      [0, "claude-sonnet-5"],
      [1, "claude-sonnet-5"],
      [2, "claude-sonnet-5"],
      [3, "claude-sonnet-5"],
    ]);
    expect(trace.notTraced).toEqual([{ turnIndex: 4, reason: TURN_EVENT_ALREADY_TAKEN_REASON }]);
  });

  it("lists every turn as not traced, with the log's reason, when the log can't be read", () => {
    const trace = buildAgentHostRequestTrace("s9", 2, { status: "missing", reason: "No event log." });

    expect(trace.requests).toEqual([]);
    expect(trace.notTraced).toEqual([
      { turnIndex: 0, reason: "No event log." },
      { turnIndex: 1, reason: "No event log." },
    ]);
  });

  it("leaves out a turn with a usage record it can't read, never zeroing it", async () => {
    const log = await eventLogOf("usageRecords");
    const broken = log.events.map((event) => (event.id.startsWith("904d5ee7") ? { ...event, data: { usage: { model: "claude-sonnet-5" } } } : event));

    const trace = buildAgentHostRequestTrace("s8", 4, { ...log, events: broken });

    expect(trace.requests.map((r) => r.turnIndex)).toEqual([1, 1, 3]);
    expect(trace.notTraced).toContainEqual({ turnIndex: 0, reason: UNUSABLE_USAGE_REASON });
  });
});
