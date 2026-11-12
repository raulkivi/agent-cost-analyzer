// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  aggregateSessions,
  classifySubagentFileName,
  nanoAiuToAiCredits,
  parseJsonlLines,
  summarizeSession,
} from "./subagent-spend-lib.mjs";

const line = (o: unknown) => JSON.stringify(o);
const req = (nano: unknown, model = "m1", debugName = "x") =>
  line({
    type: "llm_request",
    attrs: {
      inputTokens: 10,
      outputTokens: 5,
      copilotUsageNanoAiu: nano,
      model,
      debugName,
    },
  });

describe("nanoAiuToAiCredits", () => {
  it("divides by one billion", () => {
    expect(nanoAiuToAiCredits(2_500_000_000)).toBe(2.5);
  });
});

describe("classifySubagentFileName", () => {
  it("recognises both kinds", () => {
    expect(classifySubagentFileName("runSubagent-Explore-call_1.jsonl")).toBe(
      "runSubagent",
    );
    expect(classifySubagentFileName("searchSubagent-call_1.jsonl")).toBe(
      "searchSubagent",
    );
  });
  it("rejects other names", () => {
    expect(classifySubagentFileName("main.jsonl")).toBeNull();
    expect(classifySubagentFileName("runSubagent-x.txt")).toBeNull();
  });
});

describe("parseJsonlLines", () => {
  it("skips blank and malformed lines and counts them", () => {
    const r = parseJsonlLines(`${line({ a: 1 })}\n\nnot json\n{"b":`);
    expect(r.events).toEqual([{ a: 1 }]);
    expect(r.malformed).toBe(2);
  });
});

describe("summarizeSession", () => {
  const ref = (file: unknown) =>
    line({ type: "child_session_ref", attrs: { childLogFile: file } });

  it("sums subagent credits and keeps main credits apart", () => {
    const s = summarizeSession({
      mainText: [req(1_000_000_000), ref("runSubagent-A-c1.jsonl")].join("\n"),
      files: [
        {
          name: "runSubagent-A-c1.jsonl",
          text: [req(2_000_000_000, "mx"), req(500_000_000, "mx")].join("\n"),
        },
      ],
    });
    expect(s.mainAiCredits).toBe(1);
    expect(s.missingAiCredits).toBe(2.5);
    expect(s.runsByKind).toEqual({ runSubagent: 1, searchSubagent: 0 });
    expect(s.danglingRefs).toBe(0);
    expect(s.orphanFiles).toBe(0);
    expect(s.models).toEqual({ mx: 2 });
    expect(s.requestsWithoutCredits).toBe(0);
  });

  it("counts dangling refs, orphan files and unsafe ref names", () => {
    const s = summarizeSession({
      mainText: [ref("searchSubagent-gone.jsonl"), ref("../x.jsonl")].join(
        "\n",
      ),
      files: [{ name: "searchSubagent-orph.jsonl", text: req(0) }],
    });
    expect(s.danglingRefs).toBe(2);
    expect(s.orphanFiles).toBe(1);
    expect(s.runsByKind.searchSubagent).toBe(1);
    expect(s.missingAiCredits).toBe(0);
  });

  it("counts requests without numeric credits and nested refs", () => {
    const s = summarizeSession({
      mainText: "",
      files: [
        {
          name: "runSubagent-A-c1.jsonl",
          text: [req("n/a"), ref("runSubagent-B-c2.jsonl")].join("\n"),
        },
      ],
    });
    expect(s.requestsWithoutCredits).toBe(1);
    expect(s.nestedRefs).toBe(1);
  });

  it("flags subagent-named requests inside main.jsonl", () => {
    const s = summarizeSession({
      mainText: req(1, "m", "tool/runSubagent-Explore"),
      files: [],
    });
    expect(s.mainSubagentNamedRequests).toBe(1);
  });
});

describe("aggregateSessions", () => {
  it("totals and takes the max files per session", () => {
    const mk = (n: number, credits: number) =>
      summarizeSession({
        mainText: "",
        files: Array.from({ length: n }, (_, i) => ({
          name: `runSubagent-A-c${i}.jsonl`,
          text: req(credits * 1e9),
        })),
      });
    const t = aggregateSessions([mk(2, 1), mk(1, 3), mk(0, 0)]);
    expect(t.sessions).toBe(3);
    expect(t.sessionsWithSubagentFiles).toBe(2);
    expect(t.maxFilesPerSession).toBe(2);
    expect(t.missingAiCredits).toBe(5);
    expect(t.runsByKind.runSubagent).toBe(3);
  });
});
