// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Read-only measurement of the AI Credits that classic Copilot Chat subagent
// logs hold and `main.jsonl` totals miss (step 10.19, SA0; re-run by SA18).
//
//   npx tsx packages/server/scripts/measure-subagent-spend.mts [--json] [--user-data <dir>]...
//
// Scans `<user-data>/User/{workspaceStorage/*/GitHub.copilot-chat,globalStorage/github.copilot-chat}/debug-logs`
// for ~/.config/Code and ~/.config/Code - Insiders unless --user-data is given.
// Prints counts, sums, session ids, model names and dates only: never prompts,
// responses, tool output, titles, file contents or paths.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  aggregateSessions,
  classifySubagentFileName,
  type SessionSummary,
  summarizeSession,
} from "./subagent-spend-lib.mjs";

type Folder = "workspaceStorage" | "globalStorage";
interface Row {
  edition: string;
  folder: Folder;
  sessionId: string;
  summary: SessionSummary;
}

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const userDirs: string[] = [];
for (let i = 0; i < args.length; i++)
  if (args[i] === "--user-data" && args[i + 1]) userDirs.push(args[++i]!);
if (userDirs.length === 0)
  userDirs.push(
    path.join(homedir(), ".config", "Code"),
    path.join(homedir(), ".config", "Code - Insiders"),
  );

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

const rows: Row[] = [];
const rootsByKind: Record<string, number> = {};
let otherJsonlNames = 0;
for (const userData of userDirs) {
  const edition = path.basename(userData);
  for (const { folder, dir } of debugLogRoots(userData)) {
    rootsByKind[`${edition}/${folder}`] =
      (rootsByKind[`${edition}/${folder}`] ?? 0) + 1;
    for (const sessionId of safeList(dir)) {
      const sessionDir = path.join(dir, sessionId);
      if (!isDir(sessionDir)) continue;
      const mainPath = path.join(sessionDir, "main.jsonl");
      if (!existsSync(mainPath)) continue;
      const files: { name: string; text: string }[] = [];
      for (const name of safeList(sessionDir)) {
        if (name !== "main.jsonl" && classifySubagentFileName(name) === null)
          otherJsonlNames += name.endsWith(".jsonl") ? 1 : 0;
        if (classifySubagentFileName(name) === null) continue;
        files.push({
          name,
          text: readFileSync(path.join(sessionDir, name), "utf8"),
        });
      }
      rows.push({
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

const withFiles = rows
  .filter((r) => r.summary.files > 0)
  .sort((a, b) =>
    (a.summary.startDate ?? "").localeCompare(b.summary.startDate ?? ""),
  );
const totals = aggregateSessions(rows.map((r) => r.summary));
const dates = rows
  .flatMap((r) => (r.summary.startDate ? [r.summary.startDate] : []))
  .sort();
const byFolder: Record<
  string,
  { sessions: number; withSubagentFiles: number; missingAiCredits: number }
> = {};
for (const r of rows) {
  const k = `${r.edition}/${r.folder}`;
  const e = (byFolder[k] ??= {
    sessions: 0,
    withSubagentFiles: 0,
    missingAiCredits: 0,
  });
  e.sessions += 1;
  if (r.summary.files > 0) e.withSubagentFiles += 1;
  e.missingAiCredits += r.summary.missingAiCredits;
}
const report = {
  debugLogRootsFound: rootsByKind,
  otherJsonlFilesInSessionFolders: otherJsonlNames,
  dateRange: { first: dates[0] ?? null, last: dates.at(-1) ?? null },
  byFolder,
  totals,
  sessionsWithSubagentFiles: withFiles.map((r) => ({
    edition: r.edition,
    folder: r.folder,
    sessionId: r.sessionId,
    startDate: r.summary.startDate,
    mainAiCredits: r.summary.mainAiCredits,
    missingAiCredits: r.summary.missingAiCredits,
    files: r.summary.files,
    runsByKind: r.summary.runsByKind,
    danglingRefs: r.summary.danglingRefs,
    orphanFiles: r.summary.orphanFiles,
    models: r.summary.models,
  })),
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const f = (n: number) => n.toFixed(2);
  console.log("Debug-log roots found:", JSON.stringify(rootsByKind));
  console.log("Per folder:", JSON.stringify(byFolder));
  console.log(
    `Sessions with main.jsonl: ${totals.sessions}; with subagent files: ${totals.sessionsWithSubagentFiles}; max files/session: ${totals.maxFilesPerSession}`,
  );
  console.log(`Dates: ${report.dateRange.first} .. ${report.dateRange.last}`);
  console.log(
    `Subagent files: ${totals.files} (runSubagent ${totals.runsByKind.runSubagent}, searchSubagent ${totals.runsByKind.searchSubagent})`,
  );
  console.log(
    `Requests: runSubagent ${totals.requestsByKind.runSubagent}, searchSubagent ${totals.requestsByKind.searchSubagent}; without numeric credits ${totals.requestsWithoutCredits}`,
  );
  console.log(
    `AI Credits in subagent files (missing from main totals): ${f(totals.missingAiCredits)} (runSubagent ${f(totals.aiCreditsByKind.runSubagent)}, searchSubagent ${f(totals.aiCreditsByKind.searchSubagent)})`,
  );
  console.log(
    `AI Credits counted in all main.jsonl: ${f(totals.mainAiCredits)}`,
  );
  console.log(
    `Dangling refs: ${totals.danglingRefs}; orphan files: ${totals.orphanFiles}; refs inside subagent files: ${totals.nestedRefs}; subagent-named requests in main.jsonl: ${totals.mainSubagentNamedRequests}; other .jsonl names in session folders: ${otherJsonlNames}`,
  );
  console.log("Subagent request models:", JSON.stringify(totals.models));
  console.log("\nPer session (counted in main, missing in subagent files):");
  for (const r of withFiles) {
    const s = r.summary;
    console.log(
      `${r.edition}/${r.folder} ${r.sessionId} ${s.startDate ?? "?"} counted=${f(s.mainAiCredits)} missing=${f(s.missingAiCredits)} files=${s.files} run=${s.runsByKind.runSubagent} search=${s.runsByKind.searchSubagent} dangling=${s.danglingRefs} orphan=${s.orphanFiles}`,
    );
  }
}
