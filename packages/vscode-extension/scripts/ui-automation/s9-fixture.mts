// Scenario S9's fixture (Phase 15 step 15.14, plan §12.4.2): Copilot Chat
// sessions in two workspace folders that are git repositories with a
// remote, the first of which VS Code opens. The usage session (the one
// with cost data) and one session with none are in portal-web; one session
// with none is in billing-api. No Agent Host sessions, so every figure is
// the fixture's own. Node runs this directly (type stripping), like
// ui-fixture.mts.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { createIntegrationFixture, USER_SETTINGS } from "../integration-fixture.mts";

export const S9_REPOSITORIES = {
  portal: { folder: "portal-web", remote: "https://github.com/example/portal-web.git", key: "github.com/example/portal-web" },
  billing: { folder: "billing-api", remote: "git@github.com:example/billing-api.git", key: "github.com/example/billing-api" },
} as const;

// What the Sessions view and the status bar must show (s9-fixture.test.ts
// checks these against the extension's own code over this fixture). The
// usage session's AI Credits are its debug log's billed requests, 9.64735
// (ui-fixture-credits.test.ts), shown to 2 decimals; the others have no
// cost data, so they are counted as unknown, never 0.
export const S9_EXPECTED = {
  groups: [
    { label: "github.com/example/portal-web", description: "9.65 · 1 unknown" },
    { label: "github.com/example/billing-api", description: "1 unknown" },
  ],
  statusText: "portal-web 9.65 AI Credits today",
  statusAriaLabel: "AI Credits today: 9.65 in portal-web, 9.65 in all repositories, 1 of 3 sessions today have cost data. Open analyzer.",
} as const;

export interface S9Fixture {
  storagePath: string;
  userDataDir: string;
  userSettings: Record<string, string | number | boolean | object>;
  // An empty COPILOT_HOME: no Copilot CLI event logs.
  copilotHome: string;
  // The folder VS Code opens: portal-web.
  workspacePath: string;
  // The session with cost data, in portal-web.
  usageSessionId: string;
  repositoryPaths: { portal: string; billing: string };
}

function writeRepository(dir: string, remote: string): void {
  mkdirSync(path.join(dir, ".git"), { recursive: true });
  writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(path.join(dir, ".git", "config"), `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${remote}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
}

// Seeds <rootDir>/storage/settings and <rootDir>/repos. `rootDir` should be
// short (VS Code's socket paths). The three sessions start minutes apart
// before `now`, so they are all today.
export function createS9Fixture(rootDir: string, now: Date = new Date()): S9Fixture {
  const base = createIntegrationFixture(rootDir, { sessionCount: 3, now });
  const storagePath = path.join(rootDir, "storage");
  const userDataDir = path.join(storagePath, "settings");
  mkdirSync(storagePath, { recursive: true });
  renameSync(base.userDataDir, userDataDir);

  const repositoryPaths = {
    portal: path.join(rootDir, "repos", S9_REPOSITORIES.portal.folder),
    billing: path.join(rootDir, "repos", S9_REPOSITORIES.billing.folder),
  };
  writeRepository(repositoryPaths.portal, S9_REPOSITORIES.portal.remote);
  writeRepository(repositoryPaths.billing, S9_REPOSITORIES.billing.remote);

  const userDir = path.join(userDataDir, "User");
  // VS Code deletes workspace storage that names no existing folder.
  writeFileSync(path.join(userDir, "workspaceStorage", "integration-workspace", "workspace.json"), JSON.stringify({ folder: pathToFileURL(repositoryPaths.portal).href }));
  const db = new DatabaseSync(path.join(userDir, "globalStorage", "github.copilot-chat", "session-store.db"));
  try {
    const ids = (db.prepare("SELECT id FROM sessions ORDER BY created_at DESC").all() as { id: string }[]).map((row) => row.id);
    const folders = [repositoryPaths.portal, repositoryPaths.billing, repositoryPaths.portal];
    const update = db.prepare("UPDATE sessions SET cwd = ?, repository = NULL, created_at = ?, updated_at = ? WHERE id = ?");
    ids.forEach((id, index) => {
      const startedAt = new Date(now.getTime() - index * 60_000).toISOString();
      update.run(folders[index] ?? repositoryPaths.portal, startedAt, startedAt, id);
    });
  } finally {
    db.close();
  }
  const copilotHome = path.join(rootDir, "copilot-home");
  mkdirSync(copilotHome, { recursive: true });

  return { storagePath, userDataDir, userSettings: USER_SETTINGS, copilotHome, workspacePath: repositoryPaths.portal, usageSessionId: base.usageSessionId, repositoryPaths };
}
