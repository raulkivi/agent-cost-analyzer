import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openReadOnlyDb } from "../sqlite/session-store.js";
import {
  NANO_AIU_PER_AI_CREDIT,
  nanoAiuToAiCredits,
  readAgentHostSessionModel,
  readAgentHostSessionTitle,
  readAgentHostTurns,
} from "./agent-session-store.js";

const FIXTURES = new URL("../../../fixtures/agent-host/", import.meta.url);
const schemaSql = readFileSync(new URL("session.schema.sql", FIXTURES), "utf8");
const fixture = JSON.parse(readFileSync(new URL("session-rows.json", FIXTURES), "utf8")) as {
  turns: { id: string; event_id: string; checkpoint_ref: string }[];
  turn_usage: { turn_id: string; usage: unknown }[];
  session_metadata: { key: string; value: string }[];
};

let dir: string;
const open: DatabaseSync[] = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agent-session-store-"));
});
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function build(seed: (db: DatabaseSync) => void, schema: string = schemaSql): DatabaseSync {
  const file = path.join(dir, `session-${open.length}.db`);
  const w = new DatabaseSync(file);
  w.exec("PRAGMA foreign_keys = OFF;");
  w.exec(schema);
  seed(w);
  w.close();
  const db = openReadOnlyDb(file);
  open.push(db);
  return db;
}

const asText = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

function insertTurn(db: DatabaseSync, id: string): void {
  db.prepare("INSERT INTO turns (id, event_id, checkpoint_ref) VALUES (?,?,?)").run(id, `e-${id}`, `ref-${id}`);
}
function insertUsage(db: DatabaseSync, turnId: string, usage: unknown): void {
  db.prepare("INSERT INTO turn_usage (turn_id, usage) VALUES (?,?)").run(turnId, asText(usage));
}
function insertMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO session_metadata (key, value) VALUES (?,?)").run(key, value);
}

function fromFixture(): DatabaseSync {
  return build((db) => {
    for (const t of fixture.turns) db.prepare("INSERT INTO turns (id, event_id, checkpoint_ref) VALUES (?,?,?)").run(t.id, t.event_id, t.checkpoint_ref);
    for (const u of fixture.turn_usage) insertUsage(db, u.turn_id, u.usage);
    for (const m of fixture.session_metadata) insertMeta(db, m.key, m.value);
  });
}

/** One turn with the given usage; returns its parsed usage. */
function usageOf(usage: unknown) {
  const db = build((w) => {
    insertTurn(w, "t1");
    insertUsage(w, "t1", usage);
  });
  const rows = readAgentHostTurns(db);
  expect(rows).toHaveLength(1);
  return rows[0]!.usage;
}

const T = (n: number) => `request_7c0de000-0000-4000-8000-00000000000${n}`;

describe("nanoAiuToAiCredits (rule 8)", () => {
  it("divides by 1e9", () => {
    expect(NANO_AIU_PER_AI_CREDIT).toBe(1_000_000_000);
    expect(nanoAiuToAiCredits(1_000_000_000)).toBe(1);
    expect(nanoAiuToAiCredits(2_500_000_000)).toBe(2.5);
    expect(nanoAiuToAiCredits(0)).toBe(0);
    expect(nanoAiuToAiCredits(1_285_093_000)).toBeCloseTo(1.285093, 9);
    expect(nanoAiuToAiCredits(1_285_093_000)).toBe(1_285_093_000 / 1_000_000_000);
  });
});

describe("readAgentHostTurns on the real-shaped fixture", () => {
  it("returns every turn in insertion order, with exact hand-computed values", () => {
    const rows = readAgentHostTurns(fromFixture());
    expect(rows).toEqual([
      // turn 1: single model
      {
        turnId: T(1),
        usage: { tokens: { input: 459425, cached: 410538, output: 5271 }, model: "gpt-6-luna", nanoAiu: 1285093000 },
      },
      // turn 2: two models summed (9899296+59601, 9847477+35655, 36139+1297); top-level model wins
      {
        turnId: T(2),
        usage: { tokens: { input: 9958897, cached: 9883132, output: 37436 }, model: "claude-sonnet-5", nanoAiu: 246039490000 },
      },
      // turn 3: no turn_usage row
      { turnId: T(3), usage: null },
      // turn 4: top-level model (gpt-5.3-codex) differs from first totals entry (gpt-6.1-sol): top-level wins
      {
        turnId: T(4),
        usage: { tokens: { input: 466898, cached: 331673, output: 8588 }, model: "gpt-5.3-codex", nanoAiu: 35494578000 },
      },
      {
        turnId: T(5),
        usage: { tokens: { input: 111111, cached: 108174, output: 268 }, model: "gpt-6-luna", nanoAiu: 158271500 },
      },
    ]);
  });

  it("ignores the top-level last-call tokens (rule 3)", () => {
    const rows = readAgentHostTurns(fromFixture());
    // turn 1 top-level inputTokens is 48857 / outputTokens 450 / cacheReadTokens 48398
    expect(rows[0]!.usage!.tokens!.input).not.toBe(48857);
    expect(rows[0]!.usage!.tokens!.output).not.toBe(450);
    expect(rows[0]!.usage!.tokens!.cached).not.toBe(48398);
  });

  it("ignores sessionTotalNanoAiu (rule 5)", () => {
    // turn 1 sessionTotalNanoAiu is 1208465000, totalNanoAiu is 1285093000
    expect(readAgentHostTurns(fromFixture())[0]!.usage!.nanoAiu).toBe(1285093000);
  });

  it("converts nanoAiu to AI Credits by hand-computed amounts", () => {
    const rows = readAgentHostTurns(fromFixture());
    const credits = rows.map((r) => (r.usage?.nanoAiu == null ? null : nanoAiuToAiCredits(r.usage.nanoAiu)));
    expect(credits[0]).toBeCloseTo(1.285093, 9);
    expect(credits[1]).toBeCloseTo(246.03949, 9);
    expect(credits[2]).toBeNull();
    expect(credits[3]).toBeCloseTo(35.494578, 9);
    expect(credits[4]).toBeCloseTo(0.1582715, 9);
  });
});

describe("readAgentHostTurns table presence and ordering (rule 1)", () => {
  it("returns [] without a turns table", () => {
    const db = build(() => {}, "CREATE TABLE session_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);");
    expect(readAgentHostTurns(db)).toEqual([]);
  });

  it("returns [] for an empty database", () => {
    expect(readAgentHostTurns(build(() => {}, ""))).toEqual([]);
  });

  it("returns [] for an empty turns table", () => {
    expect(readAgentHostTurns(build(() => {}))).toEqual([]);
  });

  it("gives every usage null when there is no turn_usage table", () => {
    const schema = "CREATE TABLE turns (id TEXT PRIMARY KEY NOT NULL, event_id TEXT, checkpoint_ref TEXT);";
    const db = build((w) => {
      insertTurn(w, "a");
      insertTurn(w, "b");
    }, schema);
    expect(readAgentHostTurns(db)).toEqual([
      { turnId: "a", usage: null },
      { turnId: "b", usage: null },
    ]);
  });

  it("orders by rowid (insertion order), not by id", () => {
    const db = build((w) => {
      insertTurn(w, "zzz");
      insertTurn(w, "aaa");
      insertTurn(w, "mmm");
    });
    expect(readAgentHostTurns(db).map((r) => r.turnId)).toEqual(["zzz", "aaa", "mmm"]);
  });

  it("does not drop turns that have no usage row and does not duplicate turns", () => {
    const db = build((w) => {
      insertTurn(w, "a");
      insertTurn(w, "b");
      insertUsage(w, "b", { _meta: { turnTokenTotals: [{ model: "m", inputTokens: 1, cachedTokens: 0, outputTokens: 2 }] } });
    });
    const rows = readAgentHostTurns(db);
    expect(rows.map((r) => r.turnId)).toEqual(["a", "b"]);
    expect(rows[0]!.usage).toBeNull();
    expect(rows[1]!.usage).not.toBeNull();
  });
});

describe("usage parsing (rule 2)", () => {
  it("is null for invalid JSON", () => {
    expect(usageOf("{broken")).toBeNull();
    expect(usageOf("")).toBeNull();
  });
  it("is null for JSON that is not an object", () => {
    expect(usageOf("null")).toBeNull();
    expect(usageOf("42")).toBeNull();
    expect(usageOf('"str"')).toBeNull();
    expect(usageOf("[]")).toBeNull();
    expect(usageOf("[1,2]")).toBeNull();
    expect(usageOf("true")).toBeNull();
  });
  it("is an object with all-null fields for an empty object", () => {
    expect(usageOf({})).toEqual({ tokens: null, model: null, nanoAiu: null });
  });
});

describe("tokens (rule 3)", () => {
  const entry = (o: Record<string, unknown>) => ({ model: "m", inputTokens: 0, cachedTokens: 0, outputTokens: 0, ...o });
  const tokens = (totals: unknown) => usageOf({ _meta: { turnTokenTotals: totals } })!.tokens;

  it("sums fields over entries", () => {
    expect(
      tokens([
        entry({ inputTokens: 10, cachedTokens: 4, outputTokens: 1 }),
        entry({ inputTokens: 5, cachedTokens: 2, outputTokens: 7 }),
        entry({ inputTokens: 100, cachedTokens: 0, outputTokens: 0 }),
      ]),
    ).toEqual({ input: 115, cached: 6, output: 8 });
  });

  it("is null when turnTokenTotals is missing, not an array, or empty", () => {
    expect(usageOf({ _meta: {} })!.tokens).toBeNull();
    expect(usageOf({})!.tokens).toBeNull();
    expect(usageOf({ _meta: null })!.tokens).toBeNull();
    expect(tokens(undefined)).toBeNull();
    expect(tokens(null)).toBeNull();
    expect(tokens({ inputTokens: 5 })).toBeNull();
    expect(tokens("x")).toBeNull();
    expect(tokens(7)).toBeNull();
    expect(tokens([])).toBeNull();
  });

  it("counts missing or null numeric fields as 0", () => {
    expect(tokens([{ model: "m", inputTokens: 10 }])).toEqual({ input: 10, cached: 0, output: 0 });
    expect(
      tokens([
        entry({ inputTokens: null, cachedTokens: null, outputTokens: null }),
        entry({ inputTokens: 3, cachedTokens: 1, outputTokens: 2 }),
      ]),
    ).toEqual({ input: 3, cached: 1, output: 2 });
  });

  it("treats Infinity / NaN (encoded as JSON out-of-range or null) as 0", () => {
    // JSON.stringify turns NaN/Infinity into null; 1e999 parses to Infinity.
    const db = build((w) => {
      insertTurn(w, "t");
      insertUsage(
        w,
        "t",
        '{"_meta":{"turnTokenTotals":[{"model":"m","inputTokens":1e999,"cachedTokens":-1e999,"outputTokens":5},{"model":"m","inputTokens":2,"cachedTokens":3,"outputTokens":null}]}}',
      );
    });
    expect(readAgentHostTurns(db)[0]!.usage!.tokens).toEqual({ input: 2, cached: 3, output: 5 });
  });

  it("counts non-number fields as 0 and skips non-object entries", () => {
    const u = usageOf({
      _meta: {
        turnTokenTotals: [
          "junk",
          null,
          7,
          { model: "m", inputTokens: "100", cachedTokens: { n: 1 }, outputTokens: 5 },
          { model: "m", inputTokens: 10, cachedTokens: 4, outputTokens: [1] },
        ],
      },
    });
    expect(u?.tokens).toEqual({ input: 10, cached: 4, output: 5 });
  });
  it("never uses top-level inputTokens/outputTokens/cacheReadTokens", () => {
    const u = usageOf({ inputTokens: 999, outputTokens: 888, cacheReadTokens: 777, model: "m" });
    expect(u!.tokens).toBeNull();
    const u2 = usageOf({
      inputTokens: 999,
      outputTokens: 888,
      cacheReadTokens: 777,
      _meta: { turnTokenTotals: [{ model: "m", inputTokens: 1, cachedTokens: 2, outputTokens: 3 }] },
    });
    expect(u2!.tokens).toEqual({ input: 1, cached: 2, output: 3 });
  });

  it("ignores directTurnTokenTotals", () => {
    const u = usageOf({
      _meta: {
        turnTokenTotals: [{ model: "m", inputTokens: 10, cachedTokens: 1, outputTokens: 2 }],
        directTurnTokenTotals: [{ model: "m", inputTokens: 1000, cachedTokens: 1000, outputTokens: 1000 }],
      },
    });
    expect(u!.tokens).toEqual({ input: 10, cached: 1, output: 2 });
  });
});

describe("model (rule 4)", () => {
  const totals = (m: unknown) => [{ model: m, inputTokens: 1, cachedTokens: 0, outputTokens: 1 }];

  it("prefers the top-level model", () => {
    expect(usageOf({ model: "top", _meta: { turnTokenTotals: totals("entry") } })!.model).toBe("top");
  });
  it("falls back to the first turnTokenTotals entry model", () => {
    expect(usageOf({ _meta: { turnTokenTotals: totals("entry") } })!.model).toBe("entry");
    expect(
      usageOf({
        model: "",
        _meta: { turnTokenTotals: [{ model: "first" }, { model: "second" }] },
      })!.model,
    ).toBe("first");
  });
  it("uses only the FIRST entry for the fallback, even if it has no model", () => {
    expect(usageOf({ _meta: { turnTokenTotals: [{ inputTokens: 1 }, { model: "second" }] } })!.model).toBeNull();
    expect(usageOf({ _meta: { turnTokenTotals: [{ model: "" }, { model: "second" }] } })!.model).toBeNull();
  });
  it("is null when neither is a non-empty string", () => {
    expect(usageOf({})!.model).toBeNull();
    expect(usageOf({ model: 5, _meta: { turnTokenTotals: totals(7) } })!.model).toBeNull();
    expect(usageOf({ model: null, _meta: { turnTokenTotals: [] } })!.model).toBeNull();
  });
  it("falls back when the top-level model is not a string", () => {
    expect(usageOf({ model: 12, _meta: { turnTokenTotals: totals("entry") } })!.model).toBe("entry");
  });
});

describe("nanoAiu (rule 5)", () => {
  const nano = (cu: unknown) => usageOf({ _meta: { copilotUsage: cu } })!.nanoAiu;

  it("reads _meta.copilotUsage.totalNanoAiu", () => {
    expect(nano({ totalNanoAiu: 123456789 })).toBe(123456789);
    expect(nano({ totalNanoAiu: 0 })).toBe(0);
    expect(nano({ totalNanoAiu: 1.5 })).toBe(1.5);
  });
  it("is null when absent or malformed", () => {
    expect(usageOf({})!.nanoAiu).toBeNull();
    expect(usageOf({ _meta: {} })!.nanoAiu).toBeNull();
    expect(nano(null)).toBeNull();
    expect(nano({})).toBeNull();
    expect(nano("5")).toBeNull();
    expect(nano({ totalNanoAiu: "5" })).toBeNull();
    expect(nano({ totalNanoAiu: null })).toBeNull();
  });
  it("is null for negative or non-finite values", () => {
    expect(nano({ totalNanoAiu: -1 })).toBeNull();
    expect(nano({ totalNanoAiu: -0.5 })).toBeNull();
    const db = build((w) => {
      insertTurn(w, "t");
      insertUsage(w, "t", '{"_meta":{"copilotUsage":{"totalNanoAiu":1e999}}}');
    });
    expect(readAgentHostTurns(db)[0]!.usage!.nanoAiu).toBeNull();
  });
  it("ignores sessionTotalNanoAiu and directCopilotUsage", () => {
    expect(nano({ sessionTotalNanoAiu: 999 })).toBeNull();
    expect(
      usageOf({ _meta: { directCopilotUsage: { totalNanoAiu: 77 } } })!.nanoAiu,
    ).toBeNull();
    expect(nano({ totalNanoAiu: 5, sessionTotalNanoAiu: 999 })).toBe(5);
  });
});

describe("readAgentHostSessionModel (rule 6)", () => {
  const modelOf = (value: string | null, table = true) =>
    readAgentHostSessionModel(
      build((w) => {
        if (value !== null) insertMeta(w, "copilot.model", value);
      }, table ? schemaSql : "CREATE TABLE turns (id TEXT PRIMARY KEY NOT NULL);"),
    );

  it("reads the id from the fixture", () => {
    expect(readAgentHostSessionModel(fromFixture())).toBe("gpt-6-luna");
  });
  it("returns the JSON id", () => {
    expect(modelOf('{"id":"claude-sonnet-5","config":{"thinkingLevel":"low"}}')).toBe("claude-sonnet-5");
  });
  it("is null for a missing row", () => {
    expect(modelOf(null)).toBeNull();
  });
  it("is null for a missing session_metadata table", () => {
    expect(modelOf(null, false)).toBeNull();
  });
  it("is null for invalid JSON or wrong shapes", () => {
    expect(modelOf("not json")).toBeNull();
    expect(modelOf("gpt-6-luna")).toBeNull();
    expect(modelOf("null")).toBeNull();
    expect(modelOf("[]")).toBeNull();
    expect(modelOf("{}")).toBeNull();
    expect(modelOf('{"id":""}')).toBeNull();
    expect(modelOf('{"id":5}')).toBeNull();
    expect(modelOf('{"id":null}')).toBeNull();
    expect(modelOf('{"config":{"id":"nested"}}')).toBeNull();
  });
});

describe("readAgentHostSessionTitle (rule 7)", () => {
  const titleOf = (value: string | null, table = true) =>
    readAgentHostSessionTitle(
      build((w) => {
        if (value !== null) insertMeta(w, "customTitle", value);
      }, table ? schemaSql : "CREATE TABLE turns (id TEXT PRIMARY KEY NOT NULL);"),
    );

  it("reads the plain-text customTitle from the fixture", () => {
    expect(readAgentHostSessionTitle(fromFixture())).toBe("Example custom title");
  });
  it("does not JSON-parse the value", () => {
    expect(titleOf('{"a":1}')).toBe('{"a":1}');
    expect(titleOf('"quoted"')).toBe('"quoted"');
  });
  it("is null for a missing row or table", () => {
    expect(titleOf(null)).toBeNull();
    expect(titleOf(null, false)).toBeNull();
  });
  it("returns the title trimmed", () => {
    expect(titleOf("  padded  ")).toBe("padded");
  });
  it("is null for blank values", () => {
    expect(titleOf("")).toBeNull();
    expect(titleOf("   ")).toBeNull();
    expect(titleOf("\n\t")).toBeNull();
  });
  it("does not use customTitleSource or chat-scoped title keys", () => {
    const db = build((w) => {
      insertMeta(w, "customTitleSource", "agent");
      insertMeta(w, "customChatTitle:ahp-chat://default/xyz", "Chat scoped");
    });
    expect(readAgentHostSessionTitle(db)).toBeNull();
  });
});

describe("read-only behaviour", () => {
  it("never writes: the DB file is unchanged after reads", () => {
    const file = path.join(dir, "ro.db");
    const w = new DatabaseSync(file);
    w.exec(schemaSql);
    insertTurn(w, "a");
    insertMeta(w, "customTitle", "x");
    w.close();
    const before = readFileSync(file);
    const db = openReadOnlyDb(file);
    open.push(db);
    readAgentHostTurns(db);
    readAgentHostSessionModel(db);
    readAgentHostSessionTitle(db);
    expect(readFileSync(file).equals(before)).toBe(true);
  });
});
