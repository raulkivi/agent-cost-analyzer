// The real-VS Code integration suite's fixture (step 10.9): a throwaway
// VS Code user-data dir with user settings and a seeded Copilot Chat
// session store, which .vscode-test.mjs creates before VS Code starts and
// launches it with (--user-data-dir). Node runs this directly (type
// stripping), so it imports the server's seeding helper by its .ts path.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  seedCopilotSessionStore,
  USAGE_SESSION_ID,
  writeUsageDebugLog,
} from "../../server/src/test-support/copilot-session-store.ts";

// How the suite, inside VS Code, learns about the fixture: JSON in this
// environment variable (@vscode/test-cli passes `env` on to VS Code).
export const INTEGRATION_FIXTURE_ENV = "AI_CREDITS_ANALYZER_INTEGRATION_FIXTURE";

export interface IntegrationFixture {
  userDataDir: string;
  // The session with a debug log: real token and AI Credits numbers.
  usageSessionId: string;
  usageSessionTitle: string;
  sessionCount: number;
}

export interface IntegrationFixtureOptions {
  // Sessions in the store, the usage session included. 200 by default:
  // the §3.5 budgets are "with 200 sessions" (the walkthrough's "keep 200
  // sessions" step).
  sessionCount?: number;
  now?: Date;
}

const DEFAULT_SESSION_COUNT = 200;
// seedCopilotSessionStore's title for the usage session.
const USAGE_SESSION_TITLE = "Fix the bug";
const HOUR_MS = 60 * 60 * 1000;

// The settings a set-up user has: Copilot's debug logs on and kept, agent
// traces on (so the Setup view has nothing to report), the MCP server off
// (the suite turns it on itself), and nothing that would open an editor or
// reach the network at start-up.
const USER_SETTINGS = {
  "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
  "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
  "github.copilot.chat.otel.dbSpanExporter.enabled": true,
  "aiCreditsAnalyzer.mcp.enabled": false,
  "workbench.startupEditor": "none",
  "extensions.autoCheckUpdates": false,
  "update.mode": "none",
  "telemetry.telemetryLevel": "off",
};

// A fixed, valid session id per seeded session.
function seededSessionId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

// Seeds <rootDir>/user-data. The usage session starts at `now` (today, in
// the Sessions view); the others an hour apart before it, each with one
// turn and no debug log.
export function createIntegrationFixture(rootDir: string, options: IntegrationFixtureOptions = {}): IntegrationFixture {
  const sessionCount = options.sessionCount ?? DEFAULT_SESSION_COUNT;
  if (!Number.isInteger(sessionCount) || sessionCount < 1) {
    throw new Error(`The integration fixture needs at least 1 session, not ${sessionCount}`);
  }
  const now = options.now ?? new Date();
  const userDataDir = path.join(rootDir, "user-data");
  const userDir = path.join(userDataDir, "User");
  mkdirSync(userDir, { recursive: true });
  writeFileSync(path.join(userDir, "settings.json"), `${JSON.stringify(USER_SETTINGS, null, 2)}\n`);

  const sessionStoreDbPath = path.join(userDir, "globalStorage", "github.copilot-chat", "session-store.db");
  seedCopilotSessionStore(sessionStoreDbPath, now.toISOString());
  writeUsageDebugLog(path.join(userDir, "workspaceStorage", "integration-workspace", "GitHub.copilot-chat", "debug-logs"));

  const db = new DatabaseSync(sessionStoreDbPath);
  try {
    const insertSession = db.prepare(
      "INSERT INTO sessions (id, cwd, repository, branch, host_type, summary, agent_name, agent_description, created_at, updated_at) VALUES (?, '/repo', 'org/repo', 'main', 'desktop', ?, 'GitHub Copilot Chat', 'chat', ?, ?)",
    );
    const insertTurn = db.prepare(
      "INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, 0, 'hi', 'hello', ?)",
    );
    db.exec("BEGIN");
    for (let index = 1; index < sessionCount; index++) {
      const startedAt = new Date(now.getTime() - index * HOUR_MS).toISOString();
      const id = seededSessionId(index);
      insertSession.run(id, `Seeded session ${index}`, startedAt, startedAt);
      insertTurn.run(id, startedAt);
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }

  return { userDataDir, usageSessionId: USAGE_SESSION_ID, usageSessionTitle: USAGE_SESSION_TITLE, sessionCount };
}
