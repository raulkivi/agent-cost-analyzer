// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Unit tests of the replay oracle (replay-oracle.mts) on small synthetic logs of
// the three providers that record a request trace. Every expected figure is
// worked out by hand here, so the oracle is checked against arithmetic, not
// against the product.
import { describe, expect, it } from "vitest";
import {
  agentHostSessionOf,
  claudeCodeSessionOf,
  leaksIn,
  priceClaudeCodeTurn,
  rankedModels,
  recordedOutcome,
  turnExpectations,
  vscodeLocalSessionOf,
  withinTolerance,
  type OracleRequest,
  type OracleSession,
} from "./replay-oracle.mjs";
import { modelTablesFrom, type RawLine } from "./savings-oracle.mjs";

const T0 = Date.parse("2026-10-20T10:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

// ---------------------------------------------------------------- Claude Code

let seq = 0;
const uuid = () => `u${(seq += 1)}`;

function user(parent: string | null, content: unknown, minutes = 0): RawLine {
  return { type: "user", uuid: uuid(), parentUuid: parent, timestamp: at(minutes), message: { role: "user", content } };
}
interface Usage {
  input: number;
  read: number;
  write: number;
  output: number;
  oneHour?: number;
}
function assistant(parent: string | null, id: string, minutes: number, usage: Usage | null, model = "claude-sonnet-5-5-20261001"): RawLine {
  return {
    type: "assistant",
    uuid: uuid(),
    parentUuid: parent,
    timestamp: at(minutes),
    message: {
      id,
      model,
      content: [],
      ...(usage
        ? {
            usage: {
              input_tokens: usage.input,
              cache_read_input_tokens: usage.read,
              cache_creation_input_tokens: usage.write,
              output_tokens: usage.output,
              ...(usage.oneHour !== undefined ? { cache_creation: { ephemeral_1h_input_tokens: usage.oneHour, ephemeral_5m_input_tokens: usage.write - usage.oneHour } } : {}),
            },
          }
        : {}),
    },
  };
}
function chain(build: Array<(parent: string | null) => RawLine>): RawLine[] {
  const out: RawLine[] = [];
  let parent: string | null = null;
  for (const make of build) {
    const line = make(parent);
    out.push(line);
    parent = line.uuid as string;
  }
  return out;
}

describe("claudeCodeSessionOf", () => {
  it("rebuilds the main chain's requests per turn, and lists turns with no request or incomplete usage", () => {
    const lines = chain([
      (p) => user(p, "first question here", 0),
      (p) => assistant(p, "m1", 1, { input: 5, read: 0, write: 1000, output: 40, oneHour: 1000 }),
      (p) => assistant(p, "m1", 1, { input: 5, read: 0, write: 1000, output: 40, oneHour: 1000 }),
      (p) => user(p, [{ type: "tool_result", content: "ok" }], 2),
      (p) => assistant(p, "m2", 3, { input: 7, read: 1000, write: 50, output: 9 }),
      (p) => user(p, "a slash command only", 4),
      (p) => assistant(p, "m-syn", 4, { input: 0, read: 0, write: 0, output: 0 }, "<synthetic>"),
      (p) => user(p, "third question", 5),
      (p) => assistant(p, "m3", 6, null),
      (p) => user(p, "fourth question", 7),
      (p) => assistant(p, "m4", 8, { input: 1, read: 1050, write: 0, output: 3 }),
    ]);
    const session = claudeCodeSessionOf(lines);
    expect(session.turns).toBe(4);
    expect(session.requests.map((r) => [r.turn, r.prompt, r.cacheRead, r.cacheWrite, r.oneHourWrite, r.output])).toEqual([
      [0, 1005, 0, 1000, 1000, 40],
      [0, 1057, 1000, 50, undefined, 9],
      [3, 1051, 1050, 0, undefined, 3],
    ]);
    expect([...session.untraced.entries()]).toEqual([
      [1, "no-request"],
      [2, "incomplete"],
    ]);
    expect(session.turnStartMs[3]).toBe(Date.parse(at(7)));
    expect(session.prompts).toEqual(["first question here", "a slash command only", "third question", "fourth question"]);
  });

  it("counts the subagent runs written into the session file as sidechains", () => {
    const main = chain([(p) => user(p, "q", 0), (p) => assistant(p, "m1", 1, { input: 1, read: 0, write: 0, output: 1 })]);
    const side: RawLine[] = [
      { type: "assistant", isSidechain: true, agentId: "a1", uuid: uuid(), parentUuid: null, message: {} },
      { type: "assistant", isSidechain: true, agentId: "a1", uuid: uuid(), parentUuid: null, message: {} },
      { type: "assistant", isSidechain: true, agentId: "a2", uuid: uuid(), parentUuid: null, message: {} },
    ];
    const marker: RawLine = { type: "last-prompt", leafUuid: main.at(-1)!.uuid };
    const session = claudeCodeSessionOf([...main, ...side, marker]);
    expect(session.subagentRuns).toBe(2);
    expect(session.requests).toHaveLength(1);
  });
});

// ---------------------------------------------------------- VS Code local

function envelope(type: string, ts: number, attrs: Record<string, unknown> = {}): RawLine {
  return { type, ts, attrs };
}
const llm = (minutes: number, input: number, cached: number, output: number, nano?: number, debugName = "panel/editAgent") =>
  envelope("llm_request", T0 + minutes * 60_000, { model: "claude-opus-4.8", debugName, inputTokens: input, cachedTokens: cached, outputTokens: output, ...(nano !== undefined ? { copilotUsageNanoAiu: nano } : {}) });

describe("vscodeLocalSessionOf", () => {
  it("groups the main agent's llm_request spans by user_message, keeps the billed nano AIU, and counts subagent refs and helper requests", () => {
    const session = vscodeLocalSessionOf([
      envelope("session_start", T0),
      llm(0, 9, 0, 1), // before any user message: no turn owns it
      envelope("user_message", T0, { content: "explain the parser" }),
      llm(1, 100, 0, 10, 2_000_000_000),
      llm(2, 130, 100, 5, 500_000_000, "backgroundTodoAgent"),
      envelope("child_session_ref", T0 + 3, { childSessionId: "c1" }),
      envelope("user_message", T0 + 4, { content: "now no model call" }),
      envelope("user_message", T0 + 5, { content: "broken one" }),
      llm(6, 50, 60, 1), // cached > input: unusable
      envelope("user_message", T0 + 7, { content: "last" }),
      llm(8, 140, 130, 2),
      envelope("user_message", T0 + 9, { content: "summary only" }),
      llm(10, 150, 140, 3, 100_000_000, "summarizeConversationHistory"),
    ]);
    expect(session.turns).toBe(5);
    expect(session.requests.map((r) => [r.turn, r.prompt, r.cacheRead, r.output, r.nanoAiu])).toEqual([
      [0, 100, 0, 10, 2_000_000_000],
      [3, 140, 130, 2, null],
    ]);
    // Owner decision 2026-11-14: helper agents' requests are left out of the chain, and counted.
    expect(session.leftOut.map((r) => [r.turn, r.cacheRead, r.nanoAiu, r.agent])).toEqual([
      [0, 100, 500_000_000, "backgroundTodoAgent"],
      [4, 140, 100_000_000, "summarizeConversationHistory"],
    ]);
    expect([...session.untraced.entries()]).toEqual([
      [1, "no-request"],
      [2, "incomplete"],
      [4, "helpers-only"],
    ]);
    expect(session.subagentRuns).toBe(1);
    expect(session.prompts).toEqual(["explain the parser", "now no model call", "broken one", "last", "summary only"]);
  });
});

// ------------------------------------------------------------ Agent Host

const event = (type: string, minutes: number, data: Record<string, unknown>, agentId?: string): RawLine => ({
  type,
  timestamp: at(minutes),
  data,
  ...(agentId ? { agentId } : {}),
});
const record = (minutes: number, usage: Record<string, unknown>, agentId?: string) =>
  event("session.usage_record", minutes, { usage: { model: "claude-sonnet-5.5", ...usage } }, agentId);

describe("agentHostSessionOf", () => {
  it("groups the main agent's usage records by user message; sub-agent records are counted, not traced", () => {
    const session = agentHostSessionOf([
      event("session.start", 0, {}),
      event("user.message", 0, { content: "do the thing" }),
      record(1, { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 900, outputTokens: 20 }),
      record(2, { inputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 5 }, "sub-1"),
      event("user.message", 2, { content: "sub agent prompt" }, "sub-1"),
      record(3, { inputTokens: 1100, cacheReadTokens: 900, cacheWriteTokens: 100, outputTokens: 7, cacheDetailsReported: false }),
      event("user.message", 4, { content: "only a sub agent" }),
      record(5, { inputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 5 }, "sub-2"),
      event("user.message", 6, { content: "bad counts" }),
      record(7, { inputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 0, outputTokens: 1 }),
    ]);
    expect(session.turns).toBe(3);
    expect(session.requests.map((r) => [r.turn, r.prompt, r.cacheRead, r.cacheWrite, r.output])).toEqual([
      [0, 1000, 0, 900, 20],
      [0, 1100, 900, null, 7],
    ]);
    expect([...session.untraced.entries()]).toEqual([
      [1, "no-request"],
      [2, "incomplete"],
    ]);
    expect(session.subagentRuns).toBe(2);
    expect(session.prompts).toEqual(["do the thing", "only a sub agent", "bad counts"]);
  });
});

// ------------------------------------------------------- the D12 rebuild

const req = (turn: number, prompt: number, cacheRead: number, extra: Partial<OracleRequest> = {}): OracleRequest => ({
  turn,
  atMs: T0,
  model: "m",
  prompt,
  cacheRead,
  output: 1,
  ...extra,
});
const sessionOf = (requests: OracleRequest[], turns: number): OracleSession => ({
  turns,
  turnStartMs: [],
  requests,
  untraced: new Map(),
  subagentRuns: 0,
  prompts: [],
  leftOut: [],
});

describe("recordedOutcome", () => {
  it("is a miss with nothing read, a hit when the previous prompt is read (1% slack), else partial", () => {
    expect(recordedOutcome(0, 1000)).toBe("miss");
    expect(recordedOutcome(990, 1000)).toBe("hit");
    expect(recordedOutcome(1200, 1000)).toBe("hit");
    expect(recordedOutcome(989, 1000)).toBe("partial");
  });
});

describe("turnExpectations", () => {
  it("sums each turn's logged reads, and leaves the first request out of the compared figures (A3)", () => {
    const expected = turnExpectations(
      sessionOf(
        [
          req(0, 1000, 800), // request 0: never compared
          req(0, 1100, 1000), // hit
          req(2, 1200, 500), // partial
          req(2, 1300, 0), // miss
          req(3, 1400, 1300), // hit
        ],
        4,
      ),
    );
    expect(expected.get(0)).toEqual({ loggedRead: 1800, comparedRead: 1000, outcome: "hit", holdsFirstRequest: true, requests: 2 });
    expect(expected.get(1)).toBeUndefined();
    expect(expected.get(2)).toEqual({ loggedRead: 500, comparedRead: 500, outcome: "miss", holdsFirstRequest: false, requests: 2 });
    expect(expected.get(3)?.outcome).toBe("hit");
  });

  it("counts the helper requests' reads in the turn's logged read, never in the compared one", () => {
    const session = { ...sessionOf([req(0, 1000, 0), req(0, 1100, 1000)], 1), leftOut: [req(0, 200, 150)] };
    expect(turnExpectations(session).get(0)).toMatchObject({ loggedRead: 1150, comparedRead: 1000, requests: 2 });
  });

  it("has no outcome for a turn whose only request is the first", () => {
    expect(turnExpectations(sessionOf([req(0, 1000, 0)], 1)).get(0)?.outcome).toBeUndefined();
  });

  it("calls a turn partial when one request is partial and none missed", () => {
    expect(turnExpectations(sessionOf([req(0, 1000, 0), req(1, 1100, 1000), req(1, 1200, 600)], 2)).get(1)?.outcome).toBe("partial");
  });
});

describe("withinTolerance", () => {
  it("allows a difference of at most the given percent of the logged figure", () => {
    expect(withinTolerance(105, 100, 5)).toBe(true);
    expect(withinTolerance(95, 100, 5)).toBe(true);
    expect(withinTolerance(105.01, 100, 5)).toBe(false);
    expect(withinTolerance(0, 0, 5)).toBe(true);
    expect(withinTolerance(1, 0, 5)).toBe(false);
  });
});

// ---------------------------------------------------- the API price rebuild

const tables = modelTablesFrom({
  book: {
    versions: [
      {
        id: "anthropic-api:claude-sonnet-5.5:2026-10-01",
        modelId: "claude-sonnet-5.5",
        effectiveFrom: "2026-10-01",
        kind: "list",
        tiers: [{ inputUsdPerM: 2, cachedInputUsdPerM: 0.2, cacheWriteUsdPerM: 2.5, extendedCacheWriteUsdPerM: 4, outputUsdPerM: 10 }],
      },
      {
        id: "anthropic-api:claude-tiered:2026-10-01",
        modelId: "claude-tiered",
        effectiveFrom: "2026-10-01",
        kind: "list",
        tiers: [
          { maxInputTokens: 200_000, inputUsdPerM: 1, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 1.25, extendedCacheWriteUsdPerM: 2, outputUsdPerM: 5 },
          { inputUsdPerM: 2, cachedInputUsdPerM: 0.2, cacheWriteUsdPerM: 2.5, extendedCacheWriteUsdPerM: 4, outputUsdPerM: 10 },
        ],
      },
    ],
  },
  profiles: [],
});

describe("priceClaudeCodeTurn", () => {
  const sonnet = "claude-sonnet-5-5-20261001";
  it("prices uncached, read, 5-minute and 1-hour writes and output at the turn's date; unsplit writes are 1-hour", () => {
    const requests = [
      req(0, 0, 0, { model: sonnet, uncached: 1_000_000, cacheRead: 2_000_000, cacheWrite: 1_000_000, oneHourWrite: 400_000, output: 100_000 }),
      req(0, 0, 0, { model: sonnet, uncached: 0, cacheRead: 0, cacheWrite: 1_000_000, output: 0 }),
    ];
    // 1×2 + 2×0.2 + 0.6×2.5 + 0.4×4 + 0.1×10 = 6.5; then 1×4 = 4 (unsplit: 1-hour).
    const priced = priceClaudeCodeTurn(requests, T0, tables);
    expect(priced.known).toBe(true);
    expect(priced.known && priced.usd).toBeCloseTo(10.5, 12);
  });

  it("is unknown before the model's first price version, for a model the book lacks, for a mixed-model turn and for a tiered price", () => {
    const one = (model: string) => [req(0, 0, 0, { model, uncached: 1, cacheRead: 0, cacheWrite: 0, output: 1 })];
    expect(priceClaudeCodeTurn(one(sonnet), Date.parse("2026-09-30T23:00:00Z"), tables).known).toBe(false);
    expect(priceClaudeCodeTurn(one("claude-unknown-9"), T0, tables).known).toBe(false);
    expect(priceClaudeCodeTurn([...one(sonnet), ...one("claude-tiered")], T0, tables).known).toBe(false);
    expect(priceClaudeCodeTurn(one("claude-tiered"), T0, tables).known).toBe(false);
  });
});

// ------------------------------------------------------------ the ranking

describe("rankedModels", () => {
  it("orders by total, cheapest first, unknown totals last, ties by model id", () => {
    expect(
      rankedModels([
        { model: "c", value: 3 },
        { model: "u", value: null },
        { model: "b", value: 1 },
        { model: "a", value: 1 },
      ]),
    ).toEqual(["a", "b", "c", "u"]);
  });
});

// ------------------------------------------------------------ privacy

describe("leaksIn", () => {
  const home = "/home/someone";
  it("finds the home path and any prompt's opening words, raw or JSON-escaped", () => {
    expect(leaksIn('{"a":"/home/someone/x"}', home, [])).toEqual({ homePath: true, prompts: 0 });
    expect(leaksIn('{"a":"please refactor the \\"parser\\" module now and more"}', home, ['please refactor the "parser" module now and more'])).toEqual({ homePath: false, prompts: 1 });
  });

  it("ignores prompts too short to be told from ordinary words", () => {
    expect(leaksIn('{"model":"claude-haiku-5.5"}', home, ["claude-haiku-5.5", "ok"])).toEqual({ homePath: false, prompts: 0 });
  });
});
