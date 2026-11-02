import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";
import { isSubagentEvent, segmentCopilotTurns, type SegmentedTurn } from "./copilot-turn-segmenter.js";

function ev(id: string, type: string, extra: Partial<CopilotEvent> = {}): CopilotEvent {
  return { id, type, parentId: null, timestamp: null, agentId: null, data: {}, ...extra };
}
const user = (id: string, data: Record<string, unknown> = {}, agentId: string | null = null) =>
  ev(id, "user.message", { data, agentId });

function ids(events: CopilotEvent[]): string[] {
  return events.map((e) => e.id);
}
function matched(t: SegmentedTurn) {
  if (!t.matched) throw new Error(`turn ${t.turnId} unmatched: ${t.reason}`);
  return t;
}

describe("segmentCopilotTurns", () => {
  it("splits at each matched user.message and keeps pre-turn events session-level", () => {
    const events = [
      ev("s0", "session.start"),
      ev("sys", "system.message"),
      user("u1"),
      ev("a1", "assistant.message"),
      user("u2"),
      ev("a2", "assistant.message"),
      ev("end", "session.shutdown"),
    ];
    const r = segmentCopilotTurns(events, [
      { turnId: "request_1", eventId: "u1" },
      { turnId: "request_2", eventId: "u2" },
    ]);
    expect(ids(r.sessionEvents)).toEqual(["s0", "sys"]);
    const [t1, t2] = r.turns.map(matched);
    expect(t1.userMessage.id).toBe("u1");
    expect(ids(t1.events)).toEqual(["a1"]);
    // the last turn runs to the end of the file
    expect(ids(t2.events)).toEqual(["a2", "end"]);
  });

  it("falls back to a bare turn id and lets the first turn win a duplicate", () => {
    const events = [user("u1"), ev("a1", "assistant.message")];
    const r = segmentCopilotTurns(events, [
      { turnId: "request_1", eventId: "u1" },
      { turnId: "u1", eventId: null },
    ]);
    expect(matched(r.turns[0]!).userMessage.id).toBe("u1");
    expect(r.turns[1]).toMatchObject({ turnId: "u1", matched: false });
    expect(r.turns[1]!.matched ? "" : r.turns[1]!.reason).toMatch(/already/i);
  });

  it("uses a bare turn id when event_id is missing", () => {
    const r = segmentCopilotTurns([user("u1")], [{ turnId: "u1", eventId: null }]);
    expect(matched(r.turns[0]!).userMessage.id).toBe("u1");
  });

  it("leaves unmatched turns unmatched with a reason, without moving boundaries", () => {
    const events = [user("u1"), ev("a1", "assistant.message")];
    const r = segmentCopilotTurns(events, [
      { turnId: "request_1", eventId: "u1" },
      { turnId: "request_2", eventId: "nope" },
      { turnId: "request_3", eventId: null },
    ]);
    expect(ids(matched(r.turns[0]!).events)).toEqual(["a1"]);
    for (const t of r.turns.slice(1)) {
      expect(t.matched).toBe(false);
      expect(t.matched ? "" : t.reason).not.toBe("");
    }
  });

  it("does not match an id that belongs to a non-user.message event", () => {
    const r = segmentCopilotTurns([user("u1"), ev("a1", "assistant.message")], [{ turnId: "request_1", eventId: "a1" }]);
    expect(r.turns[0]!.matched).toBe(false);
    expect(ids(r.sessionEvents)).toEqual(["u1", "a1"]);
  });

  it("treats steering messages as their own turns", () => {
    const events = [user("u1"), ev("a1", "assistant.message"), user("u2", { delivery: "steering" }), ev("a2", "assistant.message")];
    const r = segmentCopilotTurns(events, [
      { turnId: "request_1", eventId: "u1" },
      { turnId: "request_2", eventId: "u2" },
    ]);
    expect(ids(matched(r.turns[0]!).events)).toEqual(["a1"]);
    expect(ids(matched(r.turns[1]!).events)).toEqual(["a2"]);
  });

  it("does not split at an agent-sourced user.message and keeps subagent events distinguishable", () => {
    const sub = user("ua", { source: "agent-0001" }, "agent-0001");
    const subCall = ev("sc", "tool.execution_start", { agentId: "agent-0001" });
    const events = [user("u1"), ev("a1", "assistant.message"), sub, subCall, ev("a2", "assistant.message")];
    const r = segmentCopilotTurns(events, [{ turnId: "request_1", eventId: "u1" }]);
    const t = matched(r.turns[0]!);
    expect(ids(t.events)).toEqual(["a1", "ua", "sc", "a2"]);
    expect(t.events.filter(isSubagentEvent).map((e) => e.id)).toEqual(["ua", "sc"]);
  });

  it("refuses a turn whose event id names an agent-sourced user.message", () => {
    const sub = user("ua", { source: "agent-0001" });
    const r = segmentCopilotTurns([user("u1"), sub], [{ turnId: "request_1", eventId: "ua" }]);
    expect(r.turns[0]!.matched).toBe(false);
  });

  it("cuts turns in file order even when the turn rows are out of order", () => {
    const events = [user("u1"), ev("a1", "x"), user("u2"), ev("a2", "x")];
    const r = segmentCopilotTurns(events, [
      { turnId: "request_2", eventId: "u2" },
      { turnId: "request_1", eventId: "u1" },
    ]);
    expect(r.turns.map((t) => t.turnId)).toEqual(["request_2", "request_1"]);
    expect(ids(matched(r.turns[0]!).events)).toEqual(["a2"]);
    expect(ids(matched(r.turns[1]!).events)).toEqual(["a1"]);
  });

  it("returns only unmatched turns and all events as session-level for an empty log", () => {
    const r = segmentCopilotTurns([], [{ turnId: "request_1", eventId: "u1" }]);
    expect(r.sessionEvents).toEqual([]);
    expect(r.turns[0]!.matched).toBe(false);
  });
});

describe("segmentCopilotTurns on the captured fixtures", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/agent-host/copilot-cli");
  const rows = JSON.parse(readFileSync(join(root, "rows.json"), "utf8")) as {
    sdkSessionIds: Record<string, string>;
    turns: Record<string, { id: string; event_id: string | null }[]>;
  };
  // Local parse: the real reader is a separate unit.
  function load(key: string): CopilotEvent[] {
    const file = join(root, "session-state", rows.sdkSessionIds[key]!, "events.jsonl");
    return readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line) => {
        try {
          const o = JSON.parse(line) as Record<string, unknown>;
          return [
            {
              id: o.id as string,
              type: o.type as string,
              parentId: (o.parentId as string) ?? null,
              timestamp: (o.timestamp as string) ?? null,
              agentId: (o.agentId as string) ?? null,
              data: (o.data as Record<string, unknown>) ?? {},
            },
          ];
        } catch {
          return [];
        }
      });
  }
  const turnsFor = (key: string) => rows.turns[key]!.map((t) => ({ turnId: t.id, eventId: t.event_id }));

  it("segments the steering + abort + subagent session", () => {
    const r = segmentCopilotTurns(load("steeringAbortSubagent"), turnsFor("steeringAbortSubagent"));
    expect(r.turns.map((t) => t.matched)).toEqual([true, true, true, true, false]);
    const first = matched(r.turns[0]!);
    // the subagent's prompt stays inside turn 1, flagged by agentId
    expect(first.events.some((e) => e.type === "user.message" && e.agentId !== null)).toBe(true);
    expect(matched(r.turns[2]!).userMessage.data.delivery).toBe("steering");
    expect(r.sessionEvents.map((e) => e.type)).toContain("session.start");
  });

  it("segments the normal session into two turns", () => {
    const r = segmentCopilotTurns(load("normal"), turnsFor("normal"));
    expect(r.turns.every((t) => t.matched)).toBe(true);
  });
});
