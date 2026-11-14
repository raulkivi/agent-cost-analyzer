// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Unit tests of the savings oracle on small synthetic Claude Code logs. Every
// expected figure is worked out by hand in the test (rates × tokens), so the
// oracle is checked against arithmetic, not against the product.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";
import { describe, expect, it } from "vitest";
import {
  activeBranchOf,
  bookModelIds,
  idleBreaksOf,
  loadBundledTables,
  modelTablesFrom,
  parseJsonl,
  requestsOf,
  toolSessionFactsOf,
  unusedToolRowOf,
  type RawLine,
} from "./savings-oracle.mjs";

// A one-model price book and vendor profile, as the bundled JSON files are shaped.
const BOOK = {
  versions: [
    {
      id: "anthropic-api:claude-sonnet-5.5:2026-10-07",
      modelId: "claude-sonnet-5.5",
      effectiveFrom: "2026-10-07",
      kind: "list",
      tiers: [{ inputUsdPerM: 2, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 2.5, extendedCacheWriteUsdPerM: 4, outputUsdPerM: 10 }],
    },
    {
      id: "anthropic-api:claude-sonnet-5.5:2026-10-01",
      modelId: "claude-sonnet-5.5",
      effectiveFrom: "2026-10-01",
      effectiveTo: "2026-10-07",
      kind: "list",
      tiers: [{ inputUsdPerM: 2, cachedInputUsdPerM: 0.2, cacheWriteUsdPerM: 2.5, extendedCacheWriteUsdPerM: 4, outputUsdPerM: 10 }],
    },
  ],
};
const PROFILE = {
  caching: { kind: "breakpoints", defaultTtlMinutes: 5, extendedTtlMinutes: 60, minCacheableTokens: 1000 },
  models: [{ modelId: "claude-sonnet-5.5" }, { modelId: "claude-mystery-1", cachingKind: { kind: "unknown", reason: "undocumented" } }],
};
const tables = modelTablesFrom({ book: BOOK, profiles: [PROFILE] });

let seq = 0;
const uuid = () => `u${(seq += 1)}`;
const T0 = Date.parse("2026-10-20T10:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

interface Usage {
  input: number;
  read: number;
  write: number;
  output?: number;
}
function user(parent: string | null, text = "hi", minutes = 0): RawLine {
  return { type: "user", uuid: uuid(), parentUuid: parent, timestamp: at(minutes), message: { role: "user", content: text } };
}
function assistant(parent: string, id: string, minutes: number, usage: Usage | null, extra: { model?: string; tools?: string[] } = {}): RawLine {
  return {
    type: "assistant",
    uuid: uuid(),
    parentUuid: parent,
    timestamp: at(minutes),
    message: {
      id,
      model: extra.model ?? "claude-sonnet-5-5-20261001",
      content: (extra.tools ?? []).map((name) => ({ type: "tool_use", id: `t-${name}`, name, input: {} })),
      ...(usage ? { usage: { input_tokens: usage.input, cache_read_input_tokens: usage.read, cache_creation_input_tokens: usage.write, output_tokens: usage.output ?? 10 } } : {}),
    },
  };
}
// A linear chain of lines, each the parent of the next.
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

describe("parseJsonl", () => {
  it("skips blank and malformed lines and lines without a type", () => {
    const lines = parseJsonl('{"type":"user","a":1}\n\nnot json\n{"nope":1}\n{"type":"assistant"}\n');
    expect(lines.map((l) => l.type)).toEqual(["user", "assistant"]);
  });
});

describe("activeBranchOf", () => {
  it("follows the last last-prompt leaf and leaves the abandoned fork out", () => {
    const root = user(null, "root");
    const a = assistant(root.uuid as string, "m-a", 1, { input: 1, read: 0, write: 0 });
    const fork = assistant(root.uuid as string, "m-fork", 2, { input: 1, read: 0, write: 0 });
    const marker: RawLine = { type: "last-prompt", leafUuid: a.uuid };
    expect(activeBranchOf([root, a, fork, marker]).map((l) => l.uuid)).toEqual([root.uuid, a.uuid]);
  });

  it("falls back to the last leaf in the file without a marker", () => {
    const root = user(null);
    const a = assistant(root.uuid as string, "m-a", 1, { input: 1, read: 0, write: 0 });
    const fork = assistant(root.uuid as string, "m-fork", 2, { input: 1, read: 0, write: 0 });
    expect(activeBranchOf([root, a, fork]).map((l) => l.uuid)).toEqual([root.uuid, fork.uuid]);
  });
});

describe("requestsOf", () => {
  it("makes one request per message id, skips synthetic rounds, and clamps times to non-decreasing", () => {
    const lines = chain([
      (p) => user(p, "q1", 0),
      (p) => assistant(p, "m1", 1, { input: 5, read: 100, write: 20 }),
      (p) => assistant(p, "m1", 1, { input: 5, read: 100, write: 20 }), // second content block of the same response
      (p) => assistant(p, "m-syn", 2, { input: 0, read: 0, write: 0 }, { model: "<synthetic>" }),
      (p) => assistant(p, "m2", 0, { input: 6, read: 120, write: 0 }), // logged earlier than m1
    ]);
    const requests = requestsOf(lines);
    expect(requests.map((r) => [r.index, r.turn, r.uncached, r.cacheRead, r.cacheWrite])).toEqual([
      [0, 0, 5, 100, 20],
      [1, 0, 6, 120, 0],
    ]);
    expect(requests[1]!.atMs).toBe(requests[0]!.atMs);
  });

  it("drops a whole turn when one of its requests has no usage, as the trace does", () => {
    const lines = chain([
      (p) => user(p, "q1", 0),
      (p) => assistant(p, "m1", 1, { input: 5, read: 100, write: 20 }),
      (p) => user(p, "q2", 2),
      (p) => assistant(p, "m2", 3, { input: 5, read: 100, write: 20 }),
      (p) => assistant(p, "m3", 4, null),
    ]);
    expect(requestsOf(lines).map((r) => r.turn)).toEqual([0]);
  });

  it("marks the first request after a compact boundary as a compaction", () => {
    const lines = chain([
      (p) => user(p, "q1", 0),
      (p) => assistant(p, "m1", 1, { input: 5, read: 100, write: 20 }),
      (p) => ({ type: "system", subtype: "compact_boundary", uuid: uuid(), parentUuid: p, timestamp: at(2) }),
      (p) => assistant(p, "m2", 3, { input: 5, read: 0, write: 100 }),
      (p) => assistant(p, "m3", 4, { input: 5, read: 100, write: 0 }),
    ]);
    expect(requestsOf(lines).map((r) => r.compaction)).toEqual([false, true, false]);
  });
});

describe("bookModelIds", () => {
  it("tries the id, its dated and dotted spellings, and drops a context tag", () => {
    expect(bookModelIds("claude-sonnet-5-5-20261001")).toContain("claude-sonnet-5.5");
    expect(bookModelIds("Claude-Opus-5[1m]")).toContain("claude-opus-5");
    expect(bookModelIds("claude-opus-4-8")).toContain("claude-opus-4.8");
  });
});

describe("idleBreaksOf", () => {
  // Prompt 20,000 tokens (read 19,000 + write 500 + uncached 500), then idle.
  const warm = { input: 500, read: 19_000, write: 500 };
  // After the idle gap the whole prompt is re-written: lost = 20,000 - 0 = 20,000.
  const cold = { input: 500, read: 0, write: 19_500 };

  function twoRequests(gapMinutes: number, second: Usage, opts: { model?: string; startMinutes?: number } = {}) {
    const start = opts.startMinutes ?? 0;
    return requestsOf(
      chain([
        (p) => user(p, "q", start),
        (p) => assistant(p, "m1", start + 1, warm),
        (p) => user(p, "q2", start + 1 + gapMinutes - 1),
        (p) => assistant(p, "m2", start + 1 + gapMinutes, second, opts.model ? { model: opts.model } : {}),
      ]),
    );
  }

  it("finds an idle expiry past the 60-minute lifetime and prices it as (write - read) x lost, by hand", () => {
    const [found, ...rest] = idleBreaksOf(twoRequests(90, cold), tables);
    expect(rest).toEqual([]);
    expect(found).toMatchObject({ requestIndex: 1, gapMinutes: 90, previousPrompt: 20_000, prompt: 20_000, cacheRead: 0, lostTokens: 20_000, ttlMinutes: 60 });
    // 2026-10-20: 1-hour write $4/M, uncached $2/M, cache read $0.10/M: 20,000 x (4 - 0.1) / 1e6.
    expect(found!.cost).toMatchObject({ known: true, versionId: "anthropic-api:claude-sonnet-5.5:2026-10-07" });
    expect(found!.cost.known && found!.cost.high).toBeCloseTo(0.078, 12);
  });

  it("uses the price in force at the break's time (the older cache-read price before 2026-10-07)", () => {
    const early = requestsOf(
      chain([
        (p) => user(p, "q", 0),
        (p) => assistant(p, "m1", 1, warm),
        (p) => assistant(p, "m2", 91, cold),
      ]).map((line) => ({ ...line, timestamp: new Date(Date.parse(line.timestamp as string) - 14 * 86_400_000).toISOString() })),
    );
    const [found] = idleBreaksOf(early, tables);
    // 2026-10-06: cache read $0.20/M.
    expect(found!.cost.known && found!.cost.high).toBeCloseTo((20_000 * (4 - 0.2)) / 1e6, 12);
  });

  it("does not count a gap inside the lifetime, a model switch, a compaction or a small loss", () => {
    expect(idleBreaksOf(twoRequests(30, cold), tables)).toEqual([]);
    expect(idleBreaksOf(twoRequests(90, cold, { model: "claude-sonnet-4-6" }), tables)).toEqual([]);
    // 60 minutes exactly is not longer than the lifetime.
    expect(idleBreaksOf(twoRequests(60, cold), tables)).toEqual([]);
    // Lost 900 tokens: under half the previous prompt and under the 1,000 minimum.
    expect(idleBreaksOf(twoRequests(90, { input: 500, read: 19_100, write: 400 }), tables)).toEqual([]);
    const compacted = requestsOf(
      chain([
        (p) => user(p, "q", 0),
        (p) => assistant(p, "m1", 1, warm),
        (p) => ({ type: "system", subtype: "compact_boundary", uuid: uuid(), parentUuid: p, timestamp: at(50) }),
        (p) => assistant(p, "m2", 91, cold),
      ]),
    );
    expect(idleBreaksOf(compacted, tables)).toEqual([]);
  });

  it("leaves out a request whose model has no documented caching rules", () => {
    const requests = twoRequests(90, cold, { model: "claude-mystery-1" });
    expect(idleBreaksOf(requests, tables)).toEqual([]);
  });

  it("reports a break with no price as unpriced, never 0", () => {
    const [found] = idleBreaksOf(twoRequests(90, cold, { startMinutes: -60 * 24 * 40 }), tables);
    expect(found!.cost).toMatchObject({ known: false });
  });
});

describe("tool definitions and unused tools", () => {
  const shape = {
    type: "api-request-shape",
    shapeHash: "h1",
    shape: {
      tools: [
        { name: "Workflow", description: "Run a workflow.", input_schema: { type: "object", properties: { script: { type: "string" } } } },
        { name: "mcp__acme__alpha", description: "Alpha", input_schema: { type: "object" } },
        { name: "mcp__acme__beta", description: "Beta", input_schema: { type: "object" }, defer_loading: true },
        { name: "Read", description: "Read a file", input_schema: { type: "object" } },
      ],
    },
  };
  const mainRequest = { type: "api-request", shapeHash: "h1", querySource: "repl_main_thread" };
  const sideRequest = { type: "api-request", shapeHash: "h-other", querySource: "sdk" };

  const log = (invoked: string[]): RawLine[] => [
    shape,
    mainRequest,
    sideRequest,
    ...chain([
      (p) => user(p, "q", 0),
      (p) => assistant(p, "m1", 1, { input: 100, read: 900, write: 0 }, { tools: invoked }),
      (p) => assistant(p, "m2", 2, { input: 100, read: 900, write: 0 }),
    ]),
  ];

  it("counts a loaded tool's description plus input schema, and a deferred tool by its name alone", () => {
    const facts = toolSessionFactsOf(log([]));
    const workflow = countTokens("Run a workflow." + JSON.stringify({ type: "object", properties: { script: { type: "string" } } }));
    expect(facts.loaded?.get("Workflow")).toBe(workflow);
    expect(facts.loaded?.get("mcp__acme__beta")).toBe(countTokens("mcp__acme__beta"));
    expect(facts.requestsByModel.get("claude-sonnet-5-5-20261001")).toBe(2);
    expect(facts.firstRequestAt).toBe(at(1));
  });

  it("notes which tools ran on the active branch", () => {
    expect([...toolSessionFactsOf(log(["Read"])).invoked]).toEqual(["Read"]);
  });

  it("has no inventory without a recorded shape", () => {
    expect(toolSessionFactsOf(chain([(p) => user(p), (p) => assistant(p, "m", 1, { input: 1, read: 1, write: 0 })])).loaded).toBeUndefined();
  });

  it("prices the row as tokens x requests x (cache-read, uncached input) rate, by hand", () => {
    const facts = toolSessionFactsOf(log([]));
    const row = unusedToolRowOf("Workflow", [facts, facts], tables);
    const tokens = facts.loaded!.get("Workflow")!;
    expect(row).toMatchObject({ sessions: 2, requests: 4, tokensPerSession: tokens, ran: false });
    // 2026-10-20: cache read $0.10/M, uncached $2/M; 2 requests in each of 2 sessions.
    expect(row.low).toBeCloseTo((tokens * 0.1 * 4) / 1e6, 12);
    expect(row.high).toBeCloseTo((tokens * 2 * 4) / 1e6, 12);
  });

  it("groups an MCP server's tools and sums their tokens; the server counts as used when one tool ran", () => {
    const unused = toolSessionFactsOf(log([]));
    const alpha = countTokens("Alpha" + JSON.stringify({ type: "object" }));
    const beta = countTokens("mcp__acme__beta");
    expect(unusedToolRowOf("acme", [unused], tables)).toMatchObject({ tokensPerSession: alpha + beta, ran: false });
    expect(unusedToolRowOf("acme", [unused, toolSessionFactsOf(log(["mcp__acme__alpha"]))], tables).ran).toBe(true);
  });
});

describe("loadBundledTables", () => {
  const fixtures = fileURLToPath(new URL("../fixtures", import.meta.url));

  it("reads the bundled price book and vendor profiles as plain JSON", () => {
    const bundled = loadBundledTables(fixtures);
    const version = bundled.priceVersion("claude-sonnet-5-5-20261001", Date.parse("2026-10-20T00:00:00Z"));
    expect(version?.id).toBe("anthropic-api:claude-sonnet-5.5:2026-10-07");
    // fixtures/price-book/anthropic-api.json: cache reads cut to $0.10/M on 2026-10-07.
    expect(version?.tiers[0]?.cachedInputUsdPerM).toBe(0.1);
    expect(bundled.priceVersion("claude-sonnet-5.5", Date.parse("2020-01-01T00:00:00Z"))).toBeUndefined();
    // Anthropic's profile: 1-hour option, so Claude Code's lifetime is 60 minutes.
    expect(bundled.cacheRules("claude-sonnet-5-5-20261001")).toMatchObject({ ttlMinutes: 60 });
  });
});

describe("independence", () => {
  it("imports nothing from the product's sources", () => {
    const source = readFileSync(new URL("./savings-oracle.mts", import.meta.url), "utf-8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    expect(imports.filter((specifier) => specifier.startsWith(".") || specifier.includes("@agent-cost-analyzer"))).toEqual([]);
  });
});
