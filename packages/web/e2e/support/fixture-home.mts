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
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  seedCopilotSessionStore,
  seedSubagentFixtureSession,
  USAGE_SESSION_ID,
  writeUsageDebugLog,
} from "../../../server/src/test-support/copilot-session-store.ts";

export { FIXTURE_NOW } from "./fixture-clock.ts";

const SERVER_FIXTURES = path.resolve(import.meta.dirname, "../../../server/fixtures");

// Claude Sonnet 5.5 as Claude Code logs it; the price book maps it to
// claude-sonnet-5.5 on anthropic-api (cache reads cut on 2026-10-07).
const SONNET = "claude-sonnet-5-5-20261001";

interface ClaudeTurn {
  at: string; // ISO time of the user message
  input: number;
  cacheWrite?: number;
  cacheRead?: number;
  output: number;
}

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

function claudeCodeSession(home: string, id: string, cwd: string, turns: ClaudeTurn[]): void {
  const slug = cwd.replace(/[^A-Za-z0-9]/g, "-");
  const lines: unknown[] = [];
  let parent: string | null = null;
  turns.forEach((turn, index) => {
    const userId = `u${index}`;
    const assistantId = `a${index}`;
    lines.push({
      parentUuid: parent,
      isSidechain: false,
      promptId: `p${index}`,
      type: "user",
      message: { role: "user", content: [{ type: "text", text: `Placeholder prompt ${index + 1}.` }] },
      uuid: userId,
      timestamp: turn.at,
      permissionMode: "default",
      origin: { kind: "human" },
      userType: "external",
      entrypoint: "cli",
      cwd,
      sessionId: id,
      version: "2.1.263",
      gitBranch: "main",
    });
    lines.push({
      type: "assistant",
      parentUuid: userId,
      isSidechain: false,
      message: {
        model: SONNET,
        id: `msg_${id.slice(0, 8)}_${index}`,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Placeholder answer." }],
        usage: {
          input_tokens: turn.input,
          cache_creation_input_tokens: turn.cacheWrite ?? 0,
          cache_read_input_tokens: turn.cacheRead ?? 0,
          output_tokens: turn.output,
          output_tokens_details: { thinking_tokens: 0 },
          service_tier: "standard",
          cache_creation: { ephemeral_1h_input_tokens: turn.cacheWrite ?? 0, ephemeral_5m_input_tokens: 0 },
        },
      },
      uuid: assistantId,
      timestamp: plusSeconds(turn.at, 5),
      cwd,
      sessionId: id,
      gitBranch: "main",
    });
    parent = assistantId;
  });
  write(path.join(home, ".claude", "projects", slug, `${id}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
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
  const folder = `--${cwd.replace(/^\//, "").replace(/\//g, "-")}--`;
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

export interface FixtureHome {
  home: string;
  appSettingsDir: string;
  folders: { portalWeb: string; portalApi: string; billing: string; scratch: string; mobile: string };
}

// Step 15.11: scenario S1 starts with no projects file.
export interface FixtureOptions {
  projects?: boolean;
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
  const captures = path.join(appSettingsDir, "mitmproxy-captures");
  mkdirSync(captures, { recursive: true });
  copyFileSync(path.join(SERVER_FIXTURES, "mitmproxy", "anthropic-non-streamed.har"), path.join(captures, "anthropic-non-streamed.har"));

  return { home, appSettingsDir, folders };
}
