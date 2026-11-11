// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Prepares the real-Copilot suite's profile COPY (never the source) for a
// normal-mode run (G3), where no test runner auto-confirms anything:
// - the chat panel's model: the sign-in window may have left it on Auto,
//   which routes to whichever model Copilot picks. A plain key in the
//   profile's global state (User/globalStorage/state.vscdb, default-profile
//   scope). Only the chat's first start reads it: VS Code 1.146 can start a
//   new chat on another model (R5), so every chat also selects the model with
//   the open command and checks the picker before sending (copilot-chat.ts);
// - the test-only agent the specs chat in (copilot-e2e-settings.mts), a file
//   in the profile's prompts folder.
// Nothing here reads the sign-in. No auto-approve opt-in is seeded (D6).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const PANEL_MODEL_KEY = "chat.currentLanguageModel.panel";

// `model` is the suite's model id (COPILOT_E2E_MODEL), also the Copilot picker's id.
export function copilotStateSeeds(model: string): Record<string, string> {
  return { [PANEL_MODEL_KEY]: `copilot/${model}` };
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

export function seedProfileAgent(userDataDir: string, agent: { name: string; content: string }): void {
  const dir = path.join(userDataDir, "User", "prompts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, agent.name), agent.content);
}
