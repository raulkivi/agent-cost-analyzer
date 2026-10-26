// Made-up Copilot Chat data for the Marketplace screenshots (step 10.10):
// two weeks of sessions on several models, each with a debug log
// (main.jsonl) and agent-traces.db rows, so every column has a number. No
// real chat text. Seeded, so the same `now` gives the same pictures.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { COPILOT_SESSION_STORE_SCHEMA } from "../../../server/src/test-support/copilot-session-store.ts";
import { USER_SETTINGS } from "../integration-fixture.mts";

export interface ShowcaseFixture {
  userDataDir: string;
  // The session the panel screenshots open: started at `now`.
  featuredSessionId: string;
  featuredSessionTitle: string;
}

export interface ShowcaseFixtureOptions {
  now?: Date;
}

interface ModelRates {
  // AI Credits per token.
  input: number;
  cachedInput: number;
  output: number;
  writesCache: boolean;
}

// Shaped like Copilot's: cached input a tenth of input, output five times it.
const MODELS: Record<string, ModelRates> = {
  "claude-sonnet-5": { input: 2.5e-4, cachedInput: 2.5e-5, output: 1.25e-3, writesCache: true },
  "claude-opus-5": { input: 4.2e-4, cachedInput: 4.2e-5, output: 2.1e-3, writesCache: true },
  "claude-haiku-5": { input: 8e-5, cachedInput: 8e-6, output: 4e-4, writesCache: true },
  "gpt-5.1": { input: 1.25e-4, cachedInput: 1.25e-5, output: 1e-3, writesCache: false },
  "gpt-5-mini": { input: 2.5e-5, cachedInput: 2.5e-6, output: 2e-4, writesCache: false },
};

interface SessionPlan {
  title: string;
  model: string;
  turns: number;
  daysAgo: number;
  hour: number;
}

const FEATURED: SessionPlan = { title: "Add retry to the HTTP client", model: "claude-sonnet-5", turns: 8, daysAgo: 0, hour: 0 };

const OTHERS: SessionPlan[] = [
  { title: "Fix flaky checkout test", model: "claude-sonnet-5", turns: 5, daysAgo: 0, hour: 9 },
  { title: "Explain the build pipeline", model: "gpt-5-mini", turns: 3, daysAgo: 1, hour: 16 },
  { title: "Refactor auth middleware into small handlers", model: "claude-opus-5", turns: 9, daysAgo: 1, hour: 11 },
  { title: "Write unit tests for the date parser", model: "gpt-5.1", turns: 6, daysAgo: 2, hour: 14 },
  { title: "Upgrade to React 19", model: "claude-sonnet-5", turns: 7, daysAgo: 3, hour: 10 },
  { title: "Rename config keys", model: "claude-haiku-5", turns: 2, daysAgo: 3, hour: 15 },
  { title: "Investigate memory leak in the worker", model: "claude-opus-5", turns: 8, daysAgo: 4, hour: 13 },
  { title: "Add dark mode toggle", model: "gpt-5.1", turns: 5, daysAgo: 5, hour: 9 },
  { title: "Summarise open TODOs", model: "gpt-5-mini", turns: 2, daysAgo: 5, hour: 17 },
  { title: "Migrate settings to TOML", model: "claude-sonnet-5", turns: 6, daysAgo: 6, hour: 10 },
  { title: "Speed up CI cache", model: "claude-sonnet-5", turns: 4, daysAgo: 7, hour: 14 },
  { title: "Add pagination to the orders API", model: "gpt-5.1", turns: 7, daysAgo: 7, hour: 11 },
  { title: "Fix type errors after the zod upgrade", model: "claude-haiku-5", turns: 4, daysAgo: 8, hour: 16 },
  { title: "Draft the release notes", model: "gpt-5-mini", turns: 3, daysAgo: 8, hour: 12 },
  { title: "Port the CLI to ESM", model: "claude-opus-5", turns: 10, daysAgo: 9, hour: 10 },
  { title: "Add retries to the webhook sender", model: "claude-sonnet-5", turns: 5, daysAgo: 10, hour: 15 },
  { title: "Review the SQL migration", model: "gpt-5.1", turns: 3, daysAgo: 10, hour: 9 },
  { title: "Add an empty state to the dashboard", model: "claude-sonnet-5", turns: 4, daysAgo: 11, hour: 13 },
  { title: "Profile slow test suite", model: "claude-haiku-5", turns: 5, daysAgo: 12, hour: 11 },
  { title: "Split the payments module", model: "claude-opus-5", turns: 7, daysAgo: 12, hour: 16 },
  { title: "Add structured logging", model: "gpt-5.1", turns: 4, daysAgo: 13, hour: 10 },
];

interface ToolUse {
  name: string;
  args: Record<string, unknown>;
  resultTokens: [number, number];
}

const TOOLS: ToolUse[] = [
  { name: "read_file", args: { filePath: "src/http/client.ts", startLine: 1, endLine: 160 }, resultTokens: [800, 3200] },
  { name: "grep_search", args: { query: "fetchWithRetry", isRegexp: false }, resultTokens: [200, 900] },
  { name: "file_search", args: { query: "**/*.test.ts" }, resultTokens: [100, 400] },
  { name: "semantic_search", args: { query: "where are HTTP errors handled" }, resultTokens: [900, 2400] },
  { name: "replace_string_in_file", args: { filePath: "src/http/client.ts" }, resultTokens: [60, 200] },
  { name: "create_file", args: { filePath: "src/http/backoff.ts" }, resultTokens: [40, 120] },
  { name: "run_in_terminal", args: { command: "npm test -- http", isBackground: false }, resultTokens: [300, 1800] },
  { name: "get_errors", args: { filePaths: ["src/http/client.ts"] }, resultTokens: [50, 400] },
  { name: "manage_todo_list", args: { operation: "write" }, resultTokens: [60, 180] },
];

const USER_MESSAGES = [
  "Plan the change and list the files it touches.",
  "Go ahead with the first step.",
  "The tests fail on a timeout, can you look?",
  "Keep the public API the same.",
  "Add tests for the edge cases.",
  "Run the whole suite.",
  "Tidy up and explain what changed.",
  "Looks good, one more pass on the naming.",
  "Update the docs for this.",
  "Anything else you would change?",
];

// Copilot Chat's system prompt and tool definitions, before any message.
const BASE_CONTEXT_TOKENS = 14_200;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WORKSPACE = "showcase-workspace";

// mulberry32: small, seedable, good enough for made-up numbers.
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sessionId(index: number): string {
  return `5e55a000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function startOf(plan: SessionPlan, now: Date): Date {
  if (plan.daysAgo === 0 && plan.hour === 0) return now;
  const day = new Date(now.getTime() - plan.daysAgo * DAY_MS);
  day.setUTCHours(plan.hour, 0, 0, 0);
  // Today's other sessions start before `now`, whatever time it is.
  return day.getTime() < now.getTime() ? day : new Date(now.getTime() - (plan.daysAgo + 1) * HOUR_MS);
}

interface TraceRow {
  responseId: string;
  cacheWrite: number;
  reasoning: number;
}

interface SeededSession {
  mainJsonl: string;
  traces: TraceRow[];
  turns: { userMessage: string; assistantResponse: string; timestamp: string }[];
}

function seedSession(id: string, plan: SessionPlan, startedAt: Date, random: () => number): SeededSession {
  const between = (low: number, high: number) => Math.round(low + random() * (high - low));
  const rates = MODELS[plan.model];
  const lines: object[] = [];
  const traces: TraceRow[] = [];
  const turns: SeededSession["turns"] = [];
  let ts = startedAt.getTime();
  let span = 0;
  const nextSpan = () => (++span).toString(16).padStart(16, "0");
  const event = (type: string, name: string, attrs: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    lines.push({ ts, dur: 0, sid: id, type, name, spanId: nextSpan(), status: "ok", attrs, ...extra });

  event("session_start", "session_start", { copilotVersion: "0.61.2026101501", vscodeVersion: "1.106.0" }, { v: 1 });
  let context = BASE_CONTEXT_TOKENS;
  let cached = 0;
  for (let turn = 0; turn < plan.turns; turn++) {
    const userMessage = USER_MESSAGES[turn % USER_MESSAGES.length];
    turns.push({ userMessage, assistantResponse: "Done.", timestamp: new Date(ts).toISOString() });
    ts += between(20, 90) * 1000;
    event("user_message", "user_message", { content: userMessage });
    const parent = lines.at(-1) as { spanId: string };
    context += between(150, 700);
    const rounds = turn === 0 ? 1 : between(1, 4);
    for (let round = 0; round < rounds; round++) {
      event("turn_start", `turn_start:${round}`, { turnId: String(round) });
      const toolCount = turn === 0 && round === 0 ? 1 : between(0, 3);
      for (let call = 0; call < toolCount; call++) {
        const tool = TOOLS[between(0, TOOLS.length - 1)];
        ts += between(1, 30) * 100;
        event("tool_call", tool.name, { args: JSON.stringify(tool.args), result: "<tool result>" }, { parentSpanId: parent.spanId });
        context += between(...tool.resultTokens);
      }
      const output = between(80, round === rounds - 1 ? 1400 : 500);
      const uncached = context - cached;
      // The new prompt prefix, less the trailing user text that is not cached.
      const cacheWrite = rates.writesCache ? Math.round(uncached * (0.82 + random() * 0.15)) : 0;
      const reasoning = between(0, 3) === 0 ? 0 : between(60, 900);
      const credits = uncached * rates.input + cached * rates.cachedInput + output * rates.output;
      const responseId = `${id}-r${span}`;
      const duration = between(1500, 12_000);
      lines.push({
        ts,
        dur: duration,
        sid: id,
        type: "llm_request",
        name: `chat:${plan.model}`,
        spanId: nextSpan(),
        parentSpanId: parent.spanId,
        status: "ok",
        attrs: {
          model: plan.model,
          debugName: "panel/editAgent",
          inputTokens: context,
          outputTokens: output,
          cachedTokens: cached,
          ttft: between(600, 1800),
          responseId,
          copilotUsageNanoAiu: Math.round(credits * 1e9),
        },
      });
      traces.push({ responseId, cacheWrite, reasoning });
      ts += duration;
      event("agent_response", "agent_response", { response: "<agent response>" }, { parentSpanId: parent.spanId });
      event("turn_end", `turn_end:${round}`, { turnId: String(round) });
      cached = context;
      context += output;
    }
    ts += between(2, 15) * MINUTE_MS;
  }
  return { mainJsonl: lines.map((line) => JSON.stringify(line)).join("\n") + "\n", traces, turns };
}

// The agent-traces.db columns VscodeLogProvider reads (architecture §6.2).
const AGENT_TRACES_SCHEMA = `
  CREATE TABLE spans (span_id TEXT PRIMARY KEY, operation_name TEXT, reasoning_tokens INTEGER);
  CREATE TABLE span_attributes (span_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (span_id, key));
`;

// Seeds <rootDir>/user-data, a VS Code user-data dir.
export function createShowcaseFixture(rootDir: string, options: ShowcaseFixtureOptions = {}): ShowcaseFixture {
  const now = options.now ?? new Date();
  const userDataDir = path.join(rootDir, "user-data");
  const userDir = path.join(userDataDir, "User");
  const globalStorage = path.join(userDir, "globalStorage", "github.copilot-chat");
  const debugLogsDir = path.join(userDir, "workspaceStorage", WORKSPACE, "GitHub.copilot-chat", "debug-logs");
  mkdirSync(globalStorage, { recursive: true });
  writeFileSync(path.join(userDir, "settings.json"), `${JSON.stringify(USER_SETTINGS, null, 2)}\n`);

  const store = new DatabaseSync(path.join(globalStorage, "session-store.db"));
  const traces = new DatabaseSync(path.join(globalStorage, "agent-traces.db"));
  try {
    store.exec(COPILOT_SESSION_STORE_SCHEMA);
    traces.exec(AGENT_TRACES_SCHEMA);
    const insertSession = store.prepare(
      "INSERT INTO sessions (id, cwd, repository, branch, host_type, summary, agent_name, agent_description, created_at, updated_at) VALUES (?, '/work/shop', 'acme/shop', 'main', 'desktop', ?, 'GitHub Copilot Chat', 'agent', ?, ?)",
    );
    const insertTurn = store.prepare(
      "INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, ?, ?, ?, ?)",
    );
    const insertSpan = traces.prepare("INSERT INTO spans (span_id, operation_name, reasoning_tokens) VALUES (?, 'chat', ?)");
    const insertAttribute = traces.prepare("INSERT INTO span_attributes (span_id, key, value) VALUES (?, ?, ?)");
    store.exec("BEGIN");
    traces.exec("BEGIN");
    [FEATURED, ...OTHERS].forEach((plan, index) => {
      const id = sessionId(index);
      const startedAt = startOf(plan, now);
      const seeded = seedSession(id, plan, startedAt, randomFrom(index + 1));
      insertSession.run(id, plan.title, startedAt.toISOString(), seeded.turns.at(-1)!.timestamp);
      seeded.turns.forEach((turn, turnIndex) => insertTurn.run(id, turnIndex, turn.userMessage, turn.assistantResponse, turn.timestamp));
      for (const trace of seeded.traces) {
        insertSpan.run(trace.responseId, trace.reasoning);
        insertAttribute.run(trace.responseId, "gen_ai.response.id", trace.responseId);
        insertAttribute.run(trace.responseId, "gen_ai.usage.cache_creation.input_tokens", String(trace.cacheWrite));
      }
      mkdirSync(path.join(debugLogsDir, id), { recursive: true });
      writeFileSync(path.join(debugLogsDir, id, "main.jsonl"), seeded.mainJsonl);
    });
    store.exec("COMMIT");
    traces.exec("COMMIT");
  } finally {
    store.close();
    traces.close();
  }

  return { userDataDir, featuredSessionId: sessionId(0), featuredSessionTitle: FEATURED.title };
}
