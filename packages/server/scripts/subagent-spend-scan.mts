// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Folder scan of the classic-subagent spend measurement (step 10.19, SA0):
// per-session rows over VS Code user-data dirs. Shared by the CLI and the SA18
// real-data suite. Read-only; keeps numbers only, never paths in its result.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  classifySubagentFileName,
  type SessionSummary,
  summarizeSession,
} from "./subagent-spend-lib.mjs";

export type Folder = "workspaceStorage" | "globalStorage";

export interface MeasuredSession {
  edition: string;
  folder: Folder;
  sessionId: string;
  summary: SessionSummary;
}

export interface Measurement {
  rows: MeasuredSession[];
  rootsByKind: Record<string, number>;
  otherJsonlFiles: number;
}

const safeList = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};
const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

function debugLogRoots(userData: string): { folder: Folder; dir: string }[] {
  const user = path.join(userData, "User");
  const roots: { folder: Folder; dir: string }[] = [];
  for (const hash of safeList(path.join(user, "workspaceStorage")))
    roots.push({
      folder: "workspaceStorage",
      dir: path.join(
        user,
        "workspaceStorage",
        hash,
        "GitHub.copilot-chat",
        "debug-logs",
      ),
    });
  roots.push({
    folder: "globalStorage",
    dir: path.join(user, "globalStorage", "github.copilot-chat", "debug-logs"),
  });
  return roots.filter((r) => isDir(r.dir));
}

export function measureUserDataDirs(userDirs: string[]): Measurement {
  const result: Measurement = { rows: [], rootsByKind: {}, otherJsonlFiles: 0 };
  for (const userData of userDirs) {
    const edition = path.basename(userData);
    for (const { folder, dir } of debugLogRoots(userData)) {
      const kind = `${edition}/${folder}`;
      result.rootsByKind[kind] = (result.rootsByKind[kind] ?? 0) + 1;
      for (const sessionId of safeList(dir)) {
        const sessionDir = path.join(dir, sessionId);
        if (!isDir(sessionDir)) continue;
        const mainPath = path.join(sessionDir, "main.jsonl");
        if (!existsSync(mainPath)) continue;
        const files: { name: string; text: string }[] = [];
        for (const name of safeList(sessionDir)) {
          if (classifySubagentFileName(name) === null) {
            if (name !== "main.jsonl" && name.endsWith(".jsonl"))
              result.otherJsonlFiles += 1;
            continue;
          }
          files.push({
            name,
            text: readFileSync(path.join(sessionDir, name), "utf8"),
          });
        }
        result.rows.push({
          edition,
          folder,
          sessionId,
          summary: summarizeSession({
            mainText: readFileSync(mainPath, "utf8"),
            files,
          }),
        });
      }
    }
  }
  return result;
}
