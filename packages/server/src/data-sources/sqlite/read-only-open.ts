// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { DatabaseSync } from "node:sqlite";

// The other apps own these stores and may be writing while we read. Some use
// the rollback journal (Copilot's per-session session.db), where a commit
// blocks readers; node:sqlite defaults to no wait, so a read would fail with
// "database is locked". Waiting a few seconds rides out a commit.
export const READ_ONLY_BUSY_TIMEOUT_MS = 5000;

// The one place the product opens another app's SQLite store. Never writes it
// (architecture constraint: read-only), so no journal-mode change or PRAGMA
// that writes belongs here.
export function openReadOnlySqlite(dbPath: string): DatabaseSync {
  return new DatabaseSync(dbPath, { readOnly: true, timeout: READ_ONLY_BUSY_TIMEOUT_MS });
}
