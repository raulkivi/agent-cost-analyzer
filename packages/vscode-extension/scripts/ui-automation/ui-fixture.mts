// The fixture for the VS Code UI automation (step 10.16): the integration
// fixture, moved to where wdio-vscode-service reads user data
// (<storagePath>/settings), plus a 150-turn session (check 1.5), a system
// prompt (1.11) and the Copilot CLI event logs. Node runs this directly
// (type stripping), like the other fixture modules.
import { cpSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { COPILOT_CLI_FIXTURE_HOME, COPILOT_CLI_FIXTURE_SESSION_IDS, writeCopilotCliAgentHostStores } from "../../../server/src/test-support/copilot-cli-fixtures.ts";
import { USAGE_LOG_USER_MESSAGE, USAGE_MAIN_JSONL, USAGE_SESSION_ID, seedSubagentFixtureSession } from "../../../server/src/test-support/copilot-session-store.ts";
import { SAVINGS_AGENT_HOST_SESSION_ID, SAVINGS_VSCODE_SESSION_ID, writeSavingsAgentHostSession, writeSavingsVscodeSession } from "../../../server/src/test-support/savings-fixtures.ts";
import { createIntegrationFixture, USER_SETTINGS } from "../integration-fixture.mts";

// VS Code's shared process deletes, 30 s after start-up, every workspaceStorage
// folder whose name isn't 32 characters long (a folder workspace's id) and that
// no window uses, and with it the seeded debug logs (the Sessions view then
// shows AI Credits unknown for every classic session). The seeded folder is
// named like a workspace id so the long UI runs keep their logs.
export const WORKSPACE_STORAGE_ID = "a11ce5ed1f1a4e0dbf7e0c0de0000001";

export const LARGE_SESSION_TURNS = 150;
export const LARGE_SESSION_ID = "00000000-0000-4000-9000-000000000150";
// A session of a window with no folder open (step 10.18): its debug log lives in the global storage.
export const EMPTY_WINDOW_SESSION_ID = "00000000-0000-4000-a000-0000000000e1";
// Text the System prompt tab must show for the usage session.
export const SYSTEM_PROMPT_MARKER = "UI-AUTOMATION-SYSTEM-PROMPT-MARKER";
const SYSTEM_PROMPT = [
  "You are an expert AI programming assistant, working with a user in the VS Code editor.",
  SYSTEM_PROMPT_MARKER,
  "<instructions>Keep going until the user's query is completely resolved.</instructions>",
].join("\n");

// Step 10.19 (SA15): two classic sessions from the server's subagent fixtures.
// The first has a runSubagent ("Explore") and a searchSubagent run (0.00,
// D8); `expectedCredits` is its folded total (two main requests of 2 AI
// Credits and the Explore run at 1.1). The second names a child log that is not
// there, so its AI Credits are unknown.
export const SUBAGENT_SESSION = {
  id: "00000000-0000-4000-9000-0000000000a1",
  title: "Subagent runs session",
  caseName: "run-and-search",
  expectedCredits: 5.1,
  // How long before the fixture's `now` it started.
  agoMs: 30_000,
};
export const DANGLING_SESSION = {
  id: "00000000-0000-4000-9000-0000000000a2",
  title: "Dangling subagent session",
  caseName: "dangling-ref",
  agoMs: 45_000,
};

export interface UiFixtureOptions {
  sessionCount?: number;
  now?: Date;
}

export interface UiFixture {
  // wdio:vscodeOptions.storagePath; the service's user-data dir is <storagePath>/settings.
  storagePath: string;
  userDataDir: string;
  // wdio:vscodeOptions.userSettings: the service overwrites User/settings.json with these.
  userSettings: Record<string, string | number | boolean | object>;
  // COPILOT_HOME for the launched VS Code, so the Copilot CLI event log read stays inside the fixture.
  copilotHome: string;
  usageSessionId: string;
  usageSessionTitle: string;
  largeSessionId: string;
  largeSessionTurns: number;
  systemPromptMarker: string;
  // Phase 16 SR13: what the savings report finds in the Copilot sessions
  // (D10). Both sessions start 3 days before `now`, inside the default
  // 30-day window and after the price book's first prices.
  savings: {
    // A local session loading an MCP server (`mcp_acmedocs_*`) no turn calls.
    unusedToolsServer: string;
    localSessionId: string;
    // An Agent Host session in which `rg` failed 3 times (command not found).
    failedCallsProgram: string;
    failedCallsCount: number;
    agentHostSessionId: string;
  };
  // Sessions the Sessions view must list (Copilot Chat, empty-window and Agent Host): the isolation guard (F5).
  listedSessionCount: number;
}

// Seeds <rootDir>/storage/settings. `rootDir` should be short (socket paths).
export function createUiFixture(rootDir: string, options: UiFixtureOptions = {}): UiFixture {
  const now = options.now ?? new Date();
  const base = createIntegrationFixture(rootDir, { sessionCount: options.sessionCount, now });
  const storagePath = path.join(rootDir, "storage");
  const userDataDir = path.join(storagePath, "settings");
  mkdirSync(storagePath, { recursive: true });
  renameSync(base.userDataDir, userDataDir);

  const userDir = path.join(userDataDir, "User");
  const workspaceStorage = path.join(userDir, "workspaceStorage");
  renameSync(path.join(workspaceStorage, "integration-workspace"), path.join(workspaceStorage, WORKSPACE_STORAGE_ID));
  const debugDir = path.join(workspaceStorage, WORKSPACE_STORAGE_ID, "GitHub.copilot-chat", "debug-logs", base.usageSessionId);
  writeFileSync(path.join(debugDir, "system_prompt_0.json"), JSON.stringify({ content: JSON.stringify([{ type: "text", content: SYSTEM_PROMPT }]) }));

  // VS Code deletes workspace storage that names no existing folder; naming
  // the fixture's own root keeps the debug logs.
  writeFileSync(path.join(workspaceStorage, WORKSPACE_STORAGE_ID, "workspace.json"), JSON.stringify({ folder: pathToFileURL(rootDir).href }));
  seedLargeSession(path.join(userDir, "globalStorage", "github.copilot-chat", "session-store.db"), now);
  seedEmptyWindowSession(userDir, now);
  seedSubagentSessions(userDir, now);
  writeCopilotCliAgentHostStores(userDataDir, now);
  // A copy: once enabled, the Copilot Chat built in to VS Code writes its own
  // logs into COPILOT_HOME, which must not be the repo's fixture directory.
  const copilotHome = path.join(rootDir, "copilot-home");
  cpSync(COPILOT_CLI_FIXTURE_HOME, copilotHome, { recursive: true, filter: (source) => path.basename(source) !== "logs" });

  const savingsStart = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  writeSavingsVscodeSession({
    sessionStoreDbPath: path.join(userDir, "globalStorage", "github.copilot-chat", "session-store.db"),
    debugLogsDir: path.join(workspaceStorage, WORKSPACE_STORAGE_ID, "GitHub.copilot-chat", "debug-logs"),
    startedAt: savingsStart.toISOString(),
  });
  writeSavingsAgentHostSession({ userDataDir, copilotHome, startedAtMs: savingsStart.getTime() + 60 * 60 * 1000 });

  return {
    storagePath,
    userDataDir,
    userSettings: USER_SETTINGS,
    copilotHome,
    usageSessionId: base.usageSessionId,
    usageSessionTitle: base.usageSessionTitle,
    largeSessionId: LARGE_SESSION_ID,
    largeSessionTurns: LARGE_SESSION_TURNS,
    systemPromptMarker: SYSTEM_PROMPT_MARKER,
    savings: {
      unusedToolsServer: "acmedocs",
      localSessionId: SAVINGS_VSCODE_SESSION_ID,
      failedCallsProgram: "rg",
      failedCallsCount: 3,
      agentHostSessionId: SAVINGS_AGENT_HOST_SESSION_ID,
    },
    // The large and empty-window sessions, the two classic subagent sessions,
    // the Copilot CLI fixtures and the two savings sessions.
    listedSessionCount: base.sessionCount + 2 + 2 + Object.keys(COPILOT_CLI_FIXTURE_SESSION_IDS).length + 2,
  };
}

export interface FirstRunFixture {
  storagePath: string;
  userDataDir: string;
  // wdio:vscodeOptions.userSettings: quiet start-up and nothing of Copilot's.
  userSettings: Record<string, string | number | boolean | object>;
}

// A VS Code that has never seen Copilot Chat (checks 1.1-1.3): a bare
// user-data dir with no Copilot or Agent Host store, no Copilot setting and no
// extension state, so the extension's first-run offer and its empty views are
// what a new user sees. The Get Started walkthrough is left to the extension
// (`workbench.startupEditor` stays none).
export function createFirstRunFixture(rootDir: string): FirstRunFixture {
  const storagePath = path.join(rootDir, "storage");
  const userDataDir = path.join(storagePath, "settings");
  const userSettings = Object.fromEntries(Object.entries(USER_SETTINGS).filter(([key]) => !key.startsWith("github.copilot")));
  mkdirSync(path.join(userDataDir, "User"), { recursive: true });
  writeFileSync(path.join(userDataDir, "User", "settings.json"), `${JSON.stringify(userSettings, null, 2)}\n`);
  return { storagePath, userDataDir, userSettings };
}

// The usage log under another session id, in the global debug logs (no
// workspace), with a store row of its own: it has AI Credits, like the usage
// session, and starts two minutes before `now`.
function seedEmptyWindowSession(userDir: string, now: Date): void {
  const logDir = path.join(userDir, "globalStorage", "github.copilot-chat", "debug-logs", EMPTY_WINDOW_SESSION_ID);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(path.join(logDir, "main.jsonl"), readFileSync(USAGE_MAIN_JSONL, "utf8").replaceAll(USAGE_SESSION_ID, EMPTY_WINDOW_SESSION_ID));
  const startedAt = new Date(now.getTime() - 120_000).toISOString();
  const db = new DatabaseSync(path.join(userDir, "globalStorage", "github.copilot-chat", "session-store.db"));
  try {
    db.prepare(
      "INSERT INTO sessions (id, cwd, repository, branch, host_type, summary, agent_name, agent_description, created_at, updated_at) VALUES (?, NULL, NULL, NULL, 'desktop', 'Empty window session', 'GitHub Copilot Chat', 'chat', ?, ?)",
    ).run(EMPTY_WINDOW_SESSION_ID, startedAt, startedAt);
    db.prepare("INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, 0, ?, 'hello', ?)").run(EMPTY_WINDOW_SESSION_ID, USAGE_LOG_USER_MESSAGE, startedAt);
  } finally {
    db.close();
  }
}

function seedSubagentSessions(userDir: string, now: Date): void {
  const dbPath = path.join(userDir, "globalStorage", "github.copilot-chat", "session-store.db");
  const debugLogsDir = path.join(userDir, "workspaceStorage", WORKSPACE_STORAGE_ID, "GitHub.copilot-chat", "debug-logs");
  for (const session of [SUBAGENT_SESSION, DANGLING_SESSION]) {
    const startedAt = new Date(now.getTime() - session.agoMs).toISOString();
    seedSubagentFixtureSession(dbPath, debugLogsDir, session.caseName, startedAt, session.id);
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("UPDATE sessions SET summary = ? WHERE id = ?").run(session.title, session.id);
    } finally {
      db.close();
    }
  }
}

function seedLargeSession(dbPath: string, now: Date): void {
  const db = new DatabaseSync(dbPath);
  try {
    const startedAt = new Date(now.getTime() - 60_000).toISOString();
    db.prepare(
      "INSERT INTO sessions (id, cwd, repository, branch, host_type, summary, agent_name, agent_description, created_at, updated_at) VALUES (?, '/repo', 'org/repo', 'main', 'desktop', 'Large session', 'GitHub Copilot Chat', 'chat', ?, ?)",
    ).run(LARGE_SESSION_ID, startedAt, startedAt);
    const insertTurn = db.prepare(
      "INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, ?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    for (let index = 0; index < LARGE_SESSION_TURNS; index++) {
      insertTurn.run(LARGE_SESSION_ID, index, `Question ${index}`, `Answer ${index}`, new Date(Date.parse(startedAt) + index * 1000).toISOString());
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}
