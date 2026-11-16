// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolCallOriginSchema } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";
import { isAgentHostEventTypeUsed } from "./agent-host-session-builder.js";
import { buildAgentHostTurnContent } from "./agent-host-turn-content-builder.js";
import {
  indexSubagentStarts,
  originOf,
  orderByOrigin,
  type OriginDraft,
} from "./agent-host-tool-call-origin.js";
import type { MatchedTurn } from "./copilot-turn-segmenter.js";

const draft = (id: string, name: string, agentId: string | null, parentToolCallId?: string): OriginDraft => ({
  id,
  name,
  agentId,
  ...(parentToolCallId ? { parentToolCallId } : {}),
});
const byIdOf = (drafts: OriginDraft[]) => new Map(drafts.map((d) => [d.id, d]));
const started = (pairs: [string, string][]) => new Map(pairs);

describe("originOf", () => {
  it("is main for a call with no agentId", () => {
    const main = draft("m1", "view", null);
    expect(originOf(main, byIdOf([main]), started([]))).toEqual({ kind: "main" });
  });

  it("gives depth 1 for a call of a run a main call started, labeled from agentName", () => {
    const drafts = [draft("T1", "task", null), draft("U1", "view", "agent-1", "T1")];
    expect(originOf(drafts[1]!, byIdOf(drafts), started([["T1", "explore"]]))).toEqual({
      kind: "subagent",
      runId: "T1",
      label: "task-explore",
      depth: 1,
      startedByCallId: "T1",
    });
  });

  it("gives depth 2 with the outer run as parentRunId", () => {
    const drafts = [
      draft("T1", "task", null),
      draft("T2", "task", "agent-1", "T1"),
      draft("G1", "grep_search", "agent-2", "T2"),
    ];
    const origin = originOf(drafts[2]!, byIdOf(drafts), started([["T1", "explore"], ["T2", "general-purpose"]]));
    expect(origin).toEqual({
      kind: "subagent",
      runId: "T2",
      label: "task-general-purpose",
      depth: 2,
      parentRunId: "T1",
      startedByCallId: "T2",
    });
  });

  describe("label sources", () => {
    const labelFor = (toolName: string, names: [string, string][]) => {
      const drafts = [draft("T1", toolName, null), draft("U1", "view", "a", "T1")];
      const origin = originOf(drafts[1]!, byIdOf(drafts), started(names));
      return origin.kind === "subagent" ? origin.label : undefined;
    };
    it("uses task-<agentName> from subagent.started", () => {
      expect(labelFor("task", [["T1", "code-review"]])).toBe("task-code-review");
    });
    it("uses search_code_subagent for that starting tool, whatever agentName says", () => {
      expect(labelFor("search_code_subagent", [["T1", "search-code"]])).toBe("search_code_subagent");
    });
    it("falls back to the starting tool's name without a subagent.started", () => {
      expect(labelFor("task", [])).toBe("task");
      expect(labelFor("search_code_subagent", [])).toBe("search_code_subagent");
    });
    it("drops an agentName the label pattern would reject", () => {
      expect(labelFor("task", [["T1", "<img onerror=x>"]])).toBe("task");
    });
  });

  it("lists a chain that never reaches a call as depth 1 from its own parentToolCallId, with no starting call", () => {
    const orphan = draft("U1", "view", "agent-1", "gone");
    expect(originOf(orphan, byIdOf([orphan]), started([]))).toEqual({
      kind: "subagent",
      runId: "gone",
      label: "task",
      depth: 1,
    });
  });

  it("falls back to the agentId when a subagent call names no parent", () => {
    const orphan = draft("U1", "view", "agent-1");
    expect(originOf(orphan, byIdOf([orphan]), started([]))).toMatchObject({ runId: "agent-1", depth: 1 });
  });

  it("treats a cycle as a broken chain", () => {
    const drafts = [draft("A", "task", "x", "B"), draft("B", "task", "y", "A")];
    const origin = originOf(drafts[0]!, byIdOf(drafts), started([]));
    expect(origin).toMatchObject({ kind: "subagent", runId: "B", depth: 1 });
    expect(origin).not.toHaveProperty("startedByCallId");
  });

  it("caps the depth at 8", () => {
    const drafts = [draft("c0", "task", null)];
    for (let i = 1; i <= 10; i++) drafts.push(draft(`c${i}`, "task", `a${i}`, `c${i - 1}`));
    const origin = originOf(drafts[10]!, byIdOf(drafts), started([]));
    expect(origin).toMatchObject({ kind: "subagent", depth: 8 });
    expect(toolCallOriginSchema.safeParse(origin).success).toBe(true);
  });

  it("makes a call id outside the run id pattern valid", () => {
    const drafts = [draft("call.1:x", "task", null), draft("U1", "view", "a", "call.1:x")];
    const origin = originOf(drafts[1]!, byIdOf(drafts), started([]));
    expect(toolCallOriginSchema.safeParse(origin).success).toBe(true);
  });
});

describe("indexSubagentStarts", () => {
  const event = (type: string, data: Record<string, unknown>): CopilotEvent => ({
    id: "e",
    type,
    parentId: null,
    timestamp: null,
    agentId: null,
    data,
  });
  it("maps toolCallId to agentName and ignores other events and malformed data", () => {
    const index = indexSubagentStarts([
      event("subagent.started", { toolCallId: "T1", agentName: "explore" }),
      event("subagent.started", { toolCallId: "T2" }),
      event("subagent.started", { agentName: "x" }),
      event("subagent.completed", { toolCallId: "T3", agentName: "y" }),
    ]);
    expect([...index]).toEqual([["T1", "explore"]]);
  });
});

describe("orderByOrigin", () => {
  it("puts main calls first in source order, then each run's calls grouped in run start order", () => {
    const items = [
      { id: "m1", origin: undefined },
      { id: "a1", origin: { kind: "subagent", runId: "R1" } },
      { id: "b1", origin: { kind: "subagent", runId: "R2" } },
      { id: "m2", origin: undefined },
      { id: "a2", origin: { kind: "subagent", runId: "R1" } },
      { id: "b2", origin: { kind: "subagent", runId: "R2" } },
    ] as const;
    expect(orderByOrigin([...items]).map((i) => i.id)).toEqual(["m1", "m2", "a1", "a2", "b1", "b2"]);
  });
});

describe("event type kept by the log cache", () => {
  it("includes subagent.started", () => {
    expect(isAgentHostEventTypeUsed("subagent.started")).toBe(true);
  });
});

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/agent-host/subagent-audit/session-state/5d1a0010-aaaa-4bbb-8ccc-000000000010/events.jsonl",
);

function fixtureTurn(): MatchedTurn {
  const events = readFileSync(FIXTURE, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const raw = JSON.parse(l) as Record<string, unknown>;
      return {
        id: raw.id as string,
        type: raw.type as string,
        parentId: (raw.parentId as string) ?? null,
        timestamp: (raw.timestamp as string) ?? null,
        agentId: (raw.agentId as string) ?? null,
        data: (raw.data as Record<string, unknown>) ?? {},
      } satisfies CopilotEvent;
    });
  const first = events.findIndex((e) => e.type === "user.message" && e.agentId === null);
  return { turnId: "t", matched: true, userMessage: events[first]!, events: events.slice(first + 1) };
}

describe("buildAgentHostTurnContent over the subagent-audit fixture", () => {
  const { toolCalls } = buildAgentHostTurnContent(fixtureTurn());
  const originOfId = (id: string) => toolCalls.find((c) => c.id === id)?.origin;

  it("leaves main calls without an origin", () => {
    expect(originOfId("toolu_T1")).toBeUndefined();
    expect(originOfId("toolu_S1")).toBeUndefined();
  });

  it("marks run 1, the depth-2 run and the search run", () => {
    expect(originOfId("toolu_U1")).toMatchObject({ runId: "toolu_T1", label: "task-explore", depth: 1 });
    expect(originOfId("toolu_R1")).toMatchObject({ runId: "toolu_T1", depth: 1 });
    expect(originOfId("toolu_G1")).toMatchObject({
      runId: "toolu_T2",
      label: "task-general-purpose",
      depth: 2,
      parentRunId: "toolu_T1",
    });
    expect(originOfId("toolu_S2")).toMatchObject({ runId: "toolu_S1", label: "search_code_subagent", depth: 1 });
  });

  it("lists main calls first, then runs in start order, each run's calls together", () => {
    const origins = toolCalls.map((c) => (c.origin?.kind === "subagent" ? c.origin.runId : "main"));
    const firstSubagent = origins.findIndex((o) => o !== "main");
    expect(origins.slice(0, firstSubagent).every((o) => o === "main")).toBe(true);
    expect(origins.slice(firstSubagent).every((o) => o !== "main")).toBe(true);
    const runOrder = [...new Set(origins.slice(firstSubagent))];
    expect(runOrder).toEqual(["toolu_T1", "toolu_T2", "toolu_S1"]);
    for (const run of runOrder) {
      const idx = origins.flatMap((o, i) => (o === run ? [i] : []));
      expect(idx.at(-1)! - idx[0]! + 1).toBe(idx.length);
    }
  });

  it("gives every origin a schema-valid shape", () => {
    for (const call of toolCalls) {
      if (call.origin) expect(toolCallOriginSchema.safeParse(call.origin).success).toBe(true);
    }
  });
});
