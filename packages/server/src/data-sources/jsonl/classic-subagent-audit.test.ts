// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { subagentRunGapSchema, toolCallRecordSchema, type ToolCallRecord } from "@agent-cost-analyzer/domain";
import { afterEach, describe, expect, it } from "vitest";
import { canBlockReads, classicAuditDir, copyCaseWithUnreadableFile } from "../../test-support/subagent-audit-fixtures.js";
import { classicSubagentAudit } from "../../test-support/classic-subagent-audit.js";
import {
  SUBAGENT_LOG_NAME_REJECTED_REASON,
  SUBAGENT_LOG_NOT_REGULAR_FILE_REASON,
  SUBAGENT_LOG_READ_FAILED_REASON,
  SUBAGENT_RUN_UNPLACEABLE_REASON,
} from "./subagent-attribution.js";
import { SUBAGENT_LOG_NAME } from "./subagent-log-path.js";
import {
  BEYOND_READ_DEPTH_REASON,
  missingSubagentLogReason,
  NESTED_SUBAGENT_NOT_READ_REASON,
  TOO_MANY_SUBAGENT_LOGS_REASON,
  UNLOGGED_SUBAGENT_TOOL_REASON,
} from "./subagent-tool-call-reasons.js";

// Step 10.20 plan §6, every classic row, through the real attribution, the
// plan, the reader and the gap mapping (ST7). Each `it` names its row.
const here = path.dirname(fileURLToPath(import.meta.url));
const usageFixtures = path.resolve(here, "../../../fixtures/jsonl/subagents");
const auditCase = (name: string) => path.join(classicAuditDir, name);

const subagentCalls = (audit: { callsByLogTurn: ToolCallRecord[][] }, turn = 0) => audit.callsByLogTurn[turn] ?? [];
const runOf = (call: ToolCallRecord) => (call.origin?.kind === "subagent" ? call.origin.runId : undefined);

describe("§6 classic rows", () => {
  const scratch: string[] = [];
  afterEach(() => {
    scratch.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });
  const copyCase = (source: string): string => {
    const dir = mkdtempSync(path.join(tmpdir(), "classic-audit-"));
    scratch.push(dir);
    cpSync(source, dir, { recursive: true });
    return dir;
  };

  it("row: run read, every span with a status: calls listed with outcomes, nothing unread", async () => {
    const audit = await classicSubagentAudit(auditCase("error-categories"));

    expect(subagentCalls(audit)).toHaveLength(9);
    expect(audit.unread).toEqual([]);
    expect(audit.gapsByLogTurn.flat()).toEqual([]);
    expect(subagentCalls(audit).map((call) => call.outcome?.status)).toEqual([
      "success",
      "error",
      "error",
      "error",
      "error",
      "error",
      "canceled",
      "error",
      "success",
    ]);
    for (const call of subagentCalls(audit)) {
      expect(call.origin).toEqual({
        kind: "subagent",
        runId: "call_auditerr1",
        label: "runSubagent-Explore",
        depth: 1,
        startedByCallId: "span-tool-run",
      });
      expect(toolCallRecordSchema.safeParse(call).success).toBe(true);
    }
  });

  it("row: a span status other than ok or error: that call's outcome is unknown with a reason", async () => {
    const dir = copyCase(auditCase("error-categories"));
    const file = path.join(dir, "runSubagent-Explore-call_auditerr1.jsonl");
    const lines = readFileSync(file, "utf8").split("\n");
    writeFileSync(file, lines.map((line) => (line.includes('"name":"file_search"') ? line.replace('"status":"ok"', '"status":"weird"') : line)).join("\n"));

    const audit = await classicSubagentAudit(dir);

    const unknown = subagentCalls(audit).filter((call) => call.outcome?.status === "unknown");
    expect(unknown).toHaveLength(1);
    expect(unknown[0].outcome).toMatchObject({ reason: "unrecognized span status" });
  });

  it("row: child log missing: no calls, a gap with the run's label and the tool-call sentence", async () => {
    const audit = await classicSubagentAudit(auditCase("missing-log"));

    expect(subagentCalls(audit)).toEqual([]);
    expect(audit.gapsByLogTurn[0]).toEqual([
      expect.objectContaining({
        runId: "call_auditmissing1",
        label: "runSubagent-Explore",
        depth: 1,
        reason: missingSubagentLogReason("runSubagent-Explore"),
      }),
    ]);
    expect(subagentRunGapSchema.safeParse(audit.gapsByLogTurn[0][0]).success).toBe(true);
    expect(audit.gapsByLogTurn[0][0].reason).toBe(
      "The subagent log `runSubagent-Explore` this turn started is missing, so its tool calls are unknown.",
    );
  });

  it("row: name rejected: not read, 10.19's reason", async () => {
    const audit = await classicSubagentAudit(path.join(usageFixtures, "traversal-ref"));

    expect(subagentCalls(audit)).toEqual([]);
    expect(audit.gapsByLogTurn[0]).toEqual([expect.objectContaining({ reason: SUBAGENT_LOG_NAME_REJECTED_REASON })]);
    expect(subagentRunGapSchema.safeParse(audit.gapsByLogTurn[0][0]).success).toBe(true);
  });

  it("row: not a regular file (a symbolic link): not read, 10.19's reason", async () => {
    const dir = copyCase(auditCase("shared-span-id"));
    const file = path.join(dir, "runSubagent-Explore-call_auditshared1.jsonl");
    writeFileSync(path.join(dir, "real.jsonl"), readFileSync(file));
    unlinkSync(file);
    symlinkSync(path.join(dir, "real.jsonl"), file);

    const audit = await classicSubagentAudit(dir);

    expect(subagentCalls(audit)).toEqual([]);
    expect(audit.gapsByLogTurn[0]).toEqual([expect.objectContaining({ reason: SUBAGENT_LOG_NOT_REGULAR_FILE_REASON })]);
  });

  it.skipIf(!canBlockReads())("row: unreadable: not read, 10.19's reason", async () => {
    const copy = copyCaseWithUnreadableFile("unreadable-log", "runSubagent-Explore-call_auditunread1.jsonl");
    try {
      const audit = await classicSubagentAudit(copy.dir);

      expect(subagentCalls(audit)).toEqual([]);
      expect(audit.gapsByLogTurn[0]).toEqual([expect.objectContaining({ runId: "call_auditunread1", reason: SUBAGENT_LOG_READ_FAILED_REASON })]);
    } finally {
      copy.cleanup();
    }
  });

  it("row: 0 parsable lines: not read, 10.19's reason (no readable events)", async () => {
    const dir = copyCase(auditCase("shared-span-id"));
    writeFileSync(path.join(dir, "runSubagent-Explore-call_auditshared1.jsonl"), "not json\nstill not json\n");

    const audit = await classicSubagentAudit(dir);

    expect(subagentCalls(audit)).toEqual([]);
    expect(audit.gapsByLogTurn[0]).toEqual([
      expect.objectContaining({ runId: "call_auditshared1", reason: "The subagent log has no readable events." }),
    ]);
  });

  it("row: folder over 200 subagent files: every run unread, \"too many subagent logs to read\"", async () => {
    const dir = copyCase(auditCase("shared-span-id"));
    for (let n = 0; n <= 200; n++) {
      writeFileSync(path.join(dir, `searchSubagent-call_filler${n}.jsonl`), "");
    }

    const audit = await classicSubagentAudit(dir);

    expect(subagentCalls(audit)).toEqual([]);
    expect(audit.gapsByLogTurn[0]).toEqual([expect.objectContaining({ runId: "call_auditshared1", reason: TOO_MANY_SUBAGENT_LOGS_REASON })]);
    expect(TOO_MANY_SUBAGENT_LOGS_REASON).toContain("too many subagent logs to read");
  });

  it("row: orphan placed by time: calls listed, origin as usual, no starting call", async () => {
    const audit = await classicSubagentAudit(path.join(usageFixtures, "orphan-by-time"));

    expect(subagentCalls(audit, 1)).toHaveLength(1);
    expect(subagentCalls(audit, 1)[0].origin).toEqual({
      kind: "subagent",
      runId: "call_fixtureorphan1",
      label: "runSubagent-Plan",
      depth: 1,
    });
    expect(audit.unread).toEqual([]);
  });

  it("row: orphan that can't be placed: no turn, calls not listed, an unread run of the session", async () => {
    const audit = await classicSubagentAudit(path.join(usageFixtures, "orphan-unplaceable"));

    expect(audit.callsByLogTurn.flat()).toEqual([]);
    expect(audit.gapsByLogTurn.flat()).toEqual([]);
    expect(audit.unread).toEqual([{ logTurn: null, depth: 1, reason: SUBAGENT_RUN_UNPLACEABLE_REASON }]);
  });

  it("row: nested ref in a child file: the outer run is read, the inner run is unread \"nested subagents are not read\"", async () => {
    const audit = await classicSubagentAudit(auditCase("nested-ref"));

    // The outer run's own two calls, including the runSubagent call that started the inner run.
    expect(subagentCalls(audit).map((call) => [call.name, runOf(call)])).toEqual([
      ["read_file", "call_auditouter1"],
      ["runSubagent", "call_auditouter1"],
    ]);
    expect(subagentCalls(audit)[1].kind).toBe("subagent");
    expect(audit.gapsByLogTurn[0]).toEqual([
      {
        runId: "call_auditinner1",
        label: "runSubagent-Plan",
        depth: 2,
        parentRunId: "call_auditouter1",
        reason: NESTED_SUBAGENT_NOT_READ_REASON,
      },
    ]);
    expect(NESTED_SUBAGENT_NOT_READ_REASON).toContain("nested subagents are not read");
    // The inner run's file is one unread run, not also a second one for the orphan scan.
    expect(audit.unread).toHaveLength(1);
  });

  it("row: a subagent-kind main call with no run log and no ref (explore_subagent): an unread run, D5", async () => {
    const audit = await classicSubagentAudit(auditCase("explore-linked"));

    expect(audit.gapsByLogTurn[0]).toEqual([
      { runId: "span-explore-2", label: "searchSubagent", depth: 1, reason: UNLOGGED_SUBAGENT_TOOL_REASON },
    ]);
    expect(UNLOGGED_SUBAGENT_TOOL_REASON).toContain("this subagent tool writes no log the analyzer reads");
  });

  it("row (§14.1): explore_subagent linked to its searchSubagent log by time window: one run, started by that call", async () => {
    const audit = await classicSubagentAudit(auditCase("explore-linked"));

    expect(subagentCalls(audit).map((call) => [call.name, runOf(call)])).toEqual([
      ["file_search", "call_auditexplore1"],
      ["grep_search", "call_auditexplore1"],
      ["semantic_search", "call_auditexplore1"],
    ]);
    expect(subagentCalls(audit)[0].origin).toMatchObject({ label: "searchSubagent", depth: 1, startedByCallId: "span-explore-1" });
    expect(audit.gapsByLogTurn[0].map((gap) => gap.runId)).not.toContain("call_auditexplore1");
  });

  it("row: a searchSubagent run with no parent call: listed, no startedByCallId", async () => {
    const audit = await classicSubagentAudit(auditCase("search-without-parent"));

    expect(subagentCalls(audit)).toHaveLength(3);
    expect(subagentCalls(audit)[0].origin).toEqual({ kind: "subagent", runId: "call_auditsearch1", label: "searchSubagent", depth: 1 });
    expect(audit.unread).toEqual([]);
  });

  it("row: nesting deeper than 8 or a cycle: unread \"nested subagents beyond the read depth\"", () => {
    // Classic child refs are never followed (D6), so no real classic log holds
    // such a chain; the reader's rule is tested on planned runs in
    // subagent-tool-calls.test.ts ("nesting beyond the read depth or in a cycle").
    expect(BEYOND_READ_DEPTH_REASON).toContain("nested subagents beyond the read depth");
  });

  it("row: live run, partial last line: skipped (subagent-tool-calls.test.ts, \"a live run's partial last line\")", async () => {
    const dir = copyCase(auditCase("shared-span-id"));
    const file = path.join(dir, "runSubagent-Explore-call_auditshared1.jsonl");
    writeFileSync(file, `${readFileSync(file, "utf8")}{"v":1,"ts":17910`);

    const audit = await classicSubagentAudit(dir);

    expect(audit.unread).toEqual([]);
    expect(subagentCalls(audit).length).toBeGreaterThan(0);
  });

  it("the parent's starting call stays a main-agent call of kind subagent (§5.4)", async () => {
    const audit = await classicSubagentAudit(auditCase("shared-span-id"));

    expect(subagentCalls(audit).some((call) => call.name === "runSubagent")).toBe(false);
    expect(audit.mainCallsByLogTurn[0].find((call) => call.name === "runSubagent")).toMatchObject({ kind: "subagent" });
    expect(audit.mainCallsByLogTurn[0].find((call) => call.name === "runSubagent")?.origin).toBeUndefined();
  });

  it("dedupe (§5.4): an id the parent and a child log both hold is counted once, the parent's", async () => {
    const audit = await classicSubagentAudit(auditCase("shared-span-id"));

    const everyId = [...audit.mainCallsByLogTurn.flat(), ...audit.callsByLogTurn.flat()].map((call) => call.id);
    expect(everyId.filter((id) => id === "span-shared-read")).toHaveLength(1);
    expect(audit.mainCallsByLogTurn[0].map((call) => call.id)).toContain("span-shared-read");
    expect(subagentCalls(audit).map((call) => call.id)).toEqual(["span-call_auditshared1-7"]);
  });

  it("shell calls in a run keep their kind and bounded command", async () => {
    const audit = await classicSubagentAudit(auditCase("shell-calls"));

    const shell = subagentCalls(audit).filter((call) => call.kind === "shell");
    expect(shell).toHaveLength(3);
    expect(shell.map((call) => call.shell?.program)).toEqual(expect.arrayContaining(["npm", "curl", "sleep"]));
    expect(shell.every((call) => call.origin?.kind === "subagent")).toBe(true);
  });

  // "No known run has a call left out": for every audit fixture, the calls the
  // reader lists plus the ones it dedupes against the parent equal the
  // tool_call spans of every child file it read, counted without the reader.
  it.each(readdirSync(classicAuditDir).filter((name) => !name.endsWith(".md")))("%s: no read run has a call left out", async (name) => {
    const dir = auditCase(name);
    const audit = await classicSubagentAudit(dir);
    const unreadRunIds = new Set(audit.unread.flatMap((run) => (run.runId === undefined ? [] : [run.runId])));
    const parentIds = new Set(audit.mainCallsByLogTurn.flat().flatMap((call) => (call.id === undefined ? [] : [call.id])));

    let expected = 0;
    for (const file of readdirSync(dir).filter((f) => SUBAGENT_LOG_NAME.test(f))) {
      const spans = readFileSync(path.join(dir, file), "utf8")
        .split("\n")
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as { type: string; spanId?: string; sid: string }];
          } catch {
            return [];
          }
        });
      const runId = spans[0]?.sid;
      if (runId === undefined || unreadRunIds.has(runId) || !audit.readRunIds.has(runId)) {
        continue;
      }
      expected += spans.filter((span) => span.type === "tool_call" && !(span.spanId !== undefined && parentIds.has(span.spanId))).length;
    }

    expect(audit.callsByLogTurn.flat()).toHaveLength(expected);
  });
});

