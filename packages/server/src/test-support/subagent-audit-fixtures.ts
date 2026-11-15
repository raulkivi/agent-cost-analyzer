// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { chmodSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const subagentAuditFixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures",
);
export const classicAuditDir = path.join(
  subagentAuditFixturesDir,
  "jsonl",
  "subagent-audit",
);
export const agentHostAuditDir = path.join(
  subagentAuditFixturesDir,
  "agent-host",
  "subagent-audit",
  "session-state",
);

export interface ScratchCase {
  dir: string;
  cleanup: () => void;
}

// Copies a classic case to a temp folder and strips all permissions from one
// file, so an unreadable child log is made at test time (git can't store the
// mode). Callers skip the case when running as root or on Windows, where
// chmod 000 doesn't block reads.
export function copyCaseWithUnreadableFile(
  caseName: string,
  file: string,
): ScratchCase {
  const dir = mkdtempSync(path.join(tmpdir(), "subagent-audit-"));
  cpSync(path.join(classicAuditDir, caseName), dir, { recursive: true });
  chmodSync(path.join(dir, file), 0o000);
  return {
    dir,
    cleanup: () => {
      chmodSync(path.join(dir, file), 0o600);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function canBlockReads(): boolean {
  return process.platform !== "win32" && process.getuid?.() !== 0;
}
