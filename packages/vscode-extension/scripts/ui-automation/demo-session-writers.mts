// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Writers for the demo fixture's made-up sessions (demo-fixture.mts): a Copilot
// Chat ("classic") session as the store rows and debug logs Copilot Chat writes,
// and a Copilot CLI session in VS Code's Agent Host as the catalog row,
// session.db and event log. Node runs this directly (type stripping), like the
// other fixture modules. Placeholder text only.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { copilotCliFixtureRows } from "../../../server/src/test-support/copilot-cli-fixtures.ts";
import { COPILOT_SESSION_STORE_SCHEMA } from "../../../server/src/test-support/copilot-session-store.ts";
import { readAgentHostFixtureRows, writeAgentHostCatalog, writeAgentSessionDb } from "../../../server/src/test-support/agent-host-user-data-dir.ts";
import { agentHostDbPath } from "../../../server/src/data-sources/agent-host/agent-host-paths.ts";

const NANO = 1_000_000_000;
const MINUTE_MS = 60_000;

// --- Copilot Chat (classic) --------------------------------------------------

export interface DemoRequest {
  // Tokens of the whole prompt, the cached part included.
  input: number;
  cached: number;
  output: number;
  // Billed AI Credits of the request.
  credits: number;
}

export interface DemoSubagentRun {
  agentName: string;
  model: string;
  requests: DemoRequest[];
  toolNames: string[];
}

export interface DemoClassicTurn {
  prompt: string;
  response: string;
  model: string;
  requests: DemoRequest[];
  tools: string[];
  subagents?: DemoSubagentRun[];
  // Idle time before the turn; the default stays inside every prompt cache's lifetime.
  gapBeforeMinutes?: number;
}

export interface DemoClassicSession {
  id: string;
  title: string;
  startedAt: Date;
  // The workspace folder (a git repository), as the store's `cwd`.
  cwd: string;
  turns: DemoClassicTurn[];
  // The tool definitions every request carries (tools_0.json); omitted: no tools file.
  toolInventory?: string[];
  systemPrompt?: string;
}

export interface ClassicStorePaths {
  sessionStoreDbPath: string;
  debugLogsDir: string;
}

const DEFAULT_GAP_MINUTES = 3;
const ROUND_MS = 6000;

const SYNTHETIC_DESCRIPTION = "Placeholder tool description for the demo data. ".repeat(10).trim();
const toolDefinition = (name: string) => ({
  type: "function",
  name,
  description: SYNTHETIC_DESCRIPTION,
  parameters: { type: "object", properties: { query: { type: "string", description: SYNTHETIC_DESCRIPTION } }, required: ["query"] },
});

const sumCredits = (requests: DemoRequest[]): number => requests.reduce((sum, request) => sum + request.credits, 0);

// The session's AI Credits as the extension folds them: its own requests and the
// subagent runs they started.
export function classicSessionCredits(session: DemoClassicSession): number {
  return session.turns.reduce((sum, turn) => sum + sumCredits(turn.requests) + (turn.subagents ?? []).reduce((runs, run) => runs + sumCredits(run.requests), 0), 0);
}

interface Line {
  ts: number;
  dur?: number;
  sid: string;
  type: string;
  name: string;
  spanId: string;
  parentSpanId?: string;
  status: "ok";
  attrs: Record<string, unknown>;
}

class LogWriter {
  readonly lines: Line[] = [{ ts: 0, sid: "", type: "session_start", name: "session_start", spanId: "", status: "ok", attrs: {} }];
  private counter = 0;
  constructor(
    private readonly sid: string,
    startTs: number,
    sessionAttrs: Record<string, unknown> = {},
  ) {
    this.lines[0] = { v: 1, ts: startTs, dur: 0, sid, type: "session_start", name: "session_start", spanId: `session-start-${sid}`, status: "ok", attrs: { copilotVersion: "0.61.0", vscodeVersion: "1.146.0", ...sessionAttrs } } as Line;
  }
  add(type: string, ts: number, attrs: Record<string, unknown>, extra: { dur?: number; name?: string; spanId?: string; parentSpanId?: string } = {}): string {
    const spanId = extra.spanId ?? `${type}-${this.sid.slice(-6)}-${++this.counter}`;
    this.lines.push({ ts, dur: extra.dur ?? 0, sid: this.sid, type, name: extra.name ?? type, spanId, ...(extra.parentSpanId ? { parentSpanId: extra.parentSpanId } : {}), status: "ok", attrs });
    return spanId;
  }
  text(): string {
    return `${this.lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  }
}

function llmRequest(log: LogWriter, ts: number, request: DemoRequest, model: string, responseId: string, debugName: string, files: Record<string, string>): void {
  log.add(
    "llm_request",
    ts,
    { model, inputTokens: request.input, cachedTokens: request.cached, outputTokens: request.output, copilotUsageNanoAiu: Math.round(request.credits * NANO), responseId, debugName, requestPayload: "placeholder", ...files },
    { dur: 900 },
  );
}

// One classic session: a store row and turn rows, the debug log, its system prompt
// and tools file, and a child log per subagent run. Returns the session's AI Credits.
export function writeClassicSession(paths: ClassicStorePaths, session: DemoClassicSession): number {
  const startedAt = session.startedAt.toISOString();
  const sessionDir = path.join(paths.debugLogsDir, session.id);
  mkdirSync(sessionDir, { recursive: true });

  const files: Record<string, string> = {};
  if (session.systemPrompt !== undefined) {
    writeFileSync(path.join(sessionDir, "system_prompt_0.json"), JSON.stringify({ content: JSON.stringify([{ type: "text", content: session.systemPrompt }]) }));
    files.systemPromptFile = "system_prompt_0.json";
  }
  if (session.toolInventory !== undefined) {
    writeFileSync(path.join(sessionDir, "tools_0.json"), JSON.stringify({ content: JSON.stringify(session.toolInventory.map(toolDefinition)) }));
    files.toolsFile = "tools_0.json";
  }

  const log = new LogWriter(session.id, session.startedAt.getTime());
  const turnTimes: string[] = [];
  let cursor = session.startedAt.getTime() + 10_000;
  session.turns.forEach((turn, index) => {
    cursor += (turn.gapBeforeMinutes ?? (index === 0 ? 0 : DEFAULT_GAP_MINUTES)) * MINUTE_MS;
    const turnStart = cursor;
    turnTimes.push(new Date(turnStart).toISOString());
    log.add("user_message", turnStart, { content: turn.prompt });
    log.add("turn_start", turnStart + 1, { turnId: String(index + 1) }, { name: `turn_start:${index + 1}` });
    turn.requests.forEach((request, round) => {
      const at = turnStart + 1000 + round * ROUND_MS;
      llmRequest(log, at, request, turn.model, `resp-${session.id.slice(-6)}-${index}-${round}`, "panel/editAgent", files);
      const tool = turn.tools[round];
      if (tool !== undefined) log.add("tool_call", at + 2000, { args: { query: "placeholder" }, result: "placeholder" }, { name: tool, dur: 300 });
    });
    const afterRounds = turnStart + 1000 + turn.requests.length * ROUND_MS;
    (turn.subagents ?? []).forEach((run, runIndex) => {
      const childId = `call_demo${session.id.slice(-4)}t${index}r${runIndex}`;
      const label = `runSubagent-${run.agentName}`;
      const callTs = turnStart + 1500;
      const callSpan = log.add("tool_call", callTs, { args: { prompt: `Placeholder task for ${run.agentName}` }, result: "placeholder" }, { name: "runSubagent", dur: 8000 });
      log.add("child_session_ref", callTs + 500, { childSessionId: childId, childLogFile: `${label}-${childId}.jsonl`, label }, { parentSpanId: callSpan });
      writeChildLog(sessionDir, session.id, childId, label, run, callTs + 600);
    });
    log.add("agent_response", afterRounds, { response: turn.response, reasoning: "" });
    log.add("turn_end", afterRounds + 1000, { turnId: String(index + 1) }, { name: `turn_end:${index + 1}` });
    cursor = afterRounds + 1000;
  });
  writeFileSync(path.join(sessionDir, "main.jsonl"), log.text());

  mkdirSync(path.dirname(paths.sessionStoreDbPath), { recursive: true });
  const db = new DatabaseSync(paths.sessionStoreDbPath);
  try {
    db.exec(COPILOT_SESSION_STORE_SCHEMA.replaceAll("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
    // `repository` stays empty, as for a real session: the analyzer derives it from the folder's `origin`.
    db.prepare("INSERT INTO sessions (id, cwd, repository, branch, host_type, summary, agent_name, agent_description, created_at, updated_at) VALUES (?, ?, NULL, 'main', 'desktop', ?, 'GitHub Copilot Chat', 'chat', ?, ?)").run(
      session.id,
      session.cwd,
      session.title,
      startedAt,
      startedAt,
    );
    const insertTurn = db.prepare("INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, ?, ?, ?, ?)");
    session.turns.forEach((turn, index) => insertTurn.run(session.id, index, turn.prompt, turn.response, turnTimes[index]!));
  } finally {
    db.close();
  }
  return classicSessionCredits(session);
}

function writeChildLog(sessionDir: string, parentId: string, childId: string, label: string, run: DemoSubagentRun, startTs: number): void {
  const log = new LogWriter(childId, startTs, { parentSessionId: parentId, label });
  log.add("user_message", startTs + 10, { content: `Placeholder task for ${run.agentName}` });
  log.add("subagent", startTs + 20, { agentName: run.agentName });
  log.add("turn_start", startTs + 100, { turnId: "1" }, { name: "turn_start" });
  run.requests.forEach((request, round) => {
    const at = startTs + 200 + round * 1500;
    llmRequest(log, at, request, run.model, `resp-${childId}-${round}`, `tool/${label}`, {});
    const tool = run.toolNames[round];
    if (tool !== undefined) log.add("tool_call", at + 800, { args: {}, result: "placeholder" }, { name: tool });
  });
  log.add("turn_end", startTs + 300 + run.requests.length * 1500, { turnId: "1" }, { name: "turn_end" });
  writeFileSync(path.join(sessionDir, `${label}-${childId}.jsonl`), log.text());
}

// --- Copilot CLI in the Agent Host -------------------------------------------

export type DemoCallOutcome = { kind: "ok" } | { kind: "failed"; exitCode: number; message: string } | { kind: "unknown" };

export interface DemoAgentCall {
  tool: "bash" | "view";
  // The shell command, or the path a `view` reads.
  command: string;
  outcome: DemoCallOutcome;
}

export interface DemoAgentTurn {
  prompt: string;
  reply: string;
  calls: DemoAgentCall[];
  credits: number;
}

export interface DemoAgentSession {
  // The Agent Host session id and the Copilot CLI's own session id (the event log's folder).
  id: string;
  sdkId: string;
  title: string;
  startedAt: Date;
  // The workspace folder, a git repository.
  cwd: string;
  turns: DemoAgentTurn[];
}

export function agentSessionCredits(session: DemoAgentSession): number {
  return session.turns.reduce((sum, turn) => sum + turn.credits, 0);
}

const MODEL = "claude-sonnet-5";
const RECORD = { model: MODEL, inputTokens: 20_000, outputTokens: 400, cacheReadTokens: 12_000, cacheWriteTokens: 4000 };

// The catalog (agent-host.db) every Agent Host session is a row in. Call once before writeAgentSession.
export function createAgentHostCatalog(userDataDir: string): void {
  writeAgentHostCatalog(userDataDir, { sessions_v2: [], chats_v2: [] });
}

const uuid = (prefix: string, index: number): string => `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;

// One Agent Host session of the Copilot CLI: a catalog row, a session.db with a
// turn and usage row per turn, and the CLI's event log under `copilotHome`.
export function writeAgentSession(userDataDir: string, copilotHome: string, session: DemoAgentSession): number {
  const startMs = session.startedAt.getTime();
  const folderUri = pathToFileURL(session.cwd).href;
  const catalog = new DatabaseSync(agentHostDbPath(userDataDir));
  try {
    const template = readAgentHostFixtureRows("catalog-rows.json").sessions_v2[0]!;
    const payload = JSON.parse(JSON.stringify(template.payload)) as { data: Record<string, unknown> & { chats: Record<string, unknown>[] } };
    Object.assign(payload.data, { summary: session.title, modifiedTime: startMs + 60_000, project: { displayName: path.basename(session.cwd), uri: folderUri }, workingDirectories: [folderUri] });
    payload.data.chats[0] = { ...payload.data.chats[0]!, summary: session.title };
    const insert = (table: string, row: Record<string, unknown>) => {
      const columns = Object.keys(row);
      const values = columns.map((column) => {
        const value = row[column];
        return value === null || value === undefined || typeof value === "string" || typeof value === "number" ? (value ?? null) : JSON.stringify(value);
      });
      catalog.prepare(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...(values as (string | number | null)[]));
    };
    insert("sessions_v2", { ...template, session_uri: `copilotcli:/${session.id}`, start_time: startMs, modified_time: startMs + 60_000, payload });
    insert("chats_v2", {
      ...copilotCliFixtureRows.chats_v2[0]!,
      chat_uri: `ahp-chat://default/${session.id}`,
      owner_session_uri: `copilotcli:/${session.id}`,
      provider_data: JSON.stringify({ sdkSessionId: session.sdkId, model: { id: MODEL, config: {} } }),
    });
  } finally {
    catalog.close();
  }

  const turnRows: Record<string, unknown>[] = [];
  const usageRows: Record<string, unknown>[] = [];
  const events: unknown[] = [];
  const at = (seconds: number) => new Date(startMs + seconds * 1000).toISOString();
  const add = (type: string, data: Record<string, unknown>, seconds: number, id = uuid("00000000", events.length + 1)) =>
    events.push({ type, data, id, timestamp: at(seconds), parentId: events.length === 0 ? null : (events[events.length - 1] as { id: string }).id });
  add("session.start", { sessionId: session.sdkId, version: 1, producer: "copilot-agent", copilotVersion: "1.0.103", startTime: at(0), context: { cwd: session.cwd }, selectedModel: MODEL }, 0);

  let seconds = 2;
  session.turns.forEach((turn, turnIndex) => {
    const eventId = uuid("7c0de000", Number.parseInt(session.id.slice(-4), 16) * 100 + turnIndex);
    const turnId = `request_${eventId}`;
    const interactionId = uuid("70fb8f44", Number.parseInt(session.id.slice(-4), 16) * 100 + turnIndex);
    const callCount = turn.calls.length + 1;
    const totals = { inputTokens: RECORD.inputTokens * callCount, outputTokens: RECORD.outputTokens * callCount, cacheReadTokens: RECORD.cacheReadTokens * callCount };
    const nano = Math.round(turn.credits * NANO);
    turnRows.push({ id: turnId, event_id: eventId, checkpoint_ref: `refs/agents/demo/checkpoints/turn/${turnIndex + 1}` });
    usageRows.push({
      turn_id: turnId,
      usage: {
        ...totals,
        model: MODEL,
        _meta: {
          "vscode.modelCall": { schemaVersion: 1, model: MODEL, durationMs: 5000, timeToFirstTokenMs: 2000.5, ...totals },
          cost: 1,
          copilotUsage: { totalNanoAiu: nano, sessionTotalNanoAiu: nano },
          turnTokenTotals: [{ model: MODEL, inputTokens: totals.inputTokens, cachedTokens: totals.cacheReadTokens, outputTokens: totals.outputTokens }],
          directCopilotUsage: { totalNanoAiu: nano },
        },
      },
    });
    add("user.message", { content: turn.prompt, transformedContent: turn.prompt, attachments: [], interactionId, delivery: "idle", turnId: String(turnIndex) }, seconds, eventId);
    add("assistant.turn_start", { turnId: String(turnIndex), interactionId }, seconds + 2);
    const usageRecord = (apiCallId: string, when: number) =>
      add("session.usage_record", { apiCallId, usage: { ...RECORD, reasoningTokens: 0, apiCallId, cacheDetailsReported: true, accounting: { sourceSessionId: session.sdkId } } }, when);
    let when = seconds + 8;
    turn.calls.forEach((call, callIndex) => {
      const toolCallId = `toolu_${session.id.slice(-4)}_${turnIndex}_${callIndex}`;
      const apiCallId = `call-${turnIndex}-${callIndex}`;
      const args = call.tool === "bash" ? { command: call.command } : { path: call.command };
      usageRecord(apiCallId, when - 1);
      add("assistant.message", { messageId: `msg-${turnIndex}-${callIndex}`, content: "", toolRequests: [{ toolCallId, name: call.tool, arguments: args, type: "function", toolTitle: call.tool }], interactionId, turnId: String(turnIndex), model: MODEL, apiCallId }, when);
      add("tool.execution_start", { toolCallId, toolName: call.tool, arguments: args, model: MODEL, turnId: String(turnIndex), ...(call.tool === "bash" ? { shellToolInfo: { hasWriteFileRedirection: false, possiblePaths: [] } } : {}) }, when + 1);
      if (call.outcome.kind === "failed") {
        add(
          "tool.execution_complete",
          { toolCallId, model: MODEL, interactionId, success: false, toolTelemetry: {}, ...(call.tool === "bash" ? { shellExecution: { exitCode: call.outcome.exitCode } } : {}), error: { code: "failure", message: call.outcome.message } },
          when + 3,
        );
      } else if (call.outcome.kind === "ok") {
        add("tool.execution_complete", { toolCallId, model: MODEL, interactionId, success: true, result: { content: "placeholder output" }, toolTelemetry: {}, ...(call.tool === "bash" ? { shellExecution: { exitCode: 0 } } : {}) }, when + 3);
      }
      when += 10;
    });
    usageRecord(`call-${turnIndex}-final`, when);
    add("assistant.message", { messageId: `msg-${turnIndex}-final`, content: turn.reply, toolRequests: [], interactionId, turnId: String(turnIndex), model: MODEL, apiCallId: `call-${turnIndex}-final` }, when + 1);
    add("assistant.turn_end", { turnId: String(turnIndex) }, when + 2);
    seconds = when + 30;
  });

  writeAgentSessionDb(userDataDir, session.id, { turns: turnRows, turn_usage: usageRows });
  const logDir = path.join(copilotHome, "session-state", session.sdkId);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(path.join(logDir, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  return agentSessionCredits(session);
}
