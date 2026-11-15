// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { cpSync, mkdirSync, readdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Test-time builders for the subagent fixture cases that must not be
// committed (a symlink, a folder over the file cap). The committed cases live
// in fixtures/claude-code/subagents/ (see its README.md).
const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/claude-code/subagents",
);
const PROJECT = "-home-dev-project";
const CAP_SESSION_ID = "99999999-aaaa-4bbb-8ccc-000000000009";

export interface SubagentFixtureCopy {
  /** The temp "projects dir": pass it as `projectsDirPath`. */
  projectsDir: string;
  projectDir: string;
  sessionFile: string;
  sessionDir: string;
  subagentsDir: string;
}

function layout(projectsDir: string, sessionId: string): SubagentFixtureCopy {
  const projectDir = path.join(projectsDir, PROJECT);
  const sessionDir = path.join(projectDir, sessionId);
  return {
    projectsDir,
    projectDir,
    sessionFile: path.join(projectDir, `${sessionId}.jsonl`),
    sessionDir,
    subagentsDir: path.join(sessionDir, "subagents"),
  };
}

/** Copy one committed case into `root` so a test can change it. */
export function copySubagentFixtureCase(caseName: string, root: string): SubagentFixtureCopy {
  const source = path.join(fixturesDir, caseName, PROJECT);
  cpSync(source, path.join(root, PROJECT), { recursive: true });
  const sessionFile = readdirSync(path.join(root, PROJECT)).find((name) => name.endsWith(".jsonl"));
  if (sessionFile === undefined) throw new Error(`fixture case ${caseName} has no session file`);
  return layout(root, sessionFile.replace(/\.jsonl$/, ""));
}

/**
 * Move the first transcript of a copied case to `<root>/outside/` and put a
 * symlink with the valid name in its place. Returns the link's path.
 */
export function makeSymlinkedSubagentTranscript(copy: SubagentFixtureCopy, root: string): string {
  const name = readdirSync(copy.subagentsDir).find((entry) => /^agent-[A-Za-z0-9]+\.jsonl$/.test(entry));
  if (name === undefined) throw new Error("no transcript to replace");
  const outside = path.join(root, "outside");
  mkdirSync(outside, { recursive: true });
  const target = path.join(outside, name);
  const link = path.join(copy.subagentsDir, name);
  renameSync(link, target);
  symlinkSync(target, link);
  return link;
}

/** A session with `count` tiny transcripts and metas, for the file-cap tests. */
export function makeSubagentCapFolder(root: string, count: number): SubagentFixtureCopy {
  const copy = layout(root, CAP_SESSION_ID);
  mkdirSync(copy.subagentsDir, { recursive: true });
  const prompt = {
    parentUuid: null,
    type: "user",
    message: { role: "user", content: "Made-up prompt." },
    uuid: "cap-u1",
    timestamp: "2026-10-01T09:00:00.000Z",
    sessionId: CAP_SESSION_ID,
  };
  writeFileSync(copy.sessionFile, `${JSON.stringify(prompt)}\n`);
  for (let i = 0; i < count; i += 1) {
    const id = `a${i.toString(16).padStart(16, "0")}`;
    const line = { ...prompt, uuid: `cap-r${i}`, isSidechain: true, agentId: id };
    writeFileSync(path.join(copy.subagentsDir, `agent-${id}.jsonl`), `${JSON.stringify(line)}\n`);
    writeFileSync(path.join(copy.subagentsDir, `agent-${id}.meta.json`), `${JSON.stringify({ agentType: "general-purpose" })}\n`);
  }
  return copy;
}
