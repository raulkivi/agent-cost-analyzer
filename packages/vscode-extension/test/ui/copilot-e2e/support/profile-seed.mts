// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Pre-answers, in the real-Copilot suite's profile COPY (never the source),
// what VS Code would otherwise ask in a normal-mode run (G3), where no test
// runner auto-confirms dialogs:
// - the one-time "Enable global auto approve?" dialog that
//   `chat.tools.global.autoApprove` raises on the first tool call; the chat
//   waits on it, so the first test times out;
// - the chat panel's model: the sign-in window may have left it on Auto,
//   which routes to whichever model Copilot picks.
// Both are plain keys in the profile's global state (User/globalStorage/state.vscdb,
// application and default-profile scope). Nothing here reads the sign-in.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const GLOBAL_AUTO_APPROVE_OPT_IN_KEY = "chat.tools.global.autoApprove.optIn";
export const PANEL_MODEL_KEY = "chat.currentLanguageModel.panel";

// `model` is the suite's model id (COPILOT_E2E_MODEL), also the Copilot picker's id.
export function copilotStateSeeds(model: string): Record<string, string> {
  return { [GLOBAL_AUTO_APPROVE_OPT_IN_KEY]: "true", [PANEL_MODEL_KEY]: `copilot/${model}` };
}

export function seedProfileState(userDataDir: string, entries: Record<string, string>): void {
  const file = path.join(userDataDir, "User", "globalStorage", "state.vscdb");
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    // VS Code's own schema, for a profile that has no state yet.
    db.exec("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");
    const insert = db.prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(entries)) insert.run(key, value);
  } finally {
    db.close();
  }
}
