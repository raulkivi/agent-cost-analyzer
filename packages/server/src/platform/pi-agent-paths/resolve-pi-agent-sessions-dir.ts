import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

interface ResolvePiAgentSessionsDirOptions {
  homeDir?: string;
}

// pi has one fixed sessions root (unlike VS Code's Stable/Insiders variants) —
// https://pi.dev/docs/latest/session-format.
export function resolvePiAgentSessionsDir(
  options: ResolvePiAgentSessionsDirOptions = {},
): string | null {
  const homeDir = options.homeDir ?? homedir();
  const sessionsDir = path.join(homeDir, ".pi", "agent", "sessions");
  return existsSync(sessionsDir) ? sessionsDir : null;
}

// Real sessions live one level down, under a
// `--<cwd-with-slashes-as-dashes>--` directory per project — but this walks
// any depth so a flat directory of fixtures (as used in tests) is also
// found without a special case. Sorted so callers get a stable order.
export function listPiAgentSessionFiles(sessionsDir: string): string[] {
  if (!existsSync(sessionsDir)) {
    return [];
  }

  const files: string[] = [];
  for (const name of readdirSync(sessionsDir)) {
    const candidate = path.join(sessionsDir, name);
    if (statSync(candidate).isDirectory()) {
      files.push(...listPiAgentSessionFiles(candidate));
    } else if (name.toLowerCase().endsWith(".jsonl")) {
      files.push(candidate);
    }
  }
  return files.sort();
}
