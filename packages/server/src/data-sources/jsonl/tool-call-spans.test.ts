// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_ARGS_SUMMARY_LENGTH } from "../../services/tool-audit/args-summary.js";
import { classicAuditDir } from "../../test-support/subagent-audit-fixtures.js";
import { projectAuditAttrs } from "./audit-attrs-projector.js";
import type { JsonlEnvelope } from "./main-jsonl-reader.js";
import { readToolCallRecordsByLogTurn, toolCallSpanRecord } from "./tool-call-spans.js";

function span(overrides: Partial<Omit<JsonlEnvelope, "attrs">> & { attrs?: Record<string, unknown> } = {}): JsonlEnvelope {
  return {
    type: "tool_call",
    name: "read_file",
    spanId: "span-1",
    ts: 1_791_000_000_000,
    dur: 120,
    status: "ok",
    ...overrides,
    attrs: projectAuditAttrs(overrides.attrs ?? { args: '{"filePath":"/workspace/example/a.ts"}' }),
  };
}

describe("toolCallSpanRecord", () => {
  it("maps an ok span to a success with duration, id, kind and args", () => {
    expect(toolCallSpanRecord(span())).toMatchObject({
      id: "span-1",
      name: "read_file",
      kind: "file-read",
      argsSummary: "/workspace/example/a.ts",
      durationMs: 120,
      startedAt: new Date(1_791_000_000_000).toISOString(),
      outcome: { status: "success" },
    });
  });

  it("maps an error span to an error classified from attrs.error", () => {
    const record = toolCallSpanRecord(span({ status: "error", attrs: { args: "{}", error: "ENOENT: no such file or directory" } }));
    expect(record.outcome).toMatchObject({ status: "error", failureCategory: "file-not-found" });
  });

  it("maps the Canceled text to canceled with no failure category (D14)", () => {
    for (const text of ["Canceled", " canceled\n"]) {
      const record = toolCallSpanRecord(span({ status: "error", attrs: { args: "{}", error: text } }));
      expect(record.outcome).toEqual({ status: "canceled" });
    }
  });

  it("keeps an error span without text a failure", () => {
    const record = toolCallSpanRecord(span({ status: "error", attrs: { args: "{}" } }));
    expect(record.outcome).toMatchObject({ status: "error", failureCategory: "unclassified" });
  });

  it("maps an unrecognized or absent status to unknown with a reason", () => {
    for (const status of ["weird", undefined]) {
      const record = toolCallSpanRecord({ ...span(), status });
      expect(record.outcome).toEqual({ status: "unknown", reason: "unrecognized span status" });
    }
  });

  it("omits durationMs when dur is not a finite number", () => {
    expect(toolCallSpanRecord({ ...span(), dur: undefined })).not.toHaveProperty("durationMs");
  });

  it("bounds the summary of a 50 KB args string", () => {
    const args = JSON.stringify({ filePath: "/workspace/example/big.ts", content: "x".repeat(50_000) });
    const record = toolCallSpanRecord(span({ name: "create_file", attrs: { args } }));
    expect(record.argsSummary.length).toBeLessThanOrEqual(MAX_ARGS_SUMMARY_LENGTH);
  });

  it("keeps shell command and program for a shell tool, bounded when args were cut", () => {
    const short = toolCallSpanRecord(span({ name: "run_in_terminal", attrs: { args: '{"command":"npm test","explanation":"run"}' } }));
    expect(short.shell).toEqual({ command: "npm test", program: "npm" });
    expect(short.argsSummary).toBe("npm test");

    const args = JSON.stringify({ command: `echo ${"a".repeat(50_000)}`, explanation: "x" });
    const long = toolCallSpanRecord(span({ name: "run_in_terminal", attrs: { args } }));
    expect(long.shell?.program).toBe("echo");
    expect(long.shell?.command.length).toBeLessThanOrEqual(MAX_ARGS_SUMMARY_LENGTH);
  });

  it("copes with args that are not JSON", () => {
    expect(toolCallSpanRecord(span({ attrs: { args: "not json" } })).argsSummary).toBe("not json");
  });

  it("never carries the result", () => {
    const record = toolCallSpanRecord(span({ attrs: { args: "{}", result: "TOP SECRET RESULT" } }));
    expect(JSON.stringify(record)).not.toContain("TOP SECRET");
  });

  it("names a span without a name unknown tool", () => {
    expect(toolCallSpanRecord({ ...span(), name: undefined }).name).toBe("unknown tool");
  });
});

describe("readToolCallRecordsByLogTurn", () => {
  const caseDir = path.join(classicAuditDir, "error-categories");

  it("returns one list per user_message turn with the file's own spans only", async () => {
    const byTurn = await readToolCallRecordsByLogTurn(path.join(caseDir, "main.jsonl"));
    expect(byTurn).toHaveLength(1);
    expect(byTurn[0]?.map((call) => call.name)).toEqual(["runSubagent"]);
    expect(byTurn[0]?.[0]?.outcome?.status).toBe("success");
  });

  it("maps the fixture's error texts, one per wording (D14 canceled included)", async () => {
    const [calls] = await readToolCallRecordsByLogTurn(path.join(caseDir, "runSubagent-Explore-call_auditerr1.jsonl"));
    expect(calls?.map((call) => call.outcome?.status)).toEqual([
      "success", "error", "error", "error", "error", "error", "canceled", "error", "success",
    ]);
    expect(calls?.every((call) => call.durationMs === 120)).toBe(true);
  });

  it("reads a missing file as no turns", async () => {
    expect(await readToolCallRecordsByLogTurn(path.join(classicAuditDir, "nope", "main.jsonl"))).toEqual([]);
  });
});
