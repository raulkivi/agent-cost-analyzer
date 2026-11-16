// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { toolCallOriginSchema } from "./tool-call-origin.js";
import { toolCallRecordSchema } from "./tool-call-record.js";
import { subagentLabelSchema, subagentRunIdSchema } from "./subagent-run-ids.js";
import * as turnUsage from "./turn-usage.js";

const subagent = { kind: "subagent", runId: "child-1", label: "runSubagent-Explore", depth: 1 } as const;

describe("toolCallOriginSchema", () => {
  it("accepts the main agent", () => {
    expect(toolCallOriginSchema.parse({ kind: "main" })).toEqual({ kind: "main" });
  });

  it("accepts a subagent with and without its optional fields", () => {
    expect(toolCallOriginSchema.parse(subagent)).toEqual(subagent);
    const nested = { ...subagent, depth: 2, parentRunId: "parent_1", startedByCallId: "toolu_01:a.b" };
    expect(toolCallOriginSchema.parse(nested)).toEqual(nested);
  });

  it("accepts the Claude Code and search labels", () => {
    for (const label of ["Agent", "Agent-Explore", "searchSubagent"]) {
      expect(toolCallOriginSchema.parse({ ...subagent, label }).kind).toBe("subagent");
    }
  });

  it("accepts the Agent Host labels", () => {
    for (const label of ["task", "task-general-purpose", "search_code_subagent"]) {
      expect(toolCallOriginSchema.parse({ ...subagent, label }).kind).toBe("subagent");
    }
  });

  it.each(["task-<img>", "task-../x", "search_code_subagent-x"])("rejects the Agent Host label %s", (label) => {
    expect(() => toolCallOriginSchema.parse({ ...subagent, label })).toThrow();
  });

  it.each([0, 9, 1.5, -1])("rejects depth %s", (depth) => {
    expect(() => toolCallOriginSchema.parse({ ...subagent, depth })).toThrow();
  });

  it.each([1, 8])("accepts the depth bound %s", (depth) => {
    expect(toolCallOriginSchema.parse({ ...subagent, depth }).kind).toBe("subagent");
  });

  it.each([
    ["a label with markup", { label: "runSubagent-<img onerror=x>" }],
    ["a label with a path", { label: "runSubagent-../x" }],
    ["an id with a path", { runId: "../etc/passwd" }],
    ["an id over the cap", { runId: "a".repeat(129) }],
    ["a parent id with markup", { parentRunId: "<b>" }],
    ["a starting call id with a space", { startedByCallId: "a b" }],
    ["an unknown kind", { kind: "other" }],
  ])("rejects %s", (_name, patch) => {
    expect(() => toolCallOriginSchema.parse({ ...subagent, ...patch })).toThrow();
  });

  it("is absent on a record that predates it, which means the main agent", () => {
    const record = { name: "read_file", argsSummary: "read package.json" };
    expect(toolCallRecordSchema.parse(record)).toEqual(record);
    expect(toolCallRecordSchema.parse({ ...record, origin: subagent }).origin).toEqual(subagent);
  });
});

describe("shared run id and label schemas", () => {
  it("are the same objects the cost side exports", () => {
    expect(turnUsage.subagentRunIdSchema).toBe(subagentRunIdSchema);
    expect(turnUsage.subagentLabelSchema).toBe(subagentLabelSchema);
  });
});
