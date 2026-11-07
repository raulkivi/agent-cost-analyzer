// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Phase 15 step 15.4 (docs/plans/cost-by-repository-and-project.md
// §10.1.5): MCP output enters a (usually hosted) client model's context, so
// repositories are named by their normalised key and never by a local
// folder path. `local:` and `path:` keys carry one, so they are given as
// the folder's name only, unless a tool's caller asks for paths. The
// redaction itself lives in the domain (step 15.9), so the web app names a
// local repository the same way.
import { isLocalRepositoryKey, redactRepositoryKey } from "@agent-cost-analyzer/domain";

export { redactRepositoryKey };

export function isLocalKey(key: string): boolean {
  return isLocalRepositoryKey(key);
}

// A filter names a repository by its full key or by the redacted key a
// tool returned; remote keys are lower-case, so case is ignored.
export function keyMatches(key: string, filter: string): boolean {
  const wanted = filter.trim().toLowerCase();
  return key.toLowerCase() === wanted || redactRepositoryKey(key).toLowerCase() === wanted;
}

// Every local key in `keys` that appears in the text, redacted. Longest
// first, so a key that starts with another is replaced whole.
export function redactKeysInText(text: string, keys: Iterable<string>): string {
  const locals = [...new Set([...keys].filter(isLocalKey))].sort((a, b) => b.length - a.length);
  return locals.reduce((result, key) => result.split(key).join(redactRepositoryKey(key)), text);
}
