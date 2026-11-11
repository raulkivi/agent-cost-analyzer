// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Made-up Copilot Chat history for the G4 view specs (step 10.17,
// docs/plans/release-ui-gate.md): sessions in two git repositories over
// several weeks, each with the server fixture's real debug log (known AI
// Credits) under its own session id, so U9, U10 and U11 have something to
// show. Seeded into the run's profile copy before VS Code starts; the
// owner's own chats are never what a spec asserts on. The repositories are
// scenario S9's (s9-fixture.mts).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import {
  COPILOT_SESSION_STORE_SCHEMA,
  USAGE_LOG_USER_MESSAGE,
  USAGE_MAIN_JSONL,
  USAGE_SESSION_ID,
} from "../../../../../server/src/test-support/copilot-session-store.ts";
import { S9_REPOSITORIES } from "../../../../scripts/ui-automation/s9-fixture.mts";

export const HISTORY_REPOSITORIES = S9_REPOSITORIES;

// The seeded ChatHistory, as JSON, from the wdio launcher to its workers.
export const CHAT_HISTORY_ENV = "AI_CREDITS_ANALYZER_COPILOT_E2E_HISTORY";

type RepositoryName = keyof typeof HISTORY_REPOSITORIES;

const DAY_MS = 24 * 60 * 60 * 1000;
// Days before `now` each session started. Portal has more, so it costs the
// most; both have sessions in the comparison period and the one before it,
// and portal in both periods of the cost change, more in the later one.
const SESSIONS: readonly { repository: RepositoryName; daysAgo: number }[] = [
  { repository: "portal", daysAgo: 38 },
  { repository: "billing", daysAgo: 35 },
  { repository: "portal", daysAgo: 31 },
  { repository: "billing", daysAgo: 24 },
  { repository: "portal", daysAgo: 17 },
  { repository: "portal", daysAgo: 10 },
  { repository: "billing", daysAgo: 6 },
  { repository: "portal", daysAgo: 3 },
];

// The workspace-storage folder the debug logs go in. VS Code's shared
// process deletes, 30 s after start-up, every folder whose name isn't 32
// characters long (a folder workspace's id) and that no window uses, so the
// id is 32 hex characters; its workspace.json names an existing folder.
const WORKSPACE_STORAGE_ID = createHash("md5").update("aica-e2e-history").digest("hex");

export interface DateRange {
  since: string;
  until: string;
}

export interface ChatHistory {
  // Newest first.
  sessionIds: string[];
  repositoryPaths: Record<RepositoryName, string>;
  periods: {
    last90Days: DateRange;
    // compare_costs: the last 28 days (and, by default, the 28 before).
    comparison: DateRange;
    // explain_cost_change: days 42-22 before now against 21-1.
    change: { periodA: DateRange; periodB: DateRange };
  };
}

export interface SeedChatHistoryOptions {
  // VS Code's user-data dir (the run's profile copy).
  userDataDir: string;
  // Where the two repositories are made.
  reposDir: string;
  now: Date;
}

function day(now: Date, daysAgo: number): string {
  return new Date(now.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

function sessionId(index: number): string {
  return `00000000-0000-4000-a000-${String(index + 1).padStart(12, "0")}`;
}

function writeRepository(dir: string, remote: string): void {
  mkdirSync(path.join(dir, ".git"), { recursive: true });
  writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(path.join(dir, ".git", "config"), `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${remote}\n`);
}

function openStore(dbPath: string): DatabaseSync {
  const isNew = !existsSync(dbPath);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  if (isNew) db.exec(COPILOT_SESSION_STORE_SCHEMA);
  return db;
}

function storePathOf(userDataDir: string): string {
  return path.join(userDataDir, "User", "globalStorage", "github.copilot-chat", "session-store.db");
}

// Drops the chats the copied profile already holds, so a view shows only the
// made-up history and the run's own chats: the Agent Host catalog, chats in
// an empty window, Copilot Chat's store rows (its schema stays, for Copilot
// Chat to keep writing) and the per-workspace debug logs. The sign-in and
// every other state stay. Runs on the copy only, never the owner's profile.
export function clearChatHistory(userDataDir: string): void {
  const globalStorage = path.join(userDataDir, "User", "globalStorage");
  for (const file of ["agent-host.db", "agent-host.db-wal", "agent-host.db-shm"]) rmSync(path.join(globalStorage, file), { force: true });
  rmSync(path.join(globalStorage, "emptyWindowChatSessions"), { recursive: true, force: true });
  rmSync(path.join(userDataDir, "agentSessionData"), { recursive: true, force: true });
  const workspaceStorage = path.join(userDataDir, "User", "workspaceStorage");
  if (existsSync(workspaceStorage)) {
    for (const workspace of readdirSync(workspaceStorage)) rmSync(path.join(workspaceStorage, workspace, "GitHub.copilot-chat"), { recursive: true, force: true });
  }
  if (!existsSync(storePathOf(userDataDir))) return;
  const db = new DatabaseSync(storePathOf(userDataDir));
  try {
    for (const table of ["turns", "checkpoints", "session_files", "sessions"]) db.exec(`DELETE FROM ${table}`);
  } finally {
    db.close();
  }
}

export function seedChatHistory({ userDataDir, reposDir, now }: SeedChatHistoryOptions): ChatHistory {
  const repositoryPaths = {
    portal: path.join(reposDir, HISTORY_REPOSITORIES.portal.folder),
    billing: path.join(reposDir, HISTORY_REPOSITORIES.billing.folder),
  };
  writeRepository(repositoryPaths.portal, HISTORY_REPOSITORIES.portal.remote);
  writeRepository(repositoryPaths.billing, HISTORY_REPOSITORIES.billing.remote);

  const userDir = path.join(userDataDir, "User");
  const workspaceDir = path.join(userDir, "workspaceStorage", WORKSPACE_STORAGE_ID);
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(path.join(workspaceDir, "workspace.json"), JSON.stringify({ folder: pathToFileURL(repositoryPaths.portal).href }));
  const debugLog = readFileSync(USAGE_MAIN_JSONL, "utf8");

  // Only the columns every store version has, so a store Copilot Chat made keeps working.
  const db = openStore(storePathOf(userDataDir));
  const ids: string[] = [];
  try {
    const insertSession = db.prepare(
      "INSERT INTO sessions (id, cwd, repository, branch, host_type, summary, agent_name, agent_description, created_at, updated_at) VALUES (?, ?, NULL, 'main', 'desktop', ?, 'GitHub Copilot Chat', 'chat', ?, ?)",
    );
    const insertTurn = db.prepare("INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, 0, ?, 'Placeholder answer.', ?)");
    db.exec("BEGIN");
    SESSIONS.forEach(({ repository, daysAgo }, index) => {
      const id = sessionId(index);
      const startedAt = new Date(now.getTime() - daysAgo * DAY_MS).toISOString();
      insertSession.run(id, repositoryPaths[repository], `Placeholder ${HISTORY_REPOSITORIES[repository].folder} session ${index + 1}`, startedAt, startedAt);
      insertTurn.run(id, USAGE_LOG_USER_MESSAGE, startedAt);
      const logDir = path.join(workspaceDir, "GitHub.copilot-chat", "debug-logs", id);
      mkdirSync(logDir, { recursive: true });
      writeFileSync(path.join(logDir, "main.jsonl"), debugLog.replaceAll(USAGE_SESSION_ID, id));
      ids.push(id);
    });
    db.exec("COMMIT");
  } finally {
    db.close();
  }

  const newestFirst = SESSIONS.map((session, index) => ({ ...session, id: ids[index]! })).sort((a, b) => a.daysAgo - b.daysAgo);
  return {
    sessionIds: newestFirst.map((session) => session.id),
    repositoryPaths,
    periods: {
      last90Days: { since: day(now, 90), until: day(now, 0) },
      comparison: { since: day(now, 27), until: day(now, 0) },
      change: { periodA: { since: day(now, 42), until: day(now, 22) }, periodB: { since: day(now, 21), until: day(now, 1) } },
    },
  };
}
