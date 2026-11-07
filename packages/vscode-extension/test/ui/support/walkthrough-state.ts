// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WALKTHROUGH_OFFERED_KEY } from "../../../src/onboarding/walkthrough-offer.js";

const EXTENSION_ID = "raulkivi.ai-credits-analyzer";

// Whether an earlier launch on this user-data dir already offered the Get
// Started walkthrough (the extension's globalState, in VS Code's
// state.vscdb), so a later launch opens no Welcome tab and needn't wait for one.
export function walkthroughAlreadyOffered(userDataDir: string): boolean {
  const dbPath = path.join(userDataDir, "User", "globalStorage", "state.vscdb");
  if (!existsSync(dbPath)) return false;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(EXTENSION_ID) as { value: string | Uint8Array } | undefined;
      if (!row) return false;
      const state = JSON.parse(typeof row.value === "string" ? row.value : Buffer.from(row.value).toString("utf-8")) as Record<string, unknown>;
      return state[WALKTHROUGH_OFFERED_KEY] === true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}
