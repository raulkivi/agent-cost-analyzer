import type { CaptureRule } from "@agent-cost-analyzer/domain";
import { branchPatternMatches } from "./project-matcher.js";

// Phase 15 step 15.4 (docs/plans/cost-by-repository-and-project.md §4.1,
// §7): mitmproxy captures record no folder, so a projects-file capture rule
// assigns a capture file to a repository by a glob over its path. The glob
// is user content, so it is matched by the same dynamic-programming matcher
// as branch patterns (`*` within one folder, `**` across folders, `?` one
// character, everything else literal), never by a regex built from it.

function forwardSlashes(value: string): string {
  return value.split("\\").join("/");
}

// A leading `~` (alone or before a slash) is the user's home folder.
function expandHome(glob: string, homeDir: string): string {
  if (glob === "~" || glob.startsWith("~/")) {
    const home = forwardSlashes(homeDir);
    return `${home.endsWith("/") ? home.slice(0, -1) : home}${glob.slice(1)}`;
  }
  return glob;
}

export function captureGlobMatches(glob: string, filePath: string, homeDir: string): boolean {
  return branchPatternMatches(expandHome(forwardSlashes(glob), homeDir), forwardSlashes(filePath));
}

// The first rule (file order) whose glob matches, or null.
export function matchCaptureRule(rules: readonly CaptureRule[], filePath: string, homeDir: string): CaptureRule | null {
  return rules.find((rule) => captureGlobMatches(rule.glob, filePath, homeDir)) ?? null;
}
