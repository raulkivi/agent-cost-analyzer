// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readCopilotEventLog } from "./copilot-event-log-reader.js";

// Checks the step 10.15 `usageRecords` fixture against its own session.db
// rows: what `expected` claims about each turn must follow from the data.
const FIXTURES = new URL("../../../fixtures/agent-host/copilot-cli/", import.meta.url);

type Reason = "records-missing" | "records-incomplete" | "not-reported";
interface ExpectedTurn {
  cacheWrite: number | null;
  reasoning: number | null;
  reason?: Reason;
}
interface TurnTotals {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}
const rows = JSON.parse(readFileSync(new URL("rows.json", FIXTURES), "utf8")) as {
  sdkSessionIds: Record<string, string>;
  chats_v2: { owner_session_uri: string; provider_data: string | null }[];
  turns: Record<string, { id: string; event_id: string | null }[]>;
  turnUsage: Record<
    string,
    { turn_id: string; usage: { _meta: { turnTokenTotals: TurnTotals[]; copilotUsage: { totalNanoAiu: number } } } }[]
  >;
  expected: { usageRecords: ExpectedTurn[] };
};

const sdkId = rows.sdkSessionIds.usageRecords!;
const log = (await readCopilotEventLog(new URL(`session-state/${sdkId}/events.jsonl`, FIXTURES).pathname))!;

// Fields of a `session.usage_record` event's `usage` payload that the checks read.
// Aliases, not interfaces: event `data` is a Record, and only aliases cast to it.
type UsageRecord = {
  apiCallId: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  outputTokens: number;
  cacheDetailsReported: boolean;
  copilotUsage: { totalNanoAiu: number };
  accounting: { sourceSessionId: string };
};
type UsageRecordData = { usage: UsageRecord };
type AssistantMessageData = { apiCallId?: string; turnId?: string };

interface Call {
  apiCallId: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  output: number;
  nanoAiu: number;
  reported: boolean;
}

// Splits the log at the main-agent user.message that starts each turn.
function recordsOfTurn(eventId: string | null): Call[] {
  const events = log.events;
  const start = events.findIndex((e) => e.id === eventId);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = events.findIndex((e, i) => i > start && e.type === "user.message" && e.agentId === null);
  return events
    .slice(start, next === -1 ? undefined : next)
    .filter((e) => e.type === "session.usage_record")
    .map((e) => {
      const u = (e.data as UsageRecordData).usage;
      return {
        apiCallId: u.apiCallId,
        input: u.inputTokens,
        cacheRead: u.cacheReadTokens,
        cacheWrite: u.cacheWriteTokens,
        reasoning: u.reasoningTokens,
        output: u.outputTokens,
        nanoAiu: u.copilotUsage.totalNanoAiu,
        reported: u.cacheDetailsReported,
      };
    });
}
const sum = (calls: Call[], pick: (c: Call) => number) => calls.reduce((n, c) => n + pick(c), 0);

describe("usageRecords fixture", () => {
  const turns = rows.turns.usageRecords!;

  it("is owned by a chats_v2 row and has one turn_usage row per turn", () => {
    expect(rows.chats_v2.some((r) => r.provider_data?.includes(sdkId))).toBe(true);
    expect(rows.turnUsage.usageRecords!.map((r) => r.turn_id)).toEqual(turns.map((t) => t.id));
    expect(rows.expected.usageRecords).toHaveLength(turns.length);
    expect(log.skippedLines).toBe(0);
  });

  it("carries the fixture id as accounting.sourceSessionId and unique apiCallIds", () => {
    const usages = log.events.filter((e) => e.type === "session.usage_record");
    for (const e of usages) {
      expect((e.data as UsageRecordData).usage.accounting.sourceSessionId).toBe(sdkId);
    }
    const ids = usages.map((e) => (e.data as UsageRecordData).usage.apiCallId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps each usage_record before the assistant.message with the same apiCallId", () => {
    const events = log.events;
    for (const [i, e] of events.entries()) {
      if (e.type !== "session.usage_record") continue;
      const id = (e.data as UsageRecordData).usage.apiCallId;
      const msg = events.findIndex(
        (m) => m.type === "assistant.message" && (m.data as AssistantMessageData).apiCallId === id,
      );
      expect(msg).toBeGreaterThan(i);
    }
  });

  it.each([0, 1, 2, 3])("turn %i matches its expected figures against session.db totals", (index) => {
    const turn = turns[index]!;
    const expected = rows.expected.usageRecords[index]!;
    const usage = rows.turnUsage.usageRecords![index]!.usage;
    const totals = usage._meta.turnTokenTotals[0]!;
    const calls = recordsOfTurn(turn.event_id);

    if (expected.reason === "records-missing") {
      expect(calls).toEqual([]);
      expect(expected).toMatchObject({ cacheWrite: null, reasoning: null });
      return;
    }
    expect(calls.length).toBeGreaterThan(0);
    const covers =
      sum(calls, (c) => c.input) === totals.inputTokens &&
      sum(calls, (c) => c.cacheRead) === totals.cachedTokens &&
      sum(calls, (c) => c.output) === totals.outputTokens;

    if (expected.reason === "records-incomplete") {
      expect(covers).toBe(false);
      expect(expected).toMatchObject({ cacheWrite: null, reasoning: null });
      return;
    }
    expect(covers).toBe(true);
    expect(sum(calls, (c) => c.nanoAiu)).toBe(usage._meta.copilotUsage.totalNanoAiu);
    // inputTokens includes cache reads and writes.
    expect(sum(calls, (c) => c.cacheRead + c.cacheWrite)).toBeLessThanOrEqual(totals.inputTokens);
    if (expected.reason === "not-reported") {
      expect(calls.some((c) => !c.reported)).toBe(true);
      expect(expected).toMatchObject({ cacheWrite: null });
    } else {
      expect(calls.every((c) => c.reported)).toBe(true);
      expect(sum(calls, (c) => c.cacheWrite)).toBe(expected.cacheWrite);
      expect(sum(calls, (c) => c.reasoning)).toBe(expected.reasoning);
    }
  });

  it("covers the four cases the reconciler distinguishes", () => {
    expect(rows.expected.usageRecords.map((e) => e.reason ?? "known")).toEqual([
      "known",
      "records-incomplete",
      "records-missing",
      "not-reported",
    ]);
    expect(recordsOfTurn(turns[0]!.event_id).some((c) => c.reasoning === 0)).toBe(true);
    expect(recordsOfTurn(turns[1]!.event_id)).toHaveLength(2);
    const turn1Calls = log.events.filter(
      (e) => e.type === "assistant.message" && (e.data as AssistantMessageData).turnId === "1",
    );
    expect(turn1Calls).toHaveLength(3);
  });
});
