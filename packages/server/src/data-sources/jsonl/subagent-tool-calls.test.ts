// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolCallRecordSchema, type ToolCallRecord } from "@agent-cost-analyzer/domain";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canBlockReads, classicAuditDir } from "../../test-support/subagent-audit-fixtures.js";
import {
  SUBAGENT_LOG_NAME_REJECTED_REASON,
  SUBAGENT_LOG_NOT_REGULAR_FILE_REASON,
  SUBAGENT_LOG_READ_FAILED_REASON,
} from "./subagent-attribution.js";
import type { PlannedRun } from "./subagent-run-plan.js";
import { BEYOND_READ_DEPTH_REASON, missingSubagentLogReason } from "./subagent-tool-call-reasons.js";
import { readSubagentToolCalls } from "./subagent-tool-calls.js";

function spanLine(spanId: string, name: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    ts: 1_791_000_001_000,
    dur: 50,
    sid: "child",
    type: "tool_call",
    name,
    spanId,
    status: "ok",
    attrs: { args: "{}" },
    ...extra,
  });
}

function planned(overrides: Partial<PlannedRun> & { file?: string } = {}): PlannedRun {
  const { file = "runSubagent-Explore-call_run1.jsonl", ...rest } = overrides;
  return {
    runId: "call_run1",
    label: "runSubagent-Explore",
    depth: 1,
    startedByCallId: "span-run-call",
    log: { status: "read", childLogFile: file },
    ...rest,
  };
}

const turns = (...entries: [number, PlannedRun[]][]) => new Map(entries);
const idsOf = (calls: readonly ToolCallRecord[] | undefined) => (calls ?? []).map((call) => call.id);

describe("readSubagentToolCalls", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "subagent-tool-calls-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeLog = (file: string, lines: string[]) => writeFileSync(path.join(dir, file), `${lines.join("\n")}\n`);

  it("every record carries the run's origin: kind, depth 1, runId, label and the call that started it", async () => {
    writeLog("runSubagent-Explore-call_run1.jsonl", [spanLine("c1", "read_file"), spanLine("c2", "grep_search")]);

    const { byTurn, unread } = await readSubagentToolCalls(turns([0, [planned()]]), dir);

    expect(unread).toEqual([]);
    expect(byTurn.get(0)).toHaveLength(2);
    for (const record of byTurn.get(0) ?? []) {
      expect(record.origin).toEqual({
        kind: "subagent",
        runId: "call_run1",
        label: "runSubagent-Explore",
        depth: 1,
        startedByCallId: "span-run-call",
      });
      expect(toolCallRecordSchema.safeParse(record).success).toBe(true);
    }
  });

  it("a run with no starting call has no startedByCallId", async () => {
    writeLog("searchSubagent-call_s1.jsonl", [spanLine("c1", "file_search")]);
    const run = planned({ runId: "call_s1", label: "searchSubagent", file: "searchSubagent-call_s1.jsonl" });
    delete run.startedByCallId;

    const { byTurn } = await readSubagentToolCalls(turns([0, [run]]), dir);

    expect(byTurn.get(0)?.[0].origin).not.toHaveProperty("startedByCallId");
  });

  it("outcomes come from the span status and error text, like the main agent's", async () => {
    writeLog("runSubagent-Explore-call_run1.jsonl", [
      spanLine("c1", "read_file"),
      spanLine("c2", "read_file", { status: "error", attrs: { args: "{}", error: "ENOENT: no such file or directory" } }),
      spanLine("c3", "semantic_search", { status: "error", attrs: { args: "{}", error: "Canceled" } }),
      spanLine("c4", "read_file", { status: "paused" }),
    ]);

    const { byTurn } = await readSubagentToolCalls(turns([0, [planned()]]), dir);

    expect(byTurn.get(0)?.map((call) => call.outcome?.status)).toEqual(["success", "error", "canceled", "unknown"]);
    expect(byTurn.get(0)?.[3].outcome).toMatchObject({ reason: "unrecognized span status" });
  });

  it("never keeps a tool result", async () => {
    writeLog("runSubagent-Explore-call_run1.jsonl", [spanLine("c1", "read_file", { attrs: { args: "{}", result: "RESULT-MUST-NOT-SURVIVE" } })]);

    const { byTurn } = await readSubagentToolCalls(turns([0, [planned()]]), dir);

    expect(JSON.stringify(byTurn.get(0))).not.toContain("RESULT-MUST-NOT-SURVIVE");
  });

  it("a live run's partial last line is skipped, the rest read", async () => {
    writeFileSync(path.join(dir, "runSubagent-Explore-call_run1.jsonl"), `${spanLine("c1", "read_file")}\n{"v":1,"ts":17910`);

    const { byTurn, unread } = await readSubagentToolCalls(turns([0, [planned()]]), dir);

    expect(idsOf(byTurn.get(0))).toEqual(["c1"]);
    expect(unread).toEqual([]);
  });

  it("calls in a log with no user_message still count", async () => {
    writeLog("runSubagent-Explore-call_run1.jsonl", [spanLine("c1", "read_file")]);

    const { byTurn } = await readSubagentToolCalls(turns([0, [planned()]]), dir);

    expect(idsOf(byTurn.get(0))).toEqual(["c1"]);
  });

  it("a read run that made no call is read, not unread", async () => {
    writeLog("runSubagent-Explore-call_run1.jsonl", [JSON.stringify({ v: 1, ts: 1, dur: 0, sid: "c", type: "user_message", name: "user_message", spanId: "u", status: "ok" })]);

    const { byTurn, unread } = await readSubagentToolCalls(turns([0, [planned()]]), dir);

    expect(byTurn.get(0) ?? []).toEqual([]);
    expect(unread).toEqual([]);
  });

  describe("order (D2)", () => {
    it("lists each turn's runs in the order given, each run's calls in file order", async () => {
      writeLog("runSubagent-A-call_a.jsonl", [spanLine("a1", "read_file"), spanLine("a2", "read_file")]);
      writeLog("runSubagent-B-call_b.jsonl", [spanLine("b1", "read_file")]);
      writeLog("runSubagent-C-call_c.jsonl", [spanLine("c1", "read_file")]);

      const { byTurn } = await readSubagentToolCalls(
        turns(
          [0, [planned({ runId: "call_a", label: "runSubagent-A", file: "runSubagent-A-call_a.jsonl" }), planned({ runId: "call_b", label: "runSubagent-B", file: "runSubagent-B-call_b.jsonl" })]],
          [2, [planned({ runId: "call_c", label: "runSubagent-C", file: "runSubagent-C-call_c.jsonl" })]],
        ),
        dir,
      );

      expect(idsOf(byTurn.get(0))).toEqual(["a1", "a2", "b1"]);
      expect(idsOf(byTurn.get(2))).toEqual(["c1"]);
      expect(byTurn.has(1)).toBe(false);
    });
  });

  describe("dedupe (§5.4)", () => {
    it("a call id the parent log already holds is dropped from the run: the parent's wins", async () => {
      writeLog("runSubagent-Explore-call_run1.jsonl", [spanLine("span-shared-read", "read_file"), spanLine("c2", "grep_search")]);

      const { byTurn } = await readSubagentToolCalls(turns([0, [planned()]]), dir, new Set(["span-shared-read"]));

      expect(idsOf(byTurn.get(0))).toEqual(["c2"]);
    });

    it("an id in two runs counts once: the first log in read order wins", async () => {
      writeLog("runSubagent-A-call_a.jsonl", [spanLine("dup", "read_file")]);
      writeLog("runSubagent-B-call_b.jsonl", [spanLine("dup", "read_file"), spanLine("b2", "read_file")]);

      const { byTurn } = await readSubagentToolCalls(
        turns([0, [planned({ runId: "call_a", file: "runSubagent-A-call_a.jsonl" }), planned({ runId: "call_b", file: "runSubagent-B-call_b.jsonl" })]]),
        dir,
      );

      expect(byTurn.get(0)?.map((call) => [call.origin?.kind === "subagent" ? call.origin.runId : "", call.id])).toEqual([
        ["call_a", "dup"],
        ["call_b", "b2"],
      ]);
    });

    it("an outer run's call wins over the same id in an inner run, even if the inner is listed first", async () => {
      writeLog("runSubagent-Outer-call_outer.jsonl", [spanLine("dup", "read_file")]);
      writeLog("runSubagent-Inner-call_inner.jsonl", [spanLine("dup", "read_file"), spanLine("i2", "read_file")]);
      const inner = planned({ runId: "call_inner", label: "runSubagent-Inner", file: "runSubagent-Inner-call_inner.jsonl", depth: 2, parentRunId: "call_outer" });
      const outer = planned({ runId: "call_outer", label: "runSubagent-Outer", file: "runSubagent-Outer-call_outer.jsonl" });

      const { byTurn } = await readSubagentToolCalls(turns([0, [inner, outer]]), dir);

      const byRun = (runId: string) => idsOf(byTurn.get(0)?.filter((call) => call.origin?.kind === "subagent" && call.origin.runId === runId));
      expect(byRun("call_outer")).toEqual(["dup"]);
      expect(byRun("call_inner")).toEqual(["i2"]);
    });

    it("calls with no id are never merged", async () => {
      writeLog("runSubagent-Explore-call_run1.jsonl", [spanLine("", "read_file", { spanId: undefined }), spanLine("", "read_file", { spanId: undefined })]);

      const { byTurn } = await readSubagentToolCalls(turns([0, [planned()]]), dir);

      expect(byTurn.get(0)).toHaveLength(2);
    });

    it("property: no call id appears twice, whatever the logs and the parent hold", async () => {
      const idArb = fc.constantFrom("a", "b", "c", "d", "e");
      const runArb = fc.array(idArb, { maxLength: 6 });
      await fc.assert(
        fc.asyncProperty(fc.array(runArb, { minLength: 1, maxLength: 4 }), fc.array(idArb, { maxLength: 3 }), async (runs, parentIds) => {
          const plannedRuns = runs.map((ids, index) => {
            const file = `runSubagent-R${index}-call_r${index}.jsonl`;
            writeLog(file, ids.map((id) => spanLine(id, "read_file")));
            return planned({ runId: `call_r${index}`, label: `runSubagent-R${index}`, file, depth: index === 0 ? 1 : 2, ...(index === 0 ? {} : { parentRunId: "call_r0" }) });
          });

          const { byTurn } = await readSubagentToolCalls(turns([0, plannedRuns]), dir, new Set(parentIds));

          const ids = idsOf(byTurn.get(0));
          expect(new Set(ids).size).toBe(ids.length);
          expect(ids.some((id) => id !== undefined && (parentIds as string[]).includes(id))).toBe(false);
          // Nothing else is lost: every distinct id the parent doesn't hold is kept once.
          const expected = new Set(runs.flat().filter((id) => !(parentIds as string[]).includes(id)));
          expect(new Set(ids)).toEqual(expected);
        }),
        { numRuns: 60 },
      );
    });
  });

  describe("runs that can't be read (§6)", () => {
    it("a run the attribution could not read stays unread with its reason and identity", async () => {
      const run = planned({ log: { status: "unread", reason: missingSubagentLogReason("runSubagent-Explore") } });

      const { byTurn, unread } = await readSubagentToolCalls(turns([3, [run]]), dir);

      expect(byTurn.size).toBe(0);
      expect(unread).toEqual([
        { logTurn: 3, runId: "call_run1", label: "runSubagent-Explore", depth: 1, reason: missingSubagentLogReason("runSubagent-Explore") },
      ]);
    });

    it("a log that vanished between the two reads is missing", async () => {
      const { unread } = await readSubagentToolCalls(turns([0, [planned()]]), dir);

      expect(unread).toEqual([expect.objectContaining({ reason: missingSubagentLogReason("runSubagent-Explore") })]);
    });

    it("a rejected name is not read", async () => {
      const { unread } = await readSubagentToolCalls(turns([0, [planned({ file: "../escape.jsonl" })]]), dir);

      expect(unread).toEqual([expect.objectContaining({ reason: SUBAGENT_LOG_NAME_REJECTED_REASON })]);
    });

    it("a symbolic link is not a regular file", async () => {
      writeLog("target.jsonl", [spanLine("c1", "read_file")]);
      symlinkSync(path.join(dir, "target.jsonl"), path.join(dir, "runSubagent-Explore-call_run1.jsonl"));

      const { byTurn, unread } = await readSubagentToolCalls(turns([0, [planned()]]), dir);

      expect(byTurn.size).toBe(0);
      expect(unread).toEqual([expect.objectContaining({ reason: SUBAGENT_LOG_NOT_REGULAR_FILE_REASON })]);
    });

    it.skipIf(!canBlockReads())("an unreadable file is unread with 10.19's reason", async () => {
      writeLog("runSubagent-Explore-call_run1.jsonl", [spanLine("c1", "read_file")]);
      chmodSync(path.join(dir, "runSubagent-Explore-call_run1.jsonl"), 0o000);

      try {
        const { byTurn, unread } = await readSubagentToolCalls(turns([0, [planned()]]), dir);

        expect(byTurn.size).toBe(0);
        expect(unread).toEqual([expect.objectContaining({ reason: SUBAGENT_LOG_READ_FAILED_REASON })]);
      } finally {
        chmodSync(path.join(dir, "runSubagent-Explore-call_run1.jsonl"), 0o600);
      }
    });

    it("an unread run does not stop the others", async () => {
      writeLog("runSubagent-B-call_b.jsonl", [spanLine("b1", "read_file")]);

      const { byTurn, unread } = await readSubagentToolCalls(
        turns([0, [planned({ runId: "call_a", file: "runSubagent-A-call_a.jsonl" }), planned({ runId: "call_b", file: "runSubagent-B-call_b.jsonl" })]]),
        dir,
      );

      expect(idsOf(byTurn.get(0))).toEqual(["b1"]);
      expect(unread.map((entry) => entry.runId)).toEqual(["call_a"]);
    });
  });

  describe("nesting beyond the read depth or in a cycle (§6)", () => {
    it("a run whose parent chain loops is unread, and so is its parent", async () => {
      writeLog("runSubagent-A-call_a.jsonl", [spanLine("a1", "read_file")]);
      writeLog("runSubagent-B-call_b.jsonl", [spanLine("b1", "read_file")]);
      const a = planned({ runId: "call_a", file: "runSubagent-A-call_a.jsonl", depth: 2, parentRunId: "call_b" });
      const b = planned({ runId: "call_b", file: "runSubagent-B-call_b.jsonl", depth: 2, parentRunId: "call_a" });

      const { byTurn, unread } = await readSubagentToolCalls(turns([0, [a, b]]), dir);

      expect(byTurn.size).toBe(0);
      expect(unread.map((entry) => [entry.runId, entry.reason])).toEqual([
        ["call_a", BEYOND_READ_DEPTH_REASON],
        ["call_b", BEYOND_READ_DEPTH_REASON],
      ]);
    });

    it("a chain of nine runs: the ninth is unread, the first eight are read", async () => {
      const chain: PlannedRun[] = [];
      for (let depth = 1; depth <= 9; depth++) {
        const file = `runSubagent-D${depth}-call_d${depth}.jsonl`;
        writeLog(file, [spanLine(`s${depth}`, "read_file")]);
        chain.push(planned({ runId: `call_d${depth}`, label: `runSubagent-D${depth}`, file, depth, ...(depth > 1 ? { parentRunId: `call_d${depth - 1}` } : {}) }));
      }

      const { byTurn, unread } = await readSubagentToolCalls(turns([0, chain]), dir);

      expect(idsOf(byTurn.get(0))).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]);
      expect(unread).toEqual([expect.objectContaining({ runId: "call_d9", reason: BEYOND_READ_DEPTH_REASON })]);
    });

    it("a depth-2 run keeps its parentRunId in the origin", async () => {
      writeLog("runSubagent-A-call_a.jsonl", [spanLine("a1", "read_file")]);
      writeLog("runSubagent-B-call_b.jsonl", [spanLine("b1", "read_file")]);
      const a = planned({ runId: "call_a", file: "runSubagent-A-call_a.jsonl" });
      const b = planned({ runId: "call_b", file: "runSubagent-B-call_b.jsonl", depth: 2, parentRunId: "call_a" });

      const { byTurn } = await readSubagentToolCalls(turns([0, [a, b]]), dir);

      expect(byTurn.get(0)?.[1].origin).toMatchObject({ kind: "subagent", runId: "call_b", depth: 2, parentRunId: "call_a" });
    });
  });

  it("reads the audit fixtures' child logs as they are", async () => {
    const sessionDir = path.join(classicAuditDir, "error-categories");

    const { byTurn } = await readSubagentToolCalls(
      turns([0, [planned({ file: "runSubagent-Explore-call_auditerr1.jsonl", runId: "call_auditerr1" })]]),
      sessionDir,
    );

    expect(byTurn.get(0)).toHaveLength(9);
    expect(byTurn.get(0)?.filter((call) => call.outcome?.status === "error")).toHaveLength(6);
    expect(byTurn.get(0)?.filter((call) => call.outcome?.status === "canceled")).toHaveLength(1);
  });
});
