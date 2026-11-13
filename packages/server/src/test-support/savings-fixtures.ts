// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { agentHostDbPath } from "../data-sources/agent-host/agent-host-paths.js";
import { readAgentHostFixtureRows, writeAgentSessionDb } from "./agent-host-user-data-dir.js";
import { OPUS_5_5, SONNET_5_5, writeClaudeCodeSession } from "./claude-code-session-writer.js";
import { copilotCliFixtureRows } from "./copilot-cli-fixtures.js";

// Phase 16 SR13 (docs/plans/savings-report.md §10): synthetic sessions that
// give each savings opportunity something to find, for the e2e fixture homes
// (web-e2e, extension-ui) and their golden test. Placeholder text only.

export const SAVINGS_CLAUDE_SESSION_ID = "c0000000-0000-4000-8000-000000000020";

// A Claude Code session of four turns on one day (UTC):
//   09:00 and 09:05  Sonnet, the second reads the first's cache;
//   11:00            Sonnet, 1 h 55 min later: past the harness's 1-hour cache
//                    lifetime, so the whole prompt is written again (idle expiry);
//   11:05            Opus: the model changed, so the cache of the Sonnet
//                    prompt can't be read (model switch).
// `day` (YYYY-MM-DD) must be after the price book's first prices (2026-10-01)
// and inside the report's window.
export function writeSavingsClaudeCodeSession(projectsDir: string, cwd: string, day: string): void {
  const at = (time: string) => `${day}T${time}:00.000Z`;
  writeClaudeCodeSession(projectsDir, SAVINGS_CLAUDE_SESSION_ID, cwd, [
    { at: at("09:00"), input: 2000, cacheWrite: 30_000, output: 800, model: SONNET_5_5 },
    { at: at("09:05"), input: 500, cacheRead: 30_000, cacheWrite: 3000, output: 600, model: SONNET_5_5 },
    { at: at("11:00"), input: 500, cacheWrite: 33_500, output: 700, model: SONNET_5_5 },
    { at: at("11:05"), input: 500, cacheWrite: 34_000, output: 700, model: OPUS_5_5 },
  ]);
}

// --- VS Code (Copilot) -----------------------------------------------------
// Copilot's two logs record different things, so the two opportunities that
// need them sit in two sessions: a local (Copilot Chat) session's debug log
// records the tool definitions the request carried but no tool outcomes, and
// an Agent Host session's Copilot CLI event log records the outcomes but only
// the total tool-definition tokens.

export const SAVINGS_VSCODE_SESSION_ID = "00000000-0000-4000-9000-000000000021";
const MCP_SERVER = "acmedocs";
const SYNTHETIC_DESCRIPTION = "Synthetic tool description for a fixture. ".repeat(12).trim();

const toolDefinition = (name: string) => ({
  type: "function",
  name,
  description: SYNTHETIC_DESCRIPTION,
  parameters: { type: "object", properties: { query: { type: "string", description: SYNTHETIC_DESCRIPTION } }, required: ["query"] },
});

// A Copilot Chat session (two turns, two model requests each) whose tools
// file loads an MCP server (`mcp_acmedocs_*`) that no turn calls. Add it to a
// store that already exists (seedCopilotSessionStore); `startedAt` must be
// after the price book's first prices (2026-10-01) and inside the window.
export function writeSavingsVscodeSession(options: { sessionStoreDbPath: string; debugLogsDir: string; startedAt: string }): void {
  const { sessionStoreDbPath, debugLogsDir, startedAt } = options;
  const id = SAVINGS_VSCODE_SESSION_ID;
  const start = Date.parse(startedAt);
  const prompts = ["Synthetic prompt 1.", "Synthetic prompt 2."];

  const db = new DatabaseSync(sessionStoreDbPath);
  try {
    db.prepare(
      "INSERT INTO sessions (id, cwd, repository, branch, host_type, summary, agent_name, agent_description, created_at, updated_at) VALUES (?, '/repo', 'org/repo', 'main', 'desktop', 'Unused tools session', 'GitHub Copilot Chat', 'chat', ?, ?)",
    ).run(id, startedAt, startedAt);
    prompts.forEach((prompt, index) => {
      db.prepare("INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, ?, ?, 'Synthetic answer.', ?)").run(
        id,
        index,
        prompt,
        new Date(start + index * 120_000).toISOString(),
      );
    });
  } finally {
    db.close();
  }

  const lines: unknown[] = [{ v: 1, ts: start, dur: 0, sid: id, type: "session_start", name: "session_start", spanId: `session-start-${id}`, status: "ok", attrs: {} }];
  const span = (type: string, name: string, ts: number, attrs: Record<string, unknown>) =>
    lines.push({ ts, dur: 0, sid: id, type, name, spanId: `${type}-${lines.length}`, status: "ok", attrs });
  prompts.forEach((prompt, turn) => {
    const at = start + turn * 120_000;
    span("user_message", "user_message", at, { content: prompt });
    span("turn_start", `turn_start:${turn}`, at + 1, { turnId: String(turn) });
    span("tool_call", "read_file", at + 500, { args: "<synthetic>", result: "<synthetic>" });
    [0, 1].forEach((round) =>
      span("llm_request", "chat:claude-sonnet-5", at + 1000 + round * 2000, {
        model: "claude-sonnet-5",
        debugName: "panel/editAgent",
        inputTokens: 20_000 + round * 1000,
        outputTokens: 300,
        cachedTokens: 15_000,
        responseId: `synthetic-response-${turn}-${round}`,
        systemPromptFile: "system_prompt_0.json",
        toolsFile: "tools_0.json",
      }),
    );
    span("agent_response", "agent_response", at + 5000, { response: "<synthetic>" });
    span("turn_end", `turn_end:${turn}`, at + 5001, { turnId: String(turn) });
  });

  const sessionDir = path.join(debugLogsDir, id);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path.join(sessionDir, "main.jsonl"), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  writeFileSync(path.join(sessionDir, "system_prompt_0.json"), JSON.stringify({ content: JSON.stringify([{ type: "text", content: "Synthetic system prompt." }]) }));
  const tools = ["read_file", "run_in_terminal", `mcp_${MCP_SERVER}_search`, `mcp_${MCP_SERVER}_fetch`].map(toolDefinition);
  writeFileSync(path.join(sessionDir, "tools_0.json"), JSON.stringify({ content: JSON.stringify(tools) }));
}

export const SAVINGS_AGENT_HOST_SESSION_ID = "9a1b2c3d-5555-4e6f-8a07-000000000020";
const SAVINGS_AGENT_HOST_SDK_ID = "5d1a0020-aaaa-4bbb-8ccc-000000000020";
// What `rg` printed when the machine has none: exit 127, a command-not-found failure.
const RG_COMMANDS = ["rg -n synthetic src", "rg -n fixture src", "rg -n example docs"];

// An Agent Host (Copilot CLI) session of one turn in which `rg` failed three
// times with the same category (command not found). Add it after
// writeCopilotCliAgentHostStores(userDataDir): it adds a catalog row and the
// session's own session.db there, and its event log under `copilotHome`
// (the Copilot home the extension reads). `startedAtMs` as above.
export function writeSavingsAgentHostSession(options: { userDataDir: string; copilotHome: string; startedAtMs: number }): void {
  const { userDataDir, copilotHome, startedAtMs } = options;
  const session = SAVINGS_AGENT_HOST_SESSION_ID;
  const sdk = SAVINGS_AGENT_HOST_SDK_ID;
  const eventId = "7c0de000-2222-4000-8000-000000000020";
  const turnId = "request_7c0de000-2222-4000-8000-000000000020";

  const catalog = new DatabaseSync(agentHostDbPath(userDataDir));
  try {
    const template = readAgentHostFixtureRows("catalog-rows.json").sessions_v2[0]!;
    const insert = (table: string, row: Record<string, unknown>) => {
      const columns = Object.keys(row);
      const values = columns.map((column) => {
        const value = row[column];
        return value === null || value === undefined || typeof value === "string" || typeof value === "number" ? (value ?? null) : JSON.stringify(value);
      });
      catalog.prepare(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...(values as (string | number | null)[]));
    };
    insert("sessions_v2", { ...template, session_uri: `copilotcli:/${session}`, start_time: startedAtMs, modified_time: startedAtMs + 60_000 });
    insert("chats_v2", {
      ...copilotCliFixtureRows.chats_v2[0]!,
      chat_uri: "ahp-chat://default/savings-0",
      owner_session_uri: `copilotcli:/${session}`,
      provider_data: JSON.stringify({ sdkSessionId: sdk, model: { id: "claude-sonnet-5", config: {} } }),
    });
  } finally {
    catalog.close();
  }

  // One usage record per model call: three rg calls and the final reply, each
  // 20,000 prompt tokens (12,000 read from cache, 4,000 written) and 400 out,
  // so the records sum to the turn's totals and the cache writes are known.
  const calls = RG_COMMANDS.length + 1;
  const record = { model: "claude-sonnet-5", inputTokens: 20_000, outputTokens: 400, cacheReadTokens: 12_000, cacheWriteTokens: 4000 };
  const totals = { inputTokens: record.inputTokens * calls, outputTokens: record.outputTokens * calls, cacheReadTokens: record.cacheReadTokens * calls };
  const usage = {
    ...totals,
    model: record.model,
    _meta: {
      "vscode.modelCall": { schemaVersion: 1, model: record.model, durationMs: 5000, timeToFirstTokenMs: 2000.5, ...totals },
      cost: 1,
      copilotUsage: { totalNanoAiu: 1_000_000_000, sessionTotalNanoAiu: 1_000_000_000 },
      turnTokenTotals: [{ model: record.model, inputTokens: totals.inputTokens, cachedTokens: totals.cacheReadTokens, outputTokens: totals.outputTokens }],
      directCopilotUsage: { totalNanoAiu: 1_000_000_000 },
    },
  };
  writeAgentSessionDb(userDataDir, session, { turns: [{ id: turnId, event_id: eventId, checkpoint_ref: "refs/agents/savings/checkpoints/turn/1" }], turn_usage: [{ turn_id: turnId, usage }] });

  const at = (seconds: number) => new Date(startedAtMs + seconds * 1000).toISOString();
  const events: unknown[] = [];
  const add = (type: string, data: Record<string, unknown>, seconds: number, id = `00000000-0000-4000-8000-${String(events.length).padStart(12, "0")}`) =>
    events.push({ type, data, id, timestamp: at(seconds), parentId: events.length === 0 ? null : (events[events.length - 1] as { id: string }).id });
  const interactionId = "70fb8f44-0000-4000-8000-000000000020";
  add("session.start", { sessionId: sdk, version: 1, producer: "copilot-agent", copilotVersion: "1.0.103", startTime: at(0), context: { cwd: "/home/user/src/example" }, selectedModel: "claude-sonnet-5" }, 0);
  add("user.message", { content: "Synthetic prompt.", transformedContent: "Synthetic prompt.", attachments: [], interactionId, delivery: "idle", turnId: "0" }, 2, eventId);
  add("assistant.turn_start", { turnId: "0", interactionId }, 4);
  const usageRecord = (apiCallId: string, seconds: number) =>
    add("session.usage_record", { apiCallId, usage: { ...record, reasoningTokens: 0, apiCallId, cacheDetailsReported: true, accounting: { sourceSessionId: sdk } } }, seconds);
  RG_COMMANDS.forEach((command, index) => {
    const toolCallId = `toolu_rg${index}`;
    const base = 10 + index * 10;
    usageRecord(`call-${index}`, base - 1);
    add("assistant.message", { messageId: `msg-${index}`, content: "", toolRequests: [{ toolCallId, name: "bash", arguments: { command }, type: "function", toolTitle: "bash" }], interactionId, turnId: "0", model: record.model, apiCallId: `call-${index}` }, base);
    add("tool.execution_start", { toolCallId, toolName: "bash", arguments: { command }, model: "claude-sonnet-5", turnId: "0", shellToolInfo: { hasWriteFileRedirection: false, possiblePaths: [] } }, base + 1);
    add(
      "tool.execution_complete",
      { toolCallId, model: "claude-sonnet-5", interactionId, success: false, toolTelemetry: {}, shellExecution: { exitCode: 127 }, error: { code: "failure", message: "bash: rg: command not found" } },
      base + 3,
    );
  });
  usageRecord("call-final", 49);
  add("assistant.message", { messageId: "msg-final", content: "Synthetic reply.", toolRequests: [], interactionId, turnId: "0", model: record.model, apiCallId: "call-final" }, 50);
  add("assistant.turn_end", { turnId: "0" }, 51);

  const logDir = path.join(copilotHome, "session-state", sdk);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(path.join(logDir, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}
