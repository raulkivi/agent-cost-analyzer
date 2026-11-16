// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { TokenCount, TurnUsage } from "@agent-cost-analyzer/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { turnLinesOf } from "../../services/pricing/turn-cost-lines.js";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { branchOf } from "./subagent-case-loader.js";
import { attributeClaudeCodeRuns, type ClaudeCodeRunInput } from "./subagent-attribution.js";
import { mergeClaudeCodeSubagentUsage } from "./subagent-usage-merge.js";
import { extractTurnUsage } from "./usage-extractor.js";

// CS9 (claude-code-subagents plan 5.4, 5.5, 6): a turn's row is the main
// agent's own figures plus every run the turn started; its cost lines are the
// main agent's and one per run. Synthetic sessions only.

const known = (value: number): TokenCount => ({ known: true, value });

interface Figures {
  input: number;
  cacheWrite: number;
  extended: number;
  cacheRead: number;
  output: number;
  thinking: number;
  model: string;
}

interface Round {
  messageId: string;
  figures: Figures;
}

const at = (seconds: number): string => new Date(Date.UTC(2026, 9, 20, 10, 0, seconds)).toISOString();

function usageObject(f: Figures): Record<string, unknown> {
  return {
    input_tokens: f.input,
    cache_creation_input_tokens: f.cacheWrite,
    cache_read_input_tokens: f.cacheRead,
    output_tokens: f.output,
    output_tokens_details: { thinking_tokens: f.thinking },
    cache_creation: { ephemeral_1h_input_tokens: f.extended },
  };
}

function assistant(round: Round, uuid: string, parent: string, seconds: number, blocks: unknown[] = [{ type: "text", text: "Made-up." }]): ClaudeCodeRawEntry {
  return {
    type: "assistant",
    uuid,
    parentUuid: parent,
    timestamp: at(seconds),
    requestId: `req_${round.messageId}`,
    message: { id: round.messageId, model: round.figures.model, content: blocks, usage: usageObject(round.figures) },
  };
}

const prompt = (uuid: string, parent: string | null, seconds: number): ClaudeCodeRawEntry => ({
  type: "user",
  uuid,
  parentUuid: parent,
  timestamp: at(seconds),
  message: { role: "user", content: "Made-up prompt." },
});

const result = (uuid: string, parent: string, seconds: number, callId: string): ClaudeCodeRawEntry => ({
  type: "user",
  uuid,
  parentUuid: parent,
  timestamp: at(seconds),
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: callId, content: "Done." }] },
});

// ---- the generated session ----------------------------------------------

interface RunSpec {
  own: Figures[];
  /** Copies the starting turn's rounds first, as a fork does. */
  fork: boolean;
  /** A fork of this run that starts no call of the parent's: nested. */
  nested?: { own: Figures; copiesParentRun: boolean };
  /** The transcript is missing: the run is unknown. */
  missing: boolean;
}

interface TurnSpec {
  main: Figures[];
  runs: RunSpec[];
}

interface Built {
  entries: ClaudeCodeRawEntry[];
  runs: ClaudeCodeRunInput[];
  /** Per turn: every distinct round that must be counted once, with the owner. */
  counted: { messageId: string; figures: Figures; owner: "main" | string }[][];
}

function build(turns: TurnSpec[]): Built {
  const entries: ClaudeCodeRawEntry[] = [];
  const runs: ClaudeCodeRunInput[] = [];
  const counted: Built["counted"] = [];
  let ids = 0;
  let seconds = 0;
  let last: string | null = null;
  const push = (entry: ClaudeCodeRawEntry): void => {
    entries.push(entry);
    last = entry.uuid as string;
    seconds += 1;
  };
  const roundOf = (figures: Figures): Round => ({ messageId: `msg_${(ids += 1)}`, figures });
  const withAgent = (entry: ClaudeCodeRawEntry, agentId: string): ClaudeCodeRawEntry => ({ ...entry, agentId, uuid: `${agentId}-${entry.uuid}` });

  turns.forEach((spec, t) => {
    const here: Built["counted"][number] = [];
    counted.push(here);
    push(prompt(`u${t}`, last, seconds));

    const mainRounds = spec.main.map(roundOf);
    const callIds = spec.runs.map((_, r) => `toolu_${t}_${r}`);
    mainRounds.forEach((round, k) => {
      const blocks = k === 0 ? [{ type: "text", text: "Made-up." }, ...callIds.map((id) => ({ type: "tool_use", id, name: "Agent", input: {} }))] : undefined;
      push(assistant(round, `m${t}-${k}`, last!, seconds, blocks));
      here.push({ messageId: round.messageId, figures: round.figures, owner: "main" });
      if (k === 0) callIds.forEach((id, r) => push(result(`r${t}-${r}`, last!, seconds, id)));
    });

    spec.runs.forEach((run, r) => {
      const agentId = `agent${t}x${r}`;
      const ownRounds = run.own.map(roundOf);
      const copies: Round[] = run.fork ? mainRounds : [];
      const lines = [...copies, ...ownRounds].map((round, k) => withAgent(assistant(round, `c${k}`, "none", seconds + k), agentId));
      for (const round of ownRounds) here.push({ messageId: round.messageId, figures: round.figures, owner: agentId });
      runs.push({
        agentId,
        meta: { toolUseId: callIds[r], agentType: "general-purpose", ...(run.fork ? { isFork: true } : {}) },
        transcript: run.missing ? { status: "missing" } : { status: "read", entries: lines },
      });

      if (run.nested !== undefined) {
        const childId = `agent${t}x${r}n`;
        const nestedRound = roundOf(run.nested.own);
        const childCopies = [...mainRounds, ...(run.nested.copiesParentRun ? ownRounds : [])];
        const childLines = [...childCopies, nestedRound].map((round, k) => withAgent(assistant(round, `c${k}`, "none", seconds + k), childId));
        here.push({ messageId: nestedRound.messageId, figures: nestedRound.figures, owner: childId });
        runs.push({
          agentId: childId,
          meta: { agentType: "general-purpose", parentAgentId: agentId, isFork: true },
          transcript: { status: "read", entries: childLines },
        });
      }
    });
  });
  return { entries, runs, counted };
}

const figures = fc.record({
  input: fc.integer({ min: 0, max: 1_000 }),
  cacheWrite: fc.integer({ min: 0, max: 500 }),
  cacheRead: fc.integer({ min: 0, max: 5_000 }),
  output: fc.integer({ min: 1, max: 2_000 }),
  model: fc.constantFrom("claude-sonnet-5-5", "claude-haiku-5"),
  extendedShare: fc.double({ min: 0, max: 1, noNaN: true }),
  thinkingShare: fc.double({ min: 0, max: 1, noNaN: true }),
}).map(
  ({ extendedShare, thinkingShare, ...rest }): Figures => ({
    ...rest,
    extended: Math.floor(rest.cacheWrite * extendedShare),
    thinking: Math.floor(rest.output * thinkingShare),
  }),
);

const runSpec: fc.Arbitrary<RunSpec> = fc.record({
  own: fc.array(figures, { minLength: 1, maxLength: 2 }),
  fork: fc.boolean(),
  nested: fc.option(fc.record({ own: figures, copiesParentRun: fc.boolean() }), { nil: undefined }),
  missing: fc.integer({ min: 0, max: 9 }).map((n) => n === 0),
});

const turnSpec: fc.Arbitrary<TurnSpec> = fc.record({
  main: fc.array(figures, { minLength: 1, maxLength: 3 }),
  runs: fc.array(runSpec, { maxLength: 2 }),
});

const SUMMED = ["uncachedInput", "cacheWrite", "cacheRead", "reasoning", "output", "extendedCacheWrite"] as const;
const TOKEN_FIELDS = ["uncachedInput", "cacheWrite", "cacheRead", "output"] as const;

function mergeSession(built: Built): { merged: (TurnUsage | null)[]; own: TurnUsage[] } {
  const { branch, turnGroups } = branchOf(built.entries);
  const attribution = attributeClaudeCodeRuns({
    runs: built.runs,
    folder: { status: "ok" },
    branch,
    turnGroups,
    sessionEntries: built.entries,
  });
  const own = turnGroups.map(extractTurnUsage);
  return { merged: mergeClaudeCodeSubagentUsage(own, attribution), own };
}

const sumOf = (rounds: { figures: Figures }[], pick: (f: Figures) => number): number =>
  rounds.reduce((total, round) => total + pick(round.figures), 0);

describe("mergeClaudeCodeSubagentUsage, properties", () => {
  it("every turn's cost lines sum to its row on every figure; an unknown row has an unknown line", () => {
    fc.assert(
      fc.property(fc.array(turnSpec, { minLength: 1, maxLength: 3 }), (specs) => {
        const { merged } = mergeSession(build(specs));

        for (const row of merged) {
          const lines = turnLinesOf(row!);
          if (lines === undefined) continue;
          for (const field of SUMMED) {
            const total = row![field]!;
            const parts = lines.map((line) => line.usage[field]!);
            if (total.known) {
              expect(parts.every((part) => part.known)).toBe(true);
              expect(parts.reduce((sum, part) => sum + (part as { value: number }).value, 0)).toBe(total.value);
            } else {
              expect(parts.some((part) => !part.known)).toBe(true);
            }
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it("no request is counted twice: forks and nested forks add only their own rounds", () => {
    fc.assert(
      fc.property(fc.array(turnSpec, { minLength: 1, maxLength: 3 }), (specs) => {
        const built = build(specs);
        const { merged } = mergeSession(built);

        merged.forEach((row, t) => {
          const rounds = built.counted[t]!;
          expect(new Set(rounds.map((round) => round.messageId)).size).toBe(rounds.length);
          const lines = turnLinesOf(row!) ?? [];
          const runsOfTurn = specs[t]!.runs.length + specs[t]!.runs.filter((run) => run.nested !== undefined).length;
          expect(row!.subagents?.length ?? 0).toBe(runsOfTurn);
          if (specs[t]!.runs.some((run) => run.missing)) return;

          // Own rounds once in the main line, each run's rounds once in its own line.
          for (const line of lines) {
            const owner = line.subagent ? row!.subagents![lines.indexOf(line) - 1]!.id : "main";
            expect(line.usage.roundsCount).toBe(rounds.filter((round) => round.owner === owner).length);
          }
          expect(row!.output).toEqual(known(sumOf(rounds, (f) => f.output)));
          expect(row!.uncachedInput).toEqual(known(sumOf(rounds, (f) => f.input)));
          expect(row!.cacheRead).toEqual(known(sumOf(rounds, (f) => f.cacheRead)));
          expect(row!.cacheWrite).toEqual(known(sumOf(rounds, (f) => f.cacheWrite)));
          expect(row!.extendedCacheWrite).toEqual(known(sumOf(rounds, (f) => f.extended)));
          expect(row!.reasoning).toEqual(known(sumOf(rounds, (f) => f.thinking)));
          expect(row!.roundsCount).toBe(specs[t]!.main.length);
        });
      }),
      { numRuns: 150 },
    );
  });

  it("a turn with an unread run is unknown on every token figure, never a lower known total", () => {
    fc.assert(
      fc.property(fc.array(turnSpec, { minLength: 1, maxLength: 3 }), (specs) => {
        const { merged } = mergeSession(build(specs));

        merged.forEach((row, t) => {
          if (!specs[t]!.runs.some((run) => run.missing)) return;
          for (const field of TOKEN_FIELDS) expect(row![field].known).toBe(false);
        });
      }),
      { numRuns: 150 },
    );
  });
});

// ---- examples ------------------------------------------------------------

const F: Figures = { input: 10, cacheWrite: 100, extended: 40, cacheRead: 1_000, output: 20, thinking: 5, model: "claude-sonnet-5-5" };

describe("mergeClaudeCodeSubagentUsage", () => {
  const one = (spec: TurnSpec) => {
    const built = build([spec]);
    return mergeSession(built);
  };

  it("leaves a turn with no run as extractTurnUsage built it", () => {
    const { merged, own } = one({ main: [F], runs: [] });

    expect(merged).toEqual(own);
    expect(merged[0]).not.toHaveProperty("subagents");
    expect(merged[0]).not.toHaveProperty("ownUsage");
  });

  it("is own plus runs, with the main agent's figures, rounds and model kept in ownUsage and the row", () => {
    const { merged, own } = one({
      main: [F],
      runs: [{ own: [{ ...F, model: "claude-haiku-5", extended: 100 }], fork: false, missing: false }],
    });

    const row = merged[0]!;
    expect(row.uncachedInput).toEqual(known(20));
    expect(row.cacheWrite).toEqual(known(200));
    expect(row.extendedCacheWrite).toEqual(known(140));
    expect(row.model).toBe("claude-sonnet-5-5");
    expect(row.roundsCount).toBe(1);
    expect(row.ownUsage).toMatchObject({
      uncachedInput: known(10),
      extendedCacheWrite: known(40),
      model: "claude-sonnet-5-5",
    });
    expect(row.ownUsage).toEqual({
      uncachedInput: own[0]!.uncachedInput,
      cacheWrite: own[0]!.cacheWrite,
      cacheRead: own[0]!.cacheRead,
      tool: own[0]!.tool,
      vision: own[0]!.vision,
      reasoning: own[0]!.reasoning,
      output: own[0]!.output,
      costAiCredits: own[0]!.costAiCredits,
      extendedCacheWrite: own[0]!.extendedCacheWrite,
      model: own[0]!.model,
    });
  });

  it("prices each line with its own 1-hour writes, on its own model", () => {
    const { merged } = one({
      main: [F],
      runs: [{ own: [{ ...F, model: "claude-haiku-5", extended: 100 }], fork: false, missing: false }],
    });

    const lines = turnLinesOf(merged[0]!)!;

    expect(lines.map((line) => [line.subagent, line.usage.model, line.usage.extendedCacheWrite])).toEqual([
      [false, "claude-sonnet-5-5", known(40)],
      [true, "claude-haiku-5", known(100)],
    ]);
  });

  it("an unknown run makes the turn unknown on every token figure, with that run's reason", () => {
    const { merged } = one({ main: [F], runs: [{ own: [F], fork: false, missing: true }] });

    const row = merged[0]!;
    for (const field of TOKEN_FIELDS) expect(row[field].known).toBe(false);
    expect(row.subagents).toHaveLength(1);
    expect(row.ownUsage?.output).toEqual(known(20));
  });

  it("an unknown reasoning or 1-hour split alone leaves the four token figures known", () => {
    const built = build([{ main: [F], runs: [{ own: [F], fork: false, missing: false }] }]);
    const [run] = built.runs;
    // Strips the two parts-of figures from the run's only round.
    const stripped = (run!.transcript as { status: "read"; entries: ClaudeCodeRawEntry[] }).entries.map((entry) => {
      const message = entry.message as { usage: Record<string, unknown> };
      const usage = { ...message.usage };
      delete usage.output_tokens_details;
      delete usage.cache_creation;
      return { ...entry, message: { ...message, usage } };
    });
    built.runs[0] = { ...run!, transcript: { status: "read", entries: stripped } };

    const row = mergeSession(built).merged[0]!;

    for (const field of TOKEN_FIELDS) expect(row[field].known).toBe(true);
    expect(row.reasoning.known).toBe(false);
    expect(row.extendedCacheWrite?.known).toBe(false);
    expect(row.cacheWrite).toEqual(known(200));
  });

  it("AI Credits stay unknown: they are never a reason a turn is unknown", () => {
    const { merged } = one({ main: [F], runs: [{ own: [F], fork: false, missing: false }] });

    expect(merged[0]!.costAiCredits).toEqual(
      expect.objectContaining({ known: false }),
    );
    expect(merged[0]!.uncachedInput.known).toBe(true);
  });

  it("keeps a turn that has only notes as it was, and a null turn null", () => {
    const [own] = one({ main: [F], runs: [] }).own;
    const notesOnly = { byTurn: new Map([[0, { runs: [], notes: ["A run is counted in another session."] }]]) };

    expect(mergeClaudeCodeSubagentUsage([own!], notesOnly)).toEqual([own]);
    expect(mergeClaudeCodeSubagentUsage([null], notesOnly)).toEqual([null]);
  });
});
