// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The MS10 real-data check's oracle (allowance-oracle.mts) over hand-made logs.
// Each rule is the plan's (monthly-allowance-standalone.md §4.4, §4.5; D11):
// billed only, whole-session known, attribution by start in the machine's zone,
// the period from the reset day. A wrong helper fails here before it can agree
// with a wrong product.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agentHostIdOf,
  agentHostSession,
  allowanceIn,
  classicSession,
  dayKeyIn,
  daysBetween,
  eventLogCredits,
  firstLogEventMs,
  inClassicScope,
  instantInside,
  periodBack,
  type OracleSession,
} from "./allowance-oracle.mjs";
import { parseJsonl } from "./savings-oracle.mjs";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));

// Every relative import, followed through the other script oracles.
function importGraph(entry: string): { files: string[]; specifiers: string[] } {
  const files: string[] = [];
  const specifiers: string[] = [];
  const visit = (file: string) => {
    if (files.includes(file)) return;
    files.push(file);
    for (const [, specifier] of readFileSync(file, "utf-8").matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
      specifiers.push(specifier!);
      if (specifier!.startsWith(".")) visit(path.resolve(path.dirname(file), specifier!.replace(/\.mjs$/, ".mts")));
    }
  };
  visit(entry);
  return { files, specifiers };
}

describe("independence", () => {
  it("imports nothing from the product, directly or through the other oracles", () => {
    const { files, specifiers } = importGraph(path.join(SCRIPTS, "allowance-oracle.mts"));
    expect(files.every((file) => path.dirname(file) === SCRIPTS && existsSync(file))).toBe(true);
    expect(specifiers.filter((s) => s.includes("@agent-cost-analyzer") || s.includes("/src/") || s.startsWith(".."))).toEqual([]);
    // The SA18 scanner for classic logs, the Phase 15 oracle's turn alignment
    // and Agent Host store reader, the shared JSONL parser, the Claude Code subagent-run rules.
    expect(files.map((file) => path.basename(file)).sort()).toEqual(["allowance-oracle.mts", "claude-subagent-runs-oracle.mts", "cost-by-project-oracle.mts", "savings-oracle.mts", "subagent-spend-lib.mts"]);
  });
});

// ---- synthetic Copilot Chat debug logs ------------------------------------------

const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
const user = (content: string, ts: number) => ({ type: "user_message", ts, attrs: { content } });
const request = (nano: number | undefined, ts = 0, extra: object = {}) => ({
  type: "llm_request",
  ts,
  attrs: { inputTokens: 100, outputTokens: 10, model: "m", ...(nano === undefined ? {} : { copilotUsageNanoAiu: nano }), ...extra },
});
const ref = (childLogFile: string) => ({ type: "child_session_ref", attrs: { childLogFile } });
const CREATED = "2026-11-03T09:00:00.000Z";
const classic = (over: Partial<Parameters<typeof classicSession>[0]> = {}) =>
  classicSession({ id: "s1", createdAt: CREATED, storePrompts: ["a", "b"], mainText: jsonl([user("a", 1), request(1e9), user("b", 2), request(2e9)]), files: [], ...over });

describe("classicSession (plan §4.4: billed only, whole-session known)", () => {
  it("sums main.jsonl's and its subagent runs' billed AI Credits through the SA18 scanner", () => {
    const run = { name: "runSubagent-explore-call1.jsonl", text: jsonl([request(5e8), request(25e7)]) };
    const session = classic({ mainText: jsonl([user("a", 1), request(1e9), ref(run.name), user("b", 2), request(2e9)]), files: [run] });
    expect(session).toEqual({ id: "s1", harness: "local", startMs: Date.parse(CREATED), billed: 3.75, unknownBecause: null });
  });

  it("counts a zero-credit request as a known 0, not as unknown", () => {
    expect(classic({ mainText: jsonl([user("a", 1), request(0), user("b", 2), request(0)]) }).billed).toBe(0);
  });

  it("leaves a request without token counts out, as the scanner does", () => {
    expect(classic({ mainText: jsonl([user("a", 1), request(1e9), { type: "llm_request", attrs: {} }, user("b", 2), request(1e9)]) }).billed).toBe(2);
  });

  it("is unknown without a debug log", () => {
    expect(classic({ mainText: null })).toMatchObject({ billed: null, unknownBecause: "no-log" });
  });

  it("is unknown when the log started mid-session (a store turn has no logged turn)", () => {
    const session = classic({ storePrompts: ["a", "b", "c"], mainText: jsonl([user("b", 2), request(1e9), user("c", 3), request(1e9)]) });
    expect(session).toMatchObject({ billed: null, unknownBecause: "turn-not-logged" });
  });

  it("is unknown when the log's prompts can't be placed on the store's turns", () => {
    const session = classic({ storePrompts: ["a", "b"], mainText: jsonl([user("x", 1), request(1e9), user("y", 2), request(1e9), user("z", 3), request(1e9)]) });
    expect(session).toMatchObject({ billed: null, unknownBecause: "turn-not-logged" });
  });

  it("counts a logged turn past the store's last as one more turn of the session", () => {
    const session = classic({ storePrompts: ["a"], mainText: jsonl([user("a", 1), request(1e9), user("b", 2), request(2e9)]) });
    expect(session.billed).toBe(3);
    expect(classic({ storePrompts: ["a"], mainText: jsonl([user("a", 1), request(1e9), user("b", 2)]) })).toMatchObject({ billed: null, unknownBecause: "turn-without-request" });
  });

  it("is unknown when a turn has no request", () => {
    expect(classic({ mainText: jsonl([user("a", 1), request(1e9), user("b", 2)]) })).toMatchObject({ billed: null, unknownBecause: "turn-without-request" });
  });

  it("is unknown when one request has no billed AI Credits (never a partial sum)", () => {
    expect(classic({ mainText: jsonl([user("a", 1), request(1e9), user("b", 2), request(undefined)]) })).toMatchObject({ billed: null, unknownBecause: "request-without-credits" });
    expect(classic({ mainText: jsonl([user("a", 1), request(1e9), user("b", 2), request(-1)]) })).toMatchObject({ billed: null, unknownBecause: "request-without-credits" });
  });

  it("is unknown when a subagent run it names is missing, or one of the run's requests has no credits", () => {
    expect(classic({ mainText: jsonl([user("a", 1), request(1e9), ref("runSubagent-x-1.jsonl"), user("b", 2), request(1e9)]) })).toMatchObject({ billed: null, unknownBecause: "run-missing" });
    const run = { name: "searchSubagent-2.jsonl", text: jsonl([request(1e9), request(undefined)]) };
    expect(classic({ mainText: jsonl([user("a", 1), request(1e9), ref(run.name), user("b", 2), request(1e9)]), files: [run] })).toMatchObject({ billed: null, unknownBecause: "run-without-credits" });
  });

  it("is unknown with no turn at all", () => {
    expect(classic({ storePrompts: [], mainText: jsonl([request(1e9)]) })).toMatchObject({ billed: null, unknownBecause: "no-turns" });
  });

  it("takes its start from the store's created_at; none when it isn't an instant", () => {
    expect(classic({ createdAt: null }).startMs).toBeNull();
    expect(classic({ createdAt: "not a date" }).startMs).toBeNull();
  });
});

describe("firstLogEventMs (the edge report's second start source)", () => {
  it("is the first event's time in main.jsonl, or null", () => {
    expect(firstLogEventMs(jsonl([{ type: "session_start" }, user("a", 1700), request(1, 1800)]))).toBe(1700);
    expect(firstLogEventMs(jsonl([{ type: "session_start" }]))).toBeNull();
  });
});

describe("inClassicScope (agentic-coding-explained.md §18.2, owner decision 2026-11-14)", () => {
  it("keeps Chat panel sessions, whatever agent name the store took", () => {
    expect(inClassicScope({ host_type: "vscode", agent_name: "panel/editAgent" })).toBe(true);
    expect(inClassicScope({ host_type: null, agent_name: "GitHub Copilot Chat" })).toBe(true);
    expect(inClassicScope({ host_type: "cli", agent_name: "Copilot CLI" })).toBe(false);
    expect(inClassicScope({ host_type: null, agent_name: null })).toBe(false);
  });
});

// ---- synthetic Agent Host stores and Copilot CLI event logs -------------------------

const turnUsage = (nano: number | null) => JSON.stringify({ model: "m", _meta: { turnTokenTotals: [{ inputTokens: 10, cachedTokens: 0, outputTokens: 1 }], ...(nano === null ? {} : { copilotUsage: { totalNanoAiu: nano } }) } });
const storeTurn = (id: string, nano: number | null) => ({ id, event_id: null, usage: turnUsage(nano) });
const START = Date.parse("2026-11-04T10:00:00.000Z");

describe("agentHostIdOf (a Copilot CLI row of VS Code's Agent Host catalog)", () => {
  it("is the session id after the URI's scheme, whichever scheme VS Code wrote", () => {
    expect(agentHostIdOf("copilotcli:/3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1")).toBe("3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1");
    expect(agentHostIdOf("ahp-session:/3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa2")).toBe("3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa2");
  });

  it("is null when the rest isn't one safe path segment", () => {
    for (const uri of ["copilotcli:/", "copilotcli:/../x", "copilotcli:/a/b", "no-scheme", "copilotcli:/-a"]) expect(agentHostIdOf(uri), uri).toBeNull();
  });
});

describe("agentHostSession (session.db's turn_usage, read raw)", () => {
  it("sums the turns' billed AI Credits; the catalog's start time is the start", () => {
    expect(agentHostSession({ id: "h1", startTimeMs: START, storeTurns: [storeTurn("t1", 15e8), storeTurn("t2", 0)] })).toEqual({ id: "h1", harness: "agent-host", startMs: START, billed: 1.5, unknownBecause: null });
  });

  it("is unknown when a turn has no billed AI Credits or the store is missing", () => {
    expect(agentHostSession({ id: "h1", startTimeMs: START, storeTurns: [storeTurn("t1", 1e9), storeTurn("t2", null)] })).toMatchObject({ billed: null, unknownBecause: "turn-without-credits" });
    expect(agentHostSession({ id: "h1", startTimeMs: START, storeTurns: [{ id: "t1", event_id: null, usage: null }] })).toMatchObject({ billed: null, unknownBecause: "turn-without-credits" });
    expect(agentHostSession({ id: "h1", startTimeMs: START, storeTurns: null })).toMatchObject({ billed: null, unknownBecause: "no-store" });
  });

  it("is no session at all when the chat was opened but never sent", () => {
    expect(agentHostSession({ id: "h1", startTimeMs: START, storeTurns: [] })).toBeNull();
  });

  it("has no start when the catalog's start time isn't an instant", () => {
    expect(agentHostSession({ id: "h1", startTimeMs: Number.NaN, storeTurns: [storeTurn("t1", 1e9)] })?.startMs).toBeNull();
  });
});

describe("eventLogCredits (the Copilot CLI's events.jsonl, parsed as the V3 oracle parses it)", () => {
  const record = (nano: number | undefined, agentId?: string) => ({
    type: "session.usage_record",
    ...(agentId ? { agentId } : {}),
    data: { usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, ...(nano === undefined ? {} : { copilotUsage: { totalNanoAiu: nano } }) } },
  });
  const events = (lines: object[]) => parseJsonl(jsonl(lines));

  it("sums every call's billed AI Credits, the sub-agents' included", () => {
    expect(eventLogCredits(events([{ type: "user.message", data: { content: "x" } }, record(1e9), record(5e8, "sub-1")]))).toBe(1.5);
  });

  it("is unknown without a usage record or when one has no credits", () => {
    expect(eventLogCredits(events([{ type: "user.message", data: { content: "x" } }]))).toBeNull();
    expect(eventLogCredits(events([record(1e9), record(undefined)]))).toBeNull();
  });
});

// ---- the period (plan §4.5) ---------------------------------------------------------

describe("dayKeyIn, periodBack, daysBetween, instantInside", () => {
  it("gives the calendar day in the zone", () => {
    const lateOctober = Date.parse("2026-10-31T22:30:00Z");
    expect(dayKeyIn(lateOctober, "UTC")).toBe("2026-10-31");
    expect(dayKeyIn(lateOctober, "Europe/Tallinn")).toBe("2026-11-01");
  });

  it("starts the period on the reset day, this month or the last, and steps back whole periods", () => {
    expect(periodBack("2026-11-16", 1, 0)).toEqual({ startKey: "2026-11-01", endKeyExclusive: "2026-12-01" });
    expect(periodBack("2026-11-16", 1, 1)).toEqual({ startKey: "2026-10-01", endKeyExclusive: "2026-11-01" });
    expect(periodBack("2026-11-16", 1, 2)).toEqual({ startKey: "2026-09-01", endKeyExclusive: "2026-10-01" });
    expect(periodBack("2026-11-16", 16, 0)).toEqual({ startKey: "2026-11-16", endKeyExclusive: "2026-12-16" });
    expect(periodBack("2026-11-16", 17, 0)).toEqual({ startKey: "2026-10-17", endKeyExclusive: "2026-11-17" });
    expect(periodBack("2026-01-10", 20, 2)).toEqual({ startKey: "2025-10-20", endKeyExclusive: "2025-11-20" });
  });

  it("counts whole calendar days, across a daylight-saving change", () => {
    expect(daysBetween("2026-11-30", "2026-12-01")).toBe(1);
    expect(daysBetween("2026-10-01", "2026-11-01")).toBe(31);
  });

  it("picks an instant inside the period in every zone", () => {
    const period = periodBack("2026-03-16", 1, 1);
    for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Europe/Tallinn", "UTC"]) {
      const key = dayKeyIn(instantInside(period), zone);
      expect(key >= period.startKey && key < period.endKeyExclusive, zone).toBe(true);
    }
  });
});

// ---- the figures (plan §4.4, §4.6) ----------------------------------------------------

const session = (id: string, harness: OracleSession["harness"], start: string | null, billed: number | null): OracleSession => ({
  id,
  harness,
  startMs: start === null ? null : Date.parse(start),
  billed,
  unknownBecause: billed === null ? "no-log" : null,
});

describe("allowanceIn", () => {
  const november = { startKey: "2026-11-01", endKeyExclusive: "2026-12-01" };

  it("attributes a session wholly to the day it started in the zone, and sums the known ones", () => {
    const sessions = [
      session("edge", "local", "2026-10-31T22:30:00Z", 4), // 1 November in Tallinn, 31 October in UTC
      session("k", "local", "2026-11-03T09:00:00Z", 1.25),
      session("u", "agent-host", "2026-11-04T09:00:00Z", null),
      session("late", "agent-host", "2026-11-30T22:30:00Z", 9), // 1 December in Tallinn
      session("nostart", "local", null, 7),
    ];
    expect(allowanceIn(sessions, november, "Europe/Tallinn")).toEqual({
      state: "known",
      total: 3,
      known: 2,
      used: 5.25,
      atLeast: true,
      countedSinceKey: "2026-11-01",
      byHarness: [
        { harness: "local", known: 2, total: 2, used: 5.25 },
        { harness: "agent-host", known: 0, total: 1, used: null },
      ],
    });
    expect(allowanceIn(sessions, november, "UTC")).toMatchObject({ total: 3, known: 2, used: 10.25, countedSinceKey: "2026-11-03" });
  });

  it("is unknown, never 0, when no session in the period has cost data", () => {
    expect(allowanceIn([session("u", "local", "2026-11-03T09:00:00Z", null)], november, "UTC")).toEqual({
      state: "unknown",
      total: 1,
      known: 0,
      used: null,
      atLeast: false,
      countedSinceKey: "2026-11-03",
      byHarness: [{ harness: "local", known: 0, total: 1, used: null }],
    });
  });

  it("has no sessions, and lists no harness, when none started in the period", () => {
    expect(allowanceIn([session("old", "local", "2026-10-03T09:00:00Z", 2)], november, "UTC")).toEqual({
      state: "no-sessions",
      total: 0,
      known: 0,
      used: null,
      atLeast: false,
      countedSinceKey: undefined,
      byHarness: [],
    });
  });

  it("keeps a period's true zero when every session is known at 0 credits", () => {
    expect(allowanceIn([session("z", "agent-host", "2026-11-03T09:00:00Z", 0)], november, "UTC")).toMatchObject({ state: "known", used: 0, known: 1, atLeast: false });
  });
});
