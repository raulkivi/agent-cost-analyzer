// The fixture for the VS Code UI automation (step 10.16): the integration
// fixture, moved to where wdio-vscode-service reads user data
// (<storagePath>/settings), plus a 150-turn session (check 1.5), a system
// prompt (1.11) and the Copilot CLI event logs. Node runs this directly
// (type stripping), like the other fixture modules.
import { cpSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { COPILOT_CLI_FIXTURE_HOME, COPILOT_CLI_FIXTURE_SESSION_IDS, writeCopilotCliAgentHostStores } from "../../../server/src/test-support/copilot-cli-fixtures.ts";
import { createIntegrationFixture, USER_SETTINGS } from "../integration-fixture.mts";

export const LARGE_SESSION_TURNS = 150;
export const LARGE_SESSION_ID = "00000000-0000-4000-9000-000000000150";
// Text the System prompt tab must show for the usage session.
export const SYSTEM_PROMPT_MARKER = "UI-AUTOMATION-SYSTEM-PROMPT-MARKER";
const SYSTEM_PROMPT = [
  "You are an expert AI programming assistant, working with a user in the VS Code editor.",
  SYSTEM_PROMPT_MARKER,
  "<instructions>Keep going until the user's query is completely resolved.</instructions>",
].join("\n");

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
  // Sessions the Sessions view must list (Copilot Chat plus Agent Host): the isolation guard (F5).
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
  const debugDir = path.join(userDir, "workspaceStorage", "integration-workspace", "GitHub.copilot-chat", "debug-logs", base.usageSessionId);
  writeFileSync(path.join(debugDir, "system_prompt_0.json"), JSON.stringify({ content: JSON.stringify([{ type: "text", content: SYSTEM_PROMPT }]) }));

  // VS Code deletes workspace storage that names no existing folder; naming
  // the fixture's own root keeps the debug logs.
  writeFileSync(path.join(userDir, "workspaceStorage", "integration-workspace", "workspace.json"), JSON.stringify({ folder: pathToFileURL(rootDir).href }));
  seedLargeSession(path.join(userDir, "globalStorage", "github.copilot-chat", "session-store.db"), now);
  writeCopilotCliAgentHostStores(userDataDir);
  // A copy: once enabled, the Copilot Chat built in to VS Code writes its own
  // logs into COPILOT_HOME, which must not be the repo's fixture directory.
  const copilotHome = path.join(rootDir, "copilot-home");
  cpSync(COPILOT_CLI_FIXTURE_HOME, copilotHome, { recursive: true, filter: (source) => path.basename(source) !== "logs" });

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
    listedSessionCount: base.sessionCount + 1 + Object.keys(COPILOT_CLI_FIXTURE_SESSION_IDS).length,
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
