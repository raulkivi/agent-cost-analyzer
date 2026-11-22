// Phase 15 step 15.9 (docs/plans/cost-by-repository-and-project.md
// §12.4.1): the usage-scenario suite's seeded fixture home. A temporary
// HOME holding sessions from four providers, in the formats the providers
// read, arranged in four repositories (three with a git remote, one
// `local:`) and two projects, so the real resolver, attributor, price book
// and cost analyses run on real files:
//
//   Customer portal (portal): github.com/acme/portal-web + github.com/acme/portal-api
//   Billing service (billing): github.com/acme/billing
//   no project:                local:scratch, and a mitmproxy capture (Unattributed)
//
// Session text is placeholder only. The Copilot session and the mitmproxy
// capture are copies of the server's provider test fixtures; the Claude Code
// and pi sessions follow the shapes of those fixtures, with the times,
// folders and token counts the scenarios need. The server runs with
// AGENT_COST_ANALYZER_NOW = FIXTURE_NOW.
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { writeClaudeCodeSession, type ClaudeCodeTurn } from "../../../server/src/test-support/claude-code-session-writer.ts";
import { writeSavingsClaudeCodeSession } from "../../../server/src/test-support/savings-fixtures.ts";
import { writeCopilotCliAgentHostStores } from "../../../server/src/test-support/copilot-cli-fixtures.ts";
import {
  seedCopilotSessionStore,
  seedSubagentAuditFixtureSession,
  seedSubagentFixtureSession,
  USAGE_SESSION_ID,
  writeUsageDebugLog,
} from "../../../server/src/test-support/copilot-session-store.ts";

import { piSessionFolder } from "./pi-session-folder.mts";

export { FIXTURE_NOW } from "./fixture-clock.ts";

const SERVER_FIXTURES = path.resolve(import.meta.dirname, "../../../server/fixtures");

interface PiTurn {
  at: string;
  input: number;
  output: number;
  costUsd: number; // pi's own Usage.cost.total (reported)
}

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function gitRepository(folder: string, remote?: string): void {
  write(path.join(folder, ".git", "HEAD"), "ref: refs/heads/main\n");
  write(
    path.join(folder, ".git", "config"),
    remote ? `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${remote}\n` : "[core]\n\tbare = false\n",
  );
}

function plusSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

function claudeCodeSession(home: string, id: string, cwd: string, turns: ClaudeCodeTurn[]): void {
  writeClaudeCodeSession(path.join(home, ".claude", "projects"), id, cwd, turns);
}

function piSession(home: string, id: string, cwd: string, turns: PiTurn[]): void {
  const start = turns[0]!.at;
  const lines: unknown[] = [{ type: "session", version: 3, id, timestamp: start, cwd }];
  let parent = id;
  turns.forEach((turn, index) => {
    const userId = `u${index}`;
    const assistantId = `a${index}`;
    lines.push({ type: "message", id: userId, parentId: parent, timestamp: turn.at, message: { role: "user", content: `Placeholder prompt ${index + 1}.` } });
    lines.push({
      type: "message",
      id: assistantId,
      parentId: userId,
      timestamp: plusSeconds(turn.at, 5),
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Placeholder answer." }],
        api: "openai-responses",
        provider: "openai",
        model: "gpt-6.1-sol",
        usage: {
          input: turn.input,
          output: turn.output,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: turn.input + turn.output,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: turn.costUsd },
          reasoning: 0,
        },
        stopReason: "stop",
      },
    });
    parent = assistantId;
  });
  const folder = piSessionFolder(cwd);
  write(path.join(home, ".pi", "agent", "sessions", folder, `${start.replace(/[:.]/g, "-")}_${id}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

// A set-up user's Copilot settings, so the config check has nothing to report.
const COPILOT_SETTINGS = {
  "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
  "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
  "github.copilot.chat.otel.dbSpanExporter.enabled": true,
};

// Copilot Chat's session store plus the real debug log with AI Credits,
// moved into portal-web and dated 2026-10-27.
function copilotSession(home: string, cwd: string, startedAt: string): void {
  const userDir = path.join(home, ".config", "Code", "User");
  write(path.join(userDir, "settings.json"), `${JSON.stringify(COPILOT_SETTINGS, null, 2)}\n`);
  const dbPath = path.join(userDir, "globalStorage", "github.copilot-chat", "session-store.db");
  seedCopilotSessionStore(dbPath, startedAt);
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare("UPDATE sessions SET cwd = ?, repository = ? WHERE id = ?").run(cwd, "acme/portal-web", USAGE_SESSION_ID);
  } finally {
    db.close();
  }
  writeUsageDebugLog(path.join(userDir, "workspaceStorage", "e2e-workspace", "GitHub.copilot-chat", "debug-logs"));
}

// Step 10.19 (SA16): a classic Copilot Chat session with subagent runs (the
// server's run-and-search fixture: an "Explore" runSubagent on turn 1 and a
// searchSubagent run at 0.00 on turn 2), in the local scratch repository so
// the projects' figures stay as they were. Its AI Credits: 2 main requests of
// 2 each, plus the Explore run's 1.10.
export const SUBAGENT_SESSION_ID = "00000000-0000-4000-9000-0000000000a1";
export const SUBAGENT_SESSION_TITLE = "Subagent runs session";
export const SUBAGENT_SESSION_CREDITS = 5.1;
export const SUBAGENT_RUNS_CREDITS = 1.1;
export const SUBAGENT_RUN_MODEL = "fixture-sub-model";

function copilotSubagentSession(home: string, cwd: string, startedAt: string): void {
  const userDir = path.join(home, ".config", "Code", "User");
  const dbPath = path.join(userDir, "globalStorage", "github.copilot-chat", "session-store.db");
  seedSubagentFixtureSession(dbPath, path.join(userDir, "workspaceStorage", "e2e-workspace", "GitHub.copilot-chat", "debug-logs"), "run-and-search", startedAt, SUBAGENT_SESSION_ID);
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare("UPDATE sessions SET cwd = ?, repository = NULL, summary = ? WHERE id = ?").run(cwd, SUBAGENT_SESSION_TITLE, SUBAGENT_SESSION_ID);
  } finally {
    db.close();
  }
}

// MS8 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/monthly-allowance-standalone.md §11): Copilot sessions inside the
// period of FIXTURE_NOW (2026-11-06, UTC, reset day 1: 2026-11-01 up to
// 2026-12-01), which the sessions above (2026-10-27 and 28) fall before. Each
// has its own start day, so the reset day picks which of them a test counts:
//   2026-11-02  Agent Host (Copilot CLI) sessions, some with cost data and
//               some without
//   2026-11-03  a classic session with AI Credits for every request: 5.1
//   2026-11-05  a classic session with a request that has no AI Credits:
//               unknown. Reset day 5 leaves it as the only session.
// The classic ones sit in the local scratch repository, so no project's
// figures move. Opt-in (`allowanceSessions`): in every spec they would grow
// the Dashboard past the density budget and double the 10.19 model view's total.
export const ALLOWANCE_KNOWN_SESSION_ID = "00000000-0000-4000-9000-0000000000b1";
export const ALLOWANCE_UNKNOWN_SESSION_ID = "00000000-0000-4000-9000-0000000000b2";

function copilotAllowanceSessions(home: string, cwd: string): void {
  const userDir = path.join(home, ".config", "Code", "User");
  const dbPath = path.join(userDir, "globalStorage", "github.copilot-chat", "session-store.db");
  const debugLogs = path.join(userDir, "workspaceStorage", "e2e-workspace", "GitHub.copilot-chat", "debug-logs");
  const seeds: [string, string, string][] = [
    ["run-and-search", ALLOWANCE_KNOWN_SESSION_ID, "2026-11-03T10:00:00.000Z"],
    ["request-without-credits", ALLOWANCE_UNKNOWN_SESSION_ID, "2026-11-05T10:00:00.000Z"],
  ];
  for (const [name, id, startedAt] of seeds) seedSubagentFixtureSession(dbPath, debugLogs, name, startedAt, id);
  const db = new DatabaseSync(dbPath);
  try {
    for (const [, id] of seeds) db.prepare("UPDATE sessions SET cwd = ?, repository = NULL WHERE id = ?").run(cwd, id);
  } finally {
    db.close();
  }
  writeCopilotCliAgentHostStores(path.join(home, ".config", "Code"), new Date("2026-11-02T12:00:00.000Z"));
}

// Step 10.20 (ST12): two classic sessions from the server's audit fixtures,
// inside the default 30-day window to FIXTURE_NOW. Opt-in (`auditSessions`):
// in every spec they would change the sessions list and the rollups other
// specs count. They sit in the local scratch repository.
//   explore-linked        two explore_subagent calls: one read run with child-log
//                         tool calls, one with no log (an unread run)
//   shell-calls           a child log of shell calls, one a pipe into a shell
//                         (a security finding that names its run)
export const AUDIT_READ_SESSION_ID = "00000000-0000-4000-9000-0000000000c1";
export const AUDIT_READ_SESSION_TITLE = "Subagent audit session";
export const AUDIT_SHELL_SESSION_ID = "00000000-0000-4000-9000-0000000000c2";
export const AUDIT_SHELL_SESSION_TITLE = "Subagent audit shell session";

function copilotAuditSessions(home: string, cwd: string): void {
  const userDir = path.join(home, ".config", "Code", "User");
  const dbPath = path.join(userDir, "globalStorage", "github.copilot-chat", "session-store.db");
  const debugLogs = path.join(userDir, "workspaceStorage", "e2e-workspace", "GitHub.copilot-chat", "debug-logs");
  const seeds: [string, string, string, string][] = [
    ["explore-linked", AUDIT_READ_SESSION_ID, AUDIT_READ_SESSION_TITLE, "2026-11-04T10:00:00.000Z"],
    ["shell-calls", AUDIT_SHELL_SESSION_ID, AUDIT_SHELL_SESSION_TITLE, "2026-11-04T12:00:00.000Z"],
  ];
  for (const [name, id, , startedAt] of seeds) seedSubagentAuditFixtureSession(dbPath, debugLogs, name, startedAt, id);
  const db = new DatabaseSync(dbPath);
  try {
    for (const [, id, title] of seeds) db.prepare("UPDATE sessions SET cwd = ?, repository = NULL, summary = ? WHERE id = ?").run(cwd, title, id);
  } finally {
    db.close();
  }
}

// Step CS13: two Claude Code sessions with subagent runs, from the server's
// fixtures (`fixtures/claude-code/subagents/`). Opt-in (`claudeSubagentSessions`):
// in every spec they would change the sessions list and the rollups other
// specs count.
//   linked-run          one run, linked by its Agent call: tokens and a priced cost
//   missing-transcript  an Agent call whose transcript is missing: an unknown run
export const CLAUDE_SUBAGENT_KNOWN_TITLE = "known-run";
export const CLAUDE_SUBAGENT_UNKNOWN_TITLE = "missing-run";
const SUBAGENT_FIXTURES = path.resolve(import.meta.dirname, "../../../server/fixtures/claude-code/subagents");

// Both fixtures use the folder /home/dev/project, which names the session;
// each copy gets its own folder name so the sessions list tells them apart.
function claudeSubagentSessions(home: string): void {
  const seeds: [string, string][] = [
    ["linked-run", CLAUDE_SUBAGENT_KNOWN_TITLE],
    ["missing-transcript", CLAUDE_SUBAGENT_UNKNOWN_TITLE],
  ];
  for (const [fixture, title] of seeds) {
    const to = path.join(home, ".claude", "projects", `-home-dev-${title}`);
    cpSync(path.join(SUBAGENT_FIXTURES, fixture, "-home-dev-project"), to, { recursive: true });
    rewriteFolder(to, title);
  }
}

function rewriteFolder(dir: string, title: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) rewriteFolder(full, title);
    else if (entry.name.endsWith(".jsonl") || entry.name.endsWith(".json")) writeFileSync(full, readFileSync(full, "utf8").replaceAll("/home/dev/project", `/home/dev/${title}`));
  }
}

export interface FixtureHome {
  home: string;
  appSettingsDir: string;
  folders: { portalWeb: string; portalApi: string; billing: string; scratch: string; mobile: string };
}

// Step 15.11: scenario S1 starts with no projects file.
export interface FixtureOptions {
  projects?: boolean;
  // MS8: the allowance in the app's settings.json; absent is not set.
  allowance?: { aiCredits: number | null; resetDay: number; warnAtPercent: number } | undefined;
  // MS8: add the in-period Copilot sessions of `copilotAllowanceSessions`.
  allowanceSessions?: boolean;
  // Step 10.20: add the subagent audit sessions of `copilotAuditSessions`.
  auditSessions?: boolean;
  // Step CS13: add the Claude Code subagent sessions of `claudeSubagentSessions`.
  claudeSubagentSessions?: boolean;
}

export function createFixtureHome(home: string, options: FixtureOptions = {}): FixtureHome {
  const dev = path.join(home, "dev");
  const folders = {
    portalWeb: path.join(dev, "portal-web"),
    portalApi: path.join(dev, "portal-api"),
    billing: path.join(dev, "billing"),
    scratch: path.join(dev, "scratch"),
    mobile: path.join(dev, "mobile-app"),
  };
  gitRepository(folders.portalWeb, "git@github.com:acme/portal-web.git");
  gitRepository(folders.portalApi, "https://github.com/acme/portal-api.git");
  gitRepository(folders.billing, "git@github.com:acme/billing.git");
  gitRepository(folders.scratch);
  gitRepository(folders.mobile, "git@github.com:acme/mobile-app.git");

  // Customer portal. 2026-09-15 is before the price book's first price
  // (2026-10-01), so that week's turn has no known cost: the gap in S2.
  claudeCodeSession(home, "c0000000-0000-4000-8000-000000000001", folders.portalWeb, [{ at: "2026-09-15T10:00:00.000Z", input: 2000, output: 400 }]);
  claudeCodeSession(home, "c0000000-0000-4000-8000-000000000002", folders.portalWeb, [
    { at: "2026-10-05T09:00:00.000Z", input: 10_000, cacheWrite: 20_000, output: 2000 },
    { at: "2026-10-05T09:30:00.000Z", input: 1000, cacheRead: 20_000, output: 1000 },
  ]);
  claudeCodeSession(home, "c0000000-0000-4000-8000-000000000003", folders.portalApi, [{ at: "2026-10-12T14:00:00.000Z", input: 4000, cacheRead: 40_000, output: 1500 }]);
  piSession(home, "p0000000-0000-4000-8000-000000000004", folders.portalApi, [{ at: "2026-10-20T08:00:00.000Z", input: 3000, output: 500, costUsd: 0.05 }]);
  copilotSession(home, folders.portalWeb, "2026-10-27T11:00:00.000Z");
  copilotSubagentSession(home, folders.scratch, "2026-10-28T11:00:00.000Z");
  if (options.allowanceSessions) copilotAllowanceSessions(home, folders.scratch);
  if (options.auditSessions) copilotAuditSessions(home, folders.scratch);
  if (options.claudeSubagentSessions) claudeSubagentSessions(home);

  // Billing service.
  claudeCodeSession(home, "c0000000-0000-4000-8000-000000000005", folders.billing, [{ at: "2026-10-14T10:00:00.000Z", input: 6000, cacheRead: 10_000, output: 1000 }]);
  piSession(home, "p0000000-0000-4000-8000-000000000006", folders.billing, [{ at: "2026-10-21T16:00:00.000Z", input: 2000, output: 300, costUsd: 0.02 }]);
  // Before the price book's first price: unknown, so billing's coverage is partial.
  claudeCodeSession(home, "c0000000-0000-4000-8000-000000000007", folders.billing, [{ at: "2026-08-20T10:00:00.000Z", input: 1000, output: 100 }]);
  // The previous 90 days (May 11 to Aug 8), for Compare's "Change": pi logged $0.01.
  piSession(home, "p0000000-0000-4000-8000-000000000009", folders.billing, [{ at: "2026-07-20T09:00:00.000Z", input: 500, output: 100, costUsd: 0.01 }]);

  // Mobile app (step 15.12, S7): six priced pi days in October, so the
  // 12-week estimate has a range (an estimate needs 5 known active days).
  [3, 8, 13, 17, 22, 29].forEach((day, index) =>
    piSession(home, `p0000000-0000-4000-8000-0000000001${index}0`, folders.mobile, [
      { at: `2026-10-${String(day).padStart(2, "0")}T09:00:00.000Z`, input: 1000 * (index + 1), output: 200 * (index + 1), costUsd: 0.01 * (index + 1) },
    ]),
  );

  // No project: a local repository and a capture with no folder.
  claudeCodeSession(home, "c0000000-0000-4000-8000-000000000008", folders.scratch, [{ at: "2026-10-22T10:00:00.000Z", input: 1000, output: 200 }]);

  // Phase 16 SR13: the savings report's Claude Code findings (an idle gap past
  // the harness's 1-hour cache and a model switch), in the scratch repository
  // so no project's figures move. 2026-10-30 is inside the default 30-day
  // window to FIXTURE_NOW (2026-10-08 to 2026-11-06) and after the price
  // book's first prices, so the specs need no `pricing: "today"`.
  writeSavingsClaudeCodeSession(path.join(home, ".claude", "projects"), folders.scratch, "2026-10-30");

  const appSettingsDir = path.join(home, ".config", "agent-cost-analyzer");
  if (options.projects !== false) write(
    path.join(appSettingsDir, "projects.json"),
    `${JSON.stringify(
      {
        version: 1,
        projects: [
          { id: "portal", name: "Customer portal", members: [{ repository: "github.com/acme/portal-web" }, { repository: "github.com/acme/portal-api" }] },
          { id: "billing", name: "Billing service", members: [{ repository: "github.com/acme/billing" }] },
          { id: "mobile", name: "Mobile app", members: [{ repository: "github.com/acme/mobile-app" }] },
        ],
      },
      null,
      2,
    )}\n`,
  );
  if (options.allowance) write(path.join(appSettingsDir, "settings.json"), `${JSON.stringify({ monthlyAllowance: options.allowance }, null, 2)}\n`);
  const captures = path.join(appSettingsDir, "mitmproxy-captures");
  mkdirSync(captures, { recursive: true });
  copyFileSync(path.join(SERVER_FIXTURES, "mitmproxy", "anthropic-non-streamed.har"), path.join(captures, "anthropic-non-streamed.har"));

  return { home, appSettingsDir, folders };
}
