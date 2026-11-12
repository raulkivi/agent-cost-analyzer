// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectChildSessionRefs } from "./child-session-refs.js";
import { readMainJsonlFile, type JsonlEnvelope } from "./main-jsonl-reader.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/jsonl/subagents");

const userMessage = (ts: number): JsonlEnvelope => ({ type: "user_message", ts });
const ref = (attrs: Record<string, unknown>, extra: Partial<JsonlEnvelope> = {}): JsonlEnvelope => ({
  type: "child_session_ref",
  ts: 1,
  attrs,
  ...extra,
});

describe("collectChildSessionRefs", () => {
  it("places a ref on the log turn of the user_message before it (0-based, positional)", () => {
    const refs = collectChildSessionRefs([
      userMessage(1),
      ref({ childSessionId: "call_a", childLogFile: "runSubagent-Explore-call_a.jsonl", label: "runSubagent-Explore" }, { ts: 5 }),
      userMessage(10),
      { type: "llm_request" },
      ref({ childSessionId: "call_b", childLogFile: "searchSubagent-call_b.jsonl", label: "searchSubagent" }, { ts: 15 }),
    ]);

    expect(refs).toEqual([
      {
        logTurnIndex: 0,
        childSessionId: "call_a",
        childLogFile: "runSubagent-Explore-call_a.jsonl",
        label: "runSubagent-Explore",
        ts: 5,
        parentSpanId: null,
      },
      {
        logTurnIndex: 1,
        childSessionId: "call_b",
        childLogFile: "searchSubagent-call_b.jsonl",
        label: "searchSubagent",
        ts: 15,
        parentSpanId: null,
      },
    ]);
  });

  it("carries parentSpanId when the ref has one and null when it has none", () => {
    const attrs = { childSessionId: "call_a", childLogFile: "f.jsonl", label: "searchSubagent" };
    const [withSpan, withoutSpan] = collectChildSessionRefs([
      userMessage(1),
      ref(attrs, { parentSpanId: "span-tool" }),
      ref(attrs),
    ]);

    expect(withSpan?.parentSpanId).toBe("span-tool");
    expect(withoutSpan?.parentSpanId).toBeNull();
  });

  it("gives a ref before the first user_message no log turn, so it can't be placed", () => {
    const [early] = collectChildSessionRefs([
      ref({ childSessionId: "call_a", childLogFile: "f.jsonl", label: "runSubagent-Explore" }),
      userMessage(1),
    ]);

    expect(early?.logTurnIndex).toBeNull();
  });

  it("keeps a ref with a missing or non-string field, with that field null, instead of dropping it", () => {
    const refs = collectChildSessionRefs([
      userMessage(1),
      ref({ childSessionId: 7, label: "runSubagent-Explore" }),
      { type: "child_session_ref" },
    ]);

    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ childSessionId: null, childLogFile: null, label: "runSubagent-Explore", ts: 1 });
    expect(refs[1]).toMatchObject({ childSessionId: null, childLogFile: null, label: null, ts: null });
  });

  it("ignores other event types and returns [] without refs", () => {
    expect(collectChildSessionRefs([userMessage(1), { type: "llm_request" }])).toEqual([]);
    expect(collectChildSessionRefs([])).toEqual([]);
  });

  it("reads the refs of the run-and-search fixture, with and without parentSpanId", async () => {
    const { envelopes } = await readMainJsonlFile(path.join(fixturesDir, "run-and-search", "main.jsonl"));

    const refs = collectChildSessionRefs(envelopes);

    expect(refs.map((r) => [r.logTurnIndex, r.childSessionId, r.parentSpanId])).toEqual([
      [0, "call_fixturerun1", "span-tool-run"],
      [1, "call_fixturesearch1", null],
    ]);
  });

  it("finds the ref of the ref-before-first-turn fixture unplaceable", async () => {
    const { envelopes } = await readMainJsonlFile(path.join(fixturesDir, "ref-before-first-turn", "main.jsonl"));

    expect(collectChildSessionRefs(envelopes).map((r) => r.logTurnIndex)).toEqual([null]);
  });
});
