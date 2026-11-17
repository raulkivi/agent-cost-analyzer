// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Step 10.24 DR1 (docs/plans/demo-recordings-1.0.md §4, D36): the demo variant of the
// web e2e fixture home, for the scenes that record the standalone app (W3), the fake host
// (F4) and, through `createDemoDesktopHome`, Claude Desktop (M8). The shared fixture home
// and its asserted figures stay as they are; this wraps it and
//   - adds, in the local scratch repository, two Copilot Chat sessions whose tools file
//     loads an MCP server of six tools that no turn calls (an unused-tools row whose
//     "and N more (about X)" shows, R23), and a pi session on a local model with no price
//     whose file declares tools, some never run (a "Not priced" row);
//   - renames the Copilot test models ("fixture-…") to ids the github-copilot price book
//     prices, so no frame reads "fixture-…" (D21, D36).
// Made-up data only: placeholder titles and prompts, and the pi session is a re-dated copy of
// one of the server's generated pi fixtures.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { writeClaudeCodeSession } from "../../../server/src/test-support/claude-code-session-writer.ts";
import { writeSavingsVscodeSession } from "../../../server/src/test-support/savings-fixtures.ts";
import { AUDIT_READ_SESSION_ID, AUDIT_SHELL_SESSION_ID, createFixtureHome, type FixtureHome, type FixtureOptions } from "./fixture-home.mts";
import { piSessionFolder } from "./pi-session-folder.mts";

// D21: Claude's answer must not say "fixture". The shared e2e fixture names its Copilot test models
// "fixture-*"; the demos rename them to ids the github-copilot price book prices, so the vendor
// resolves and the text reads like real use.
export const DEMO_COPILOT_MODELS = {
  "fixture-main-model": "claude-sonnet-5.5",
  "fixture-sub-model": "claude-haiku-5.5",
  "fixture-search-model": "gemini-3.8-flash",
} as const;

// DR11 (W5): the audit sessions' seed text that would read like test data on screen, rewritten in the
// demo home only (the server's tests assert the seed's own wording). The first is the failed call's
// evidence (the classifier's own invalid-arguments example); the second gives the read run's requests a
// billed figure like the shell run's, so its row doesn't show "0.00 AI Credits".
export const DEMO_AUDIT_TEXT_REWRITES = [
  ["Regex parse error: fixture", "Regex parse error: unclosed group"],
  ['"copilotUsageNanoAiu":0,', '"copilotUsageNanoAiu":500000000,'],
] as const;

// The MCP server of the unused-tools row, and its tools (the row's list shows five, then "and 1 more (about X)").
export const DEMO_UNUSED_TOOLS_SERVER = "acmedocs";
export const DEMO_UNUSED_TOOLS_TOOLS = ["search", "fetch", "list_pages", "get_page", "get_comments", "get_history"] as const;

// Two Copilot Chat sessions in the scratch repository, both inside the default 30-day window to
// FIXTURE_NOW (2026-11-06), both with the whole group loaded. The row's sessions list shows these titles.
export const DEMO_UNUSED_TOOLS_SESSIONS = [
  { id: "00000000-0000-4000-9000-0000000000d1", title: "Draft the release notes", startedAt: "2026-11-03T09:00:00.000Z" },
  { id: "00000000-0000-4000-9000-0000000000d2", title: "Check the API docs links", startedAt: "2026-10-29T09:00:00.000Z" },
] as const;

// The pi session on a local model (a llama.cpp server: no price, so its saving is "Not priced"). Its
// title is the name the session file carries; its list id is a hash of the file's path, so scenes
// click it by title. `id` is the header's session id.
export const DEMO_LOCAL_MODEL = "qwen3-coder-30b";
export const DEMO_PI_SESSION = {
  id: "p0000000-0000-4000-8000-0000000000d3",
  title: "Tidy the notes folder",
  startedAt: "2026-10-31T10:00:00.000Z",
  prompts: ["Show me the notes folder.", "Move the old notes into an archive folder.", "Add a short index file.", "Check that nothing was lost."],
} as const;

// A single-model Claude Code session in the scratch repository, inside the 30 days: every turn on one
// model, each reading the cache the one before wrote, so a replay on its own model matches its log
// (the self-check passes) and F4's Open replay shows a clean result.
export const DEMO_CLAUDE_SESSION = { id: "c0000000-0000-4000-8000-0000000000d4", startedAt: "2026-11-04T10:00:00.000Z" } as const;

const PI_FIXTURE = path.resolve(import.meta.dirname, "../../../server/fixtures/pi-agent/generated/pi-linear.jsonl");
// What the generated fixture records, which the demo replaces.
const GENERATED_FOLDER = "/home/user/project";
const GENERATED_MODEL = "qwen3.8-flash-next:setup6";

// 1.9 AI Credits a request (about what 20,000 input tokens, 15,000 of them cached, cost on Sonnet), so Open cost shows a billed figure.
const DEMO_NANO_AIU_PER_REQUEST = 1_900_000_000;

function copilotUnusedToolsSessions(home: string, cwd: string): void {
  const userDir = path.join(home, ".config", "Code", "User");
  const dbPath = path.join(userDir, "globalStorage", "github.copilot-chat", "session-store.db");
  const debugLogsDir = path.join(userDir, "workspaceStorage", "e2e-workspace", "GitHub.copilot-chat", "debug-logs");
  for (const { id, startedAt } of DEMO_UNUSED_TOOLS_SESSIONS) writeSavingsVscodeSession({ sessionStoreDbPath: dbPath, debugLogsDir, startedAt, sessionId: id, mcpTools: DEMO_UNUSED_TOOLS_TOOLS, nanoAiuPerRequest: DEMO_NANO_AIU_PER_REQUEST });
  const db = new DatabaseSync(dbPath);
  try {
    for (const { id, title } of DEMO_UNUSED_TOOLS_SESSIONS) db.prepare("UPDATE sessions SET cwd = ?, repository = NULL, summary = ? WHERE id = ?").run(cwd, title, id);
  } finally {
    db.close();
  }
}

// Every `timestamp` of the generated file moves by the same offset, so the session starts at `startedAt`.
function shiftTimestamps(value: unknown, offsetMs: number): unknown {
  if (Array.isArray(value)) return value.map((item) => shiftTimestamps(item, offsetMs));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => {
      if (key === "timestamp" && typeof inner === "string") return [key, new Date(Date.parse(inner) + offsetMs).toISOString()];
      if (key === "timestamp" && typeof inner === "number") return [key, inner + offsetMs];
      return [key, shiftTimestamps(inner, offsetMs)];
    }),
  );
}

// The parts of a pi session line this file reads or writes.
interface PiLine {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  name?: string;
  message?: { role: string; content?: unknown };
}

function piLocalModelSession(home: string, cwd: string): void {
  const text = readFileSync(PI_FIXTURE, "utf8").replaceAll(GENERATED_FOLDER, cwd).replaceAll(GENERATED_MODEL, DEMO_LOCAL_MODEL);
  const lines = text.trim().split("\n").map((line) => JSON.parse(line) as PiLine);
  const offset = Date.parse(DEMO_PI_SESSION.startedAt) - Date.parse(lines[0]!.timestamp!);
  let prompt = 0;
  const shifted = lines.map((line) => {
    const entry = shiftTimestamps(line, offset) as PiLine;
    if (entry.type === "session") entry.id = DEMO_PI_SESSION.id;
    // The generated prompts are scrambled words; the demo's are placeholders.
    if (entry.message?.role === "user") entry.message.content = [{ type: "text", text: DEMO_PI_SESSION.prompts[prompt++ % DEMO_PI_SESSION.prompts.length] }];
    return entry;
  });
  // pi names a session with a session_info entry; the list shows the name.
  const last = shifted.at(-1)!;
  shifted.push({ type: "session_info", id: "si000001", parentId: last.id!, timestamp: last.timestamp, name: DEMO_PI_SESSION.title });
  const folder = path.join(home, ".pi", "agent", "sessions", piSessionFolder(cwd));
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, `${DEMO_PI_SESSION.startedAt.replace(/[:.]/g, "-")}_${DEMO_PI_SESSION.id}.jsonl`), `${shifted.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

function textFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return textFiles(file);
    return file.endsWith(".jsonl") || file.endsWith(".json") ? [file] : [];
  });
}

function renameModels(home: string): void {
  for (const file of textFiles(home)) {
    let text = readFileSync(file, "utf8");
    const original = text;
    for (const [from, to] of Object.entries(DEMO_COPILOT_MODELS)) text = text.replaceAll(from, to);
    if (text !== original) writeFileSync(file, text);
  }
}

// Only the audit sessions' own logs: other fixture sessions record 0 credits on purpose.
function rewriteAuditText(home: string): void {
  const auditIds = [AUDIT_READ_SESSION_ID, AUDIT_SHELL_SESSION_ID];
  for (const file of textFiles(home).filter((name) => auditIds.some((id) => name.includes(id)))) {
    let text = readFileSync(file, "utf8");
    const original = text;
    for (const [from, to] of DEMO_AUDIT_TEXT_REWRITES) text = text.replaceAll(from, to);
    if (text !== original) writeFileSync(file, text);
  }
}

function claudeSingleModelSession(home: string, cwd: string): void {
  const at = (minutes: number) => new Date(Date.parse(DEMO_CLAUDE_SESSION.startedAt) + minutes * 60_000).toISOString();
  writeClaudeCodeSession(path.join(home, ".claude", "projects"), DEMO_CLAUDE_SESSION.id, cwd, [
    { at: at(0), input: 3000, cacheWrite: 60_000, output: 900 },
    { at: at(4), input: 300, cacheRead: 63_000, cacheWrite: 1700, output: 800 },
    { at: at(8), input: 300, cacheRead: 65_000, cacheWrite: 1500, output: 700 },
    { at: at(12), input: 300, cacheRead: 66_800, cacheWrite: 1300, output: 600 },
  ]);
}

// The shared seeds title some sessions "Fixture session"; no demo frame may read that (D36).
// Placeholder titles, handed out in session order; the shared home keeps its own.
const DEMO_SEED_TITLES = ["Add a settings page", "Review the open pull request", "Fix the flaky test", "Update the changelog"] as const;

function retitleFixtureSessions(home: string): void {
  const dbPath = path.join(home, ".config", "Code", "User", "globalStorage", "github.copilot-chat", "session-store.db");
  const db = new DatabaseSync(dbPath);
  try {
    const rows = db.prepare("SELECT id FROM sessions WHERE summary LIKE 'Fixture%' ORDER BY created_at, id").all() as { id: string }[];
    if (rows.length > DEMO_SEED_TITLES.length) throw new Error(`${rows.length} sessions need a demo title, ${DEMO_SEED_TITLES.length} are defined`);
    rows.forEach((row, index) => db.prepare("UPDATE sessions SET summary = ? WHERE id = ?").run(DEMO_SEED_TITLES[index], row.id));
  } finally {
    db.close();
  }
}

export function createDemoFixtureHome(home: string, options: FixtureOptions = {}): FixtureHome {
  const fixture = createFixtureHome(home, options);
  copilotUnusedToolsSessions(home, fixture.folders.scratch);
  piLocalModelSession(home, fixture.folders.scratch);
  claudeSingleModelSession(home, fixture.folders.scratch);
  retitleFixtureSessions(home);
  renameModels(home);
  if (options.auditSessions) rewriteAuditText(home);
  return fixture;
}
