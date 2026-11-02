import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import {
  NANO_AIU_PER_AI_CREDIT,
  nanoAiuToAiCredits,
  readAgentHostSessionModel,
  readAgentHostSessionTitle,
  readAgentHostTurnEventIds,
  readAgentHostTurns,
  type AgentHostTurnEventRef,
  type AgentHostTurnRow,
  type AgentHostTurnUsage,
} from "./agent-session-store.js";

// Real DDL, verbatim from fixtures/agent-host/session.schema.sql.
const TURNS_DDL = `
  CREATE TABLE turns (
    id TEXT PRIMARY KEY NOT NULL,
    event_id TEXT,
    checkpoint_ref TEXT
  )
`;

const TURN_USAGE_DDL = `
  CREATE TABLE turn_usage (
    turn_id TEXT PRIMARY KEY NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
    usage TEXT NOT NULL
  )
`;

const SESSION_METADATA_DDL = `
  CREATE TABLE session_metadata (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  )
`;

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/agent-host",
);

interface TurnFixtureRow {
  id: string;
  event_id: string;
  checkpoint_ref: string;
}

interface UsageFixtureRow {
  turn_id: string;
  usage: unknown;
}

interface MetadataFixtureRow {
  key: string;
  value: string;
}

const sessionFixture = JSON.parse(
  readFileSync(path.join(fixturesDir, "session-rows.json"), "utf-8"),
) as {
  turns: TurnFixtureRow[];
  turn_usage: UsageFixtureRow[];
  session_metadata: MetadataFixtureRow[];
};

interface UsageSeed {
  turnId: string;
  // Object seeds stringify; a string seeds verbatim so a case can be invalid
  // JSON. null or undefined seeds no row at all.
  usage: unknown;
}

// The fixture stores usage as objects; the column holds plain TEXT.
function usageText(usage: unknown): string | null {
  if (usage === null || usage === undefined) {
    return null;
  }
  return typeof usage === "string" ? usage : JSON.stringify(usage);
}

// One file per database so a test can hold several shapes at once; seeded
// usage rows may name turns that were never inserted (rule 1's LEFT JOIN),
// which the turn_usage foreign key would otherwise reject.
function freshDb(dir: string, name: string): DatabaseSync {
  const db = new DatabaseSync(path.join(dir, `${name}.db`));
  db.exec("PRAGMA foreign_keys = OFF;");
  return db;
}

function createTurnsTable(db: DatabaseSync, ids: string[]): void {
  db.exec(TURNS_DDL);
  const insert = db.prepare("INSERT INTO turns (id) VALUES (?)");
  for (const id of ids) {
    insert.run(id);
  }
}

function createTurnUsageTable(db: DatabaseSync, rows: UsageSeed[]): void {
  db.exec(TURN_USAGE_DDL);
  const insert = db.prepare("INSERT INTO turn_usage (turn_id, usage) VALUES (?, ?)");
  for (const row of rows) {
    const text = usageText(row.usage);
    if (text === null) {
      continue;
    }
    insert.run(row.turnId, text);
  }
}

function createSessionMetadataTable(db: DatabaseSync, rows: MetadataFixtureRow[]): void {
  db.exec(SESSION_METADATA_DDL);
  const insert = db.prepare("INSERT INTO session_metadata (key, value) VALUES (?, ?)");
  for (const row of rows) {
    insert.run(row.key, row.value);
  }
}

// A turn per seed row so the caller can read each case back by turn id.
function readCases(db: DatabaseSync, cases: UsageSeed[]): Map<string, AgentHostTurnUsage | null> {
  createTurnsTable(
    db,
    cases.map((testCase) => testCase.turnId),
  );
  createTurnUsageTable(db, cases);
  return new Map(readAgentHostTurns(db).map((row) => [row.turnId, row.usage]));
}

function usageFor(dir: string, name: string, usage: unknown): AgentHostTurnUsage | null {
  const db = freshDb(dir, name);
  createTurnsTable(db, ["turn_a"]);
  createTurnUsageTable(db, [{ turnId: "turn_a", usage }]);
  const parsed = readAgentHostTurns(db)[0].usage;
  db.close();
  return parsed;
}

const TURN_1 = "request_7c0de000-0000-4000-8000-000000000001";
const TURN_2 = "request_7c0de000-0000-4000-8000-000000000002";
const TURN_3 = "request_7c0de000-0000-4000-8000-000000000003";
const TURN_4 = "request_7c0de000-0000-4000-8000-000000000004";
const TURN_5 = "request_7c0de000-0000-4000-8000-000000000005";

// Tokens sum `_meta.turnTokenTotals` over the turn's models, never the
// top-level `inputTokens`/`outputTokens`/`cacheReadTokens` of the last call.
const FIXTURE_ROWS: AgentHostTurnRow[] = [
  {
    turnId: TURN_1,
    usage: {
      tokens: { input: 459425, cached: 410538, output: 5271 },
      model: "gpt-6-luna",
      nanoAiu: 1285093000,
    },
  },
  {
    turnId: TURN_2,
    usage: {
      tokens: { input: 9958897, cached: 9883132, output: 37436 },
      model: "claude-sonnet-5",
      nanoAiu: 246039490000,
    },
  },
  { turnId: TURN_3, usage: null },
  {
    turnId: TURN_4,
    usage: {
      tokens: { input: 466898, cached: 331673, output: 8588 },
      model: "gpt-5.3-codex",
      nanoAiu: 35494578000,
    },
  },
  {
    turnId: TURN_5,
    usage: {
      tokens: { input: 111111, cached: 108174, output: 268 },
      model: "gpt-6-luna",
      nanoAiu: 158271500,
    },
  },
];

function fixtureDb(dir: string, tables: { turns: boolean; usage: boolean; metadata: boolean }) {
  const db = freshDb(dir, "fixture");
  if (tables.turns) {
    createTurnsTable(
      db,
      sessionFixture.turns.map((turn) => turn.id),
    );
  }
  if (tables.usage) {
    createTurnUsageTable(
      db,
      sessionFixture.turn_usage.map((row) => ({ turnId: row.turn_id, usage: row.usage })),
    );
  }
  if (tables.metadata) {
    createSessionMetadataTable(db, sessionFixture.session_metadata);
  }
  return db;
}

describe("readAgentHostTurns", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "agent-session-turns-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("rule 1 — every turn in rowid order, joined to turn_usage", () => {
    it("reads the fixture turns in insertion order with their joined usage", () => {
      const db = fixtureDb(dir, { turns: true, usage: true, metadata: false });
      expect(readAgentHostTurns(db)).toEqual(FIXTURE_ROWS);
    });

    it("returns [] when there is no turns table", () => {
      const db = fixtureDb(dir, { turns: false, usage: true, metadata: false });
      expect(readAgentHostTurns(db)).toEqual([]);
    });

    it("returns every turn with usage null when there is no turn_usage table", () => {
      const db = fixtureDb(dir, { turns: true, usage: false, metadata: false });
      expect(readAgentHostTurns(db)).toEqual([
        { turnId: TURN_1, usage: null },
        { turnId: TURN_2, usage: null },
        { turnId: TURN_3, usage: null },
        { turnId: TURN_4, usage: null },
        { turnId: TURN_5, usage: null },
      ]);
    });

    it("keeps a turn whose turn_usage row is missing", () => {
      const db = freshDb(dir, "join");
      createTurnsTable(db, ["t-1", "t-2"]);
      createTurnUsageTable(db, [{ turnId: "t-1", usage: { model: "m" } }]);

      expect(readAgentHostTurns(db)).toEqual([
        { turnId: "t-1", usage: { tokens: null, model: "m", nanoAiu: null } },
        { turnId: "t-2", usage: null },
      ]);
    });

    it("orders by rowid, the insertion order, not by id", () => {
      const db = freshDb(dir, "order");
      createTurnsTable(db, ["z-first", "a-second", "m-third"]);

      expect(readAgentHostTurns(db).map((row) => row.turnId)).toEqual([
        "z-first",
        "a-second",
        "m-third",
      ]);
    });

    it("ignores turn_usage rows whose turn is not in the turns table", () => {
      const db = freshDb(dir, "orphans");
      createTurnsTable(db, ["t-1"]);
      createTurnUsageTable(db, [
        { turnId: "t-1", usage: { model: "m" } },
        { turnId: "orphan-a", usage: { model: "m2" } },
        { turnId: "orphan-b", usage: { model: "m3" } },
      ]);

      expect(readAgentHostTurns(db).map((row) => row.turnId)).toEqual(["t-1"]);
    });
  });

  describe("rule 2 — usage null unless the column holds a JSON object", () => {
    const cases: UsageSeed[] = [
      { turnId: "t-broken", usage: "{not: json" },
      { turnId: "t-blank", usage: "" },
      { turnId: "t-array", usage: '[{"model":"m"}]' },
      { turnId: "t-string", usage: '"hello"' },
      { turnId: "t-number", usage: "42" },
      { turnId: "t-null", usage: "null" },
      { turnId: "t-true", usage: "true" },
      { turnId: "t-object", usage: {} },
      { turnId: "t-object-text", usage: '{"model":"m"}' },
    ];

    it("parses JSON objects only; null for scalars, arrays and broken text", () => {
      const db = freshDb(dir, "json-shapes");
      const usages = readCases(db, cases);

      for (const testCase of cases) {
        if (testCase.turnId === "t-object" || testCase.turnId === "t-object-text") {
          continue;
        }
        expect(usages.get(testCase.turnId)).toBeNull();
      }
      expect(usages.get("t-object")).toEqual({ tokens: null, model: null, nanoAiu: null });
      expect(usages.get("t-object-text")).toEqual({ tokens: null, model: "m", nanoAiu: null });
    });
  });

  describe("rule 3 — tokens from _meta.turnTokenTotals", () => {
    it("sums one entry per model", () => {
      const usage = usageFor(dir, "sum", {
        model: "m-a",
        _meta: {
          turnTokenTotals: [
            { model: "m-a", inputTokens: 100, cachedTokens: 200, outputTokens: 30 },
            { model: "m-b", inputTokens: 1, cachedTokens: 2, outputTokens: 3 },
          ],
        },
      });

      expect(usage!.tokens).toEqual({ input: 101, cached: 202, output: 33 });
    });

    it("counts a missing or non-numeric field as 0", () => {
      const usage = usageFor(dir, "bad-fields", {
        _meta: {
          turnTokenTotals: [
            { model: "m-a", inputTokens: 100 },
            { model: "m-b", cachedTokens: "200", outputTokens: null },
            { model: "m-c", inputTokens: false, cachedTokens: 1.5, outputTokens: 2.25 },
          ],
        },
      });

      expect(usage!.tokens).toEqual({ input: 100, cached: 1.5, output: 2.25 });
    });

    it("skips entries that are not objects", () => {
      const usage = usageFor(dir, "bad-entries", {
        _meta: {
          turnTokenTotals: [
            "not-an-entry",
            null,
            7,
            ["m", 1, 2, 3],
            { model: "m-a", inputTokens: 3, cachedTokens: 4, outputTokens: 5 },
          ],
        },
      });

      expect(usage!.tokens).toEqual({ input: 3, cached: 4, output: 5 });
    });

    it("ignores directTurnTokenTotals when turnTokenTotals is absent", () => {
      const usage = usageFor(dir, "direct-only", {
        inputTokens: 500,
        outputTokens: 50,
        cacheReadTokens: 400,
        _meta: {
          directTurnTokenTotals: [
            { model: "m-a", inputTokens: 999, cachedTokens: 99, outputTokens: 9 },
          ],
        },
      });

      expect(usage!.tokens).toBeNull();
    });

    it("is null when turnTokenTotals is missing, not an array, or empty", () => {
      const db = freshDb(dir, "totals-shapes");
      const cases: UsageSeed[] = [
        { turnId: "t-no-meta", usage: { model: "m", inputTokens: 5 } },
        { turnId: "t-empty", usage: { _meta: { turnTokenTotals: [] } } },
        {
          turnId: "t-object",
          usage: { _meta: { turnTokenTotals: { model: "m", inputTokens: 5 } } },
        },
        { turnId: "t-string", usage: { _meta: { turnTokenTotals: "5,5,5" } } },
        { turnId: "t-meta-string", usage: { _meta: "nothing" } },
        {
          turnId: "t-meta-array",
          usage: { _meta: [{ turnTokenTotals: [{ inputTokens: 4 }] }] },
        },
      ];
      const usages = readCases(db, cases);

      for (const testCase of cases) {
        expect(usages.get(testCase.turnId)!.tokens).toBeNull();
      }
    });

    it("never uses the top-level token counts of the last model call", () => {
      const usage = usageFor(dir, "top-level-tokens", {
        inputTokens: 48857,
        outputTokens: 450,
        cacheReadTokens: 48398,
        _meta: {
          turnTokenTotals: [
            { model: "m-a", inputTokens: 459425, cachedTokens: 410538, outputTokens: 5271 },
          ],
        },
      });

      expect(usage!.tokens).toEqual({ input: 459425, cached: 410538, output: 5271 });
    });
  });

  describe("rule 4 — model", () => {
    it("prefers a non-empty top-level model over the turnTokenTotals entries", () => {
      const usage = usageFor(dir, "top-model", {
        model: "top-model",
        _meta: {
          turnTokenTotals: [
            { model: "first-entry", inputTokens: 1, cachedTokens: 2, outputTokens: 3 },
            { model: "second-entry", inputTokens: 1, cachedTokens: 2, outputTokens: 3 },
          ],
        },
      });

      expect(usage!.model).toBe("top-model");
    });

    it("falls back to the first turnTokenTotals entry when the top-level model is missing, empty or not a string", () => {
      const db = freshDb(dir, "model-fallback");
      const cases: UsageSeed[] = [
        {
          turnId: "t-empty",
          usage: { model: "", _meta: { turnTokenTotals: [{ model: "first-entry" }] } },
        },
        {
          turnId: "t-number",
          usage: { model: 5, _meta: { turnTokenTotals: [{ model: "first-entry" }] } },
        },
        {
          turnId: "t-null",
          usage: { model: null, _meta: { turnTokenTotals: [{ model: "first-entry" }] } },
        },
        {
          turnId: "t-object",
          usage: { model: {}, _meta: { turnTokenTotals: [{ model: "first-entry" }] } },
        },
        { turnId: "t-absent", usage: { _meta: { turnTokenTotals: [{ model: "first-entry" }] } } },
      ];
      const usages = readCases(db, cases);

      for (const testCase of cases) {
        expect(usages.get(testCase.turnId)!.model).toBe("first-entry");
      }
    });

    it("is null when neither the top level nor the first entry gives a non-empty string", () => {
      const db = freshDb(dir, "model-null");
      const cases: UsageSeed[] = [
        { turnId: "t-entry-empty", usage: { _meta: { turnTokenTotals: [{ model: "" }] } } },
        {
          turnId: "t-entry-missing",
          usage: { _meta: { turnTokenTotals: [{ inputTokens: 1 }] } },
        },
        { turnId: "t-entry-number", usage: { _meta: { turnTokenTotals: [{ model: 3 }] } } },
        {
          turnId: "t-entry-array",
          usage: { _meta: { turnTokenTotals: [{ model: ["m"] }] } },
        },
        // A skipped first entry does not hand its model to the next one.
        { turnId: "t-entry-skipped-first", usage: { _meta: { turnTokenTotals: ["x", { model: "m2" }] } } },
        { turnId: "t-no-totals", usage: { model: "", _meta: { turnTokenTotals: [] } } },
        { turnId: "t-top-empty", usage: { model: "" } },
      ];
      const usages = readCases(db, cases);

      for (const testCase of cases) {
        expect(usages.get(testCase.turnId)!.model).toBeNull();
      }
    });
  });

  describe("rule 5 — nanoAiu from _meta.copilotUsage", () => {
    it("reads copilotUsage.totalNanoAiu, ignoring the sibling figures", () => {
      const usage = usageFor(dir, "aiu", {
        _meta: {
          copilotUsage: { totalNanoAiu: 246039490000, sessionTotalNanoAiu: 538656826500 },
          directCopilotUsage: { totalNanoAiu: 1 },
        },
      });

      expect(usage!.nanoAiu).toBe(246039490000);
    });

    it("accepts 0", () => {
      expect(usageFor(dir, "aiu-zero", { _meta: { copilotUsage: { totalNanoAiu: 0 } } })!.nanoAiu).toBe(0);
    });

    it("ignores sessionTotalNanoAiu and directCopilotUsage", () => {
      const usage = usageFor(dir, "aiu-siblings", {
        _meta: {
          sessionTotalNanoAiu: 538656826500,
          directCopilotUsage: { totalNanoAiu: 246039490000 },
        },
      });

      expect(usage!.nanoAiu).toBeNull();
    });

    it("is null when totalNanoAiu is missing, negative or not a number", () => {
      const db = freshDb(dir, "aiu-shapes");
      const cases: UsageSeed[] = [
        { turnId: "t-negative", usage: { _meta: { copilotUsage: { totalNanoAiu: -1 } } } },
        { turnId: "t-string", usage: { _meta: { copilotUsage: { totalNanoAiu: "1000" } } } },
        { turnId: "t-null", usage: { _meta: { copilotUsage: { totalNanoAiu: null } } } },
        { turnId: "t-object", usage: { _meta: { copilotUsage: { totalNanoAiu: {} } } } },
        { turnId: "t-empty", usage: { _meta: { copilotUsage: {} } } },
        { turnId: "t-array", usage: { _meta: { copilotUsage: [{ totalNanoAiu: 1 }] } } },
        { turnId: "t-meta-string", usage: { _meta: { copilotUsage: "1000" } } },
      ];
      const usages = readCases(db, cases);

      for (const testCase of cases) {
        expect(usages.get(testCase.turnId)!.nanoAiu).toBeNull();
      }
    });
  });
});

describe("readAgentHostSessionModel", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "agent-session-model-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the id from the copilot.model metadata row", () => {
    const db = fixtureDb(dir, { turns: false, usage: false, metadata: true });
    expect(readAgentHostSessionModel(db)).toBe("gpt-6-luna");
  });

  it("is null when the metadata table or the copilot.model row is missing", () => {
    const noTable = freshDb(dir, "no-table");
    expect(readAgentHostSessionModel(noTable)).toBeNull();

    const emptyTable = freshDb(dir, "empty-table");
    createSessionMetadataTable(emptyTable, [{ key: "customTitle", value: "Some title" }]);
    expect(readAgentHostSessionModel(emptyTable)).toBeNull();
  });

  it("is null for a value whose JSON is invalid or hides no non-empty string id", () => {
    const db = freshDb(dir, "invalid-json");
    createSessionMetadataTable(db, [
      { key: "copilot.model", value: "{id:gpt}" },
      { key: "customTitle", value: "t" },
    ]);
    expect(readAgentHostSessionModel(db)).toBeNull();

    const valueCases: { name: string; value: string; model: string | null }[] = [
      {
        name: "full",
        value: '{"id":"gpt-6-luna","config":{"thinkingLevel":"medium"}}',
        model: "gpt-6-luna",
      },
      { name: "empty", value: '{"id":""}', model: null },
      { name: "null", value: '{"id":null}', model: null },
      { name: "number", value: '{"id":42}', model: null },
      { name: "object", value: '{"id":{"name":"x"}}', model: null },
      { name: "no-id", value: "{}", model: null },
      { name: "array", value: '[{"id":"gpt"}]', model: null },
      { name: "string", value: '"gpt-6-luna"', model: null },
      { name: "scalar-null", value: "null", model: null },
    ];

    for (const valueCase of valueCases) {
      const perCase = freshDb(dir, `model-${valueCase.name}`);
      createSessionMetadataTable(perCase, [{ key: "copilot.model", value: valueCase.value }]);
      expect(readAgentHostSessionModel(perCase)).toBe(valueCase.model);
    }
  });
});

describe("readAgentHostSessionTitle", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "agent-session-title-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the customTitle metadata row verbatim", () => {
    const db = fixtureDb(dir, { turns: false, usage: false, metadata: true });
    expect(readAgentHostSessionTitle(db)).toBe("Example custom title");
  });

  it("trims the plain text value, null when empty after trimming", () => {
    const db = freshDb(dir, "trimmed");
    createSessionMetadataTable(db, [{ key: "customTitle", value: "  Padded title \n" }]);
    expect(readAgentHostSessionTitle(db)).toBe("Padded title");

    const valueCases: { name: string; value: string; title: string | null }[] = [
      { name: "empty", value: "", title: null },
      { name: "whitespace", value: "   \n\t ", title: null },
      { name: "plain", value: "Plain", title: "Plain" },
    ];
    for (const valueCase of valueCases) {
      const perCase = freshDb(dir, `title-${valueCase.name}`);
      createSessionMetadataTable(perCase, [{ key: "customTitle", value: valueCase.value }]);
      expect(readAgentHostSessionTitle(perCase)).toBe(valueCase.title);
    }
  });

  it("is null when the metadata table or the customTitle row is missing", () => {
    const noTable = freshDb(dir, "no-table");
    expect(readAgentHostSessionTitle(noTable)).toBeNull();

    const emptyTable = freshDb(dir, "empty-table");
    createSessionMetadataTable(emptyTable, [{ key: "copilot.model", value: "{}" }]);
    expect(readAgentHostSessionTitle(emptyTable)).toBeNull();
  });
});

describe("nanoAiuToAiCredits", () => {
  it("divides by one billion nanoAIU per AI Credit", () => {
    expect(NANO_AIU_PER_AI_CREDIT).toBe(1_000_000_000);
    expect(nanoAiuToAiCredits(0)).toBe(0);
    expect(nanoAiuToAiCredits(NANO_AIU_PER_AI_CREDIT)).toBe(1);
    expect(nanoAiuToAiCredits(1_285_093_000)).toBe(1.285093);
    expect(nanoAiuToAiCredits(246_039_490_000)).toBe(246.03949);
    expect(nanoAiuToAiCredits(1)).toBe(1e-9);
  });
});

// Turns without the event_id column: a session.db from before the join key
// was projected. The reader must still list every turn.
const TURNS_NO_EVENT_ID_DDL = `
  CREATE TABLE turns (
    id TEXT PRIMARY KEY NOT NULL,
    checkpoint_ref TEXT
  )
`;

describe("readAgentHostTurnEventIds", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "agent-session-event-ids-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function scratchDb(): DatabaseSync {
    return new DatabaseSync(path.join(dir, "session.db"));
  }

  it("returns [] when there is no turns table", () => {
    const db = scratchDb();
    expect(readAgentHostTurnEventIds(db)).toEqual([]);
  });

  it("lists turns in rowid order with their event_id", () => {
    const db = scratchDb();
    db.exec(TURNS_DDL);
    const insert = db.prepare("INSERT INTO turns (id, event_id) VALUES (?, ?)");
    insert.run("request_b", "event-b");
    insert.run("request_a", "event-a");

    const expected: AgentHostTurnEventRef[] = [
      { turnId: "request_b", eventId: "event-b" },
      { turnId: "request_a", eventId: "event-a" },
    ];
    expect(readAgentHostTurnEventIds(db)).toEqual(expected);
  });

  it("maps NULL and empty event_id to null", () => {
    const db = scratchDb();
    db.exec(TURNS_DDL);
    const insert = db.prepare("INSERT INTO turns (id, event_id) VALUES (?, ?)");
    insert.run("request_null", null);
    insert.run("request_empty", "");

    expect(readAgentHostTurnEventIds(db)).toEqual([
      { turnId: "request_null", eventId: null },
      { turnId: "request_empty", eventId: null },
    ]);
  });

  it("returns every turn with eventId null when turns has no event_id column", () => {
    const db = scratchDb();
    db.exec(TURNS_NO_EVENT_ID_DDL);
    const insert = db.prepare("INSERT INTO turns (id, checkpoint_ref) VALUES (?, ?)");
    insert.run("request_2", "refs/x/2");
    insert.run("request_1", "refs/x/1");

    expect(readAgentHostTurnEventIds(db)).toEqual([
      { turnId: "request_2", eventId: null },
      { turnId: "request_1", eventId: null },
    ]);
  });

  it("returns [] for an empty turns table", () => {
    const db = scratchDb();
    db.exec(TURNS_DDL);
    expect(readAgentHostTurnEventIds(db)).toEqual([]);
  });
});
