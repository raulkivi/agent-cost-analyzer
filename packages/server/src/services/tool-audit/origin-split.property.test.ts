// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  outcomeTotalsSchema,
  unavailableTokenCount,
  type OutcomeTotals,
  type Session,
  type ToolCallRecord,
  type ToolCallStatus,
  type Turn,
} from "@agent-cost-analyzer/domain";
import { buildAuditRollup } from "./audit-rollup-builder.js";
import { buildSessionAudit } from "./session-audit-builder.js";

// Step 10.20 ST9: byOrigin.main + byOrigin.subagents = totals, for any mix of
// origins, statuses and turns, in a session and in a rollup of sessions.

const known = (value: number) => ({ known: true as const, value });

function turn(index: number, toolCalls: ToolCallRecord[]): Turn {
  return {
    index,
    userMessage: "",
    assistantResponse: "",
    toolCalls,
    explanation: "",
    usage: {
      uncachedInput: known(1),
      cacheWrite: known(0),
      cacheRead: known(0),
      tool: unavailableTokenCount("n/a"),
      vision: unavailableTokenCount("n/a"),
      reasoning: unavailableTokenCount("n/a"),
      output: known(1),
      costAiCredits: unavailableTokenCount("n/a"),
      model: "m",
    },
  };
}

function session(id: string, turns: Turn[]): Session {
  return {
    id,
    mode: "analyze",
    providerId: "vscode-copilot",
    title: id,
    model: "m",
    turns,
    turnCount: turns.length,
    costAiCredits: unavailableTokenCount("n/a"),
    usageDataAvailable: true,
  };
}

const status = fc.constantFrom<ToolCallStatus>("success", "error", "interrupted", "denied", "canceled", "unknown");
const runId = fc.constantFrom("r1", "r2", "r3", "main");
const command = fc.constantFrom("npm test", "git status", "ls");

const callArb: fc.Arbitrary<ToolCallRecord> = fc
  .record({
    status,
    command,
    origin: fc.option(runId, { nil: undefined }),
    round: fc.nat(3),
  })
  .map(({ status: s, command: c, origin, round }) => ({
    name: "Bash",
    kind: "shell" as const,
    argsSummary: c,
    shell: { command: c, program: c.split(" ")[0] },
    outcome: s === "error" ? { status: s, failureCategory: "timeout" as const } : { status: s },
    roundIndex: round,
    ...(origin ? { origin: { kind: "subagent" as const, runId: origin, label: "searchSubagent", depth: 1 } } : {}),
  }));

const turnsArb = fc.array(fc.array(callArb, { maxLength: 6 }), { minLength: 1, maxLength: 4 }).map((rows) => rows.map((calls, i) => turn(i, calls)));

function sum(a: OutcomeTotals, b: OutcomeTotals): OutcomeTotals {
  return {
    toolCalls: a.toolCalls + b.toolCalls,
    succeeded: a.succeeded + b.succeeded,
    failed: a.failed + b.failed,
    interrupted: a.interrupted + b.interrupted,
    denied: a.denied + b.denied,
    unknown: a.unknown + b.unknown,
  };
}

function withoutRuns(totals: OutcomeTotals & { runs: number }): OutcomeTotals {
  return outcomeTotalsSchema.parse(totals); // zod drops the extra `runs` key
}

describe("byOrigin properties", () => {
  it("main plus subagents equals the all-calls totals in a session", () => {
    fc.assert(
      fc.property(turnsArb, (turns) => {
        const audit = buildSessionAudit(session("s", turns));
        const anyRun = turns.some((t) => t.toolCalls.some((c) => c.origin?.kind === "subagent"));

        expect(audit.byOrigin !== undefined).toBe(anyRun);
        if (audit.byOrigin) {
          expect(sum(audit.byOrigin.main, withoutRuns(audit.byOrigin.subagents))).toEqual(audit.totals);
        }
      }),
    );
  });

  it("the per-run totals add up to the subagent totals when every run was read", () => {
    fc.assert(
      fc.property(turnsArb, (turns) => {
        const audit = buildSessionAudit(session("s", turns));
        const rows = audit.subagentRuns ?? [];
        const total = rows.reduce<OutcomeTotals>((acc, row) => (row.totals ? sum(acc, row.totals) : acc), {
          toolCalls: 0,
          succeeded: 0,
          failed: 0,
          interrupted: 0,
          denied: 0,
          unknown: 0,
        });

        if (audit.byOrigin) {
          expect(total).toEqual(withoutRuns(audit.byOrigin.subagents));
          expect(audit.byOrigin.subagents.runs).toBe(rows.length);
        }
      }),
    );
  });

  it("retries of a session are the retries of each origin on its own (D6)", () => {
    const key = (r: unknown) => JSON.stringify(r);
    fc.assert(
      fc.property(turnsArb, (turns) => {
        const keyOf = (c: ToolCallRecord) => (c.origin?.kind === "subagent" ? `run:${c.origin.runId}` : "main");
        const originKeys = new Set(turns.flatMap((t) => t.toolCalls.map(keyOf)));
        const perOrigin = [...originKeys].flatMap((origin) => {
          const own = turns.map((t) =>
            turn(
              t.index,
              t.toolCalls
                .filter((c) => keyOf(c) === origin)
                .map((c) => ({ ...c, origin: undefined })),
            ),
          );
          return buildSessionAudit(session("s", own)).retries;
        });

        const whole = buildSessionAudit(session("s", turns)).retries;
        expect(whole.map(key).sort()).toEqual(perOrigin.map(key).sort());
      }),
    );
  });

  it("main plus subagents equals the totals in a rollup, and every call is counted once", () => {
    fc.assert(
      fc.property(fc.array(turnsArb, { minLength: 1, maxLength: 3 }), (sessions) => {
        const audits = sessions.map((turns, i) => buildSessionAudit(session(`s${i}`, turns)));
        const rollup = buildAuditRollup(audits, {});
        const callCount = sessions.flat().reduce((n, t) => n + t.toolCalls.length, 0);

        expect(rollup.totals.toolCalls).toBe(callCount);
        if (rollup.byOrigin) {
          expect(sum(rollup.byOrigin.main, withoutRuns(rollup.byOrigin.subagents))).toEqual(rollup.totals);
        } else {
          expect(audits.every((a) => a.byOrigin === undefined)).toBe(true);
        }
      }),
    );
  });
});
