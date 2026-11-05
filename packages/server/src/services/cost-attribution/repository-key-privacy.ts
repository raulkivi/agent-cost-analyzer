// Phase 15 step 15.4 (docs/plans/cost-by-repository-and-project.md
// §10.1.5): MCP output enters a (usually hosted) client model's context, so
// repositories are named by their normalised key and never by a local
// folder path. `local:` and `path:` keys carry one, so they are given as
// the folder's name only, unless a tool's caller asks for paths.

const LOCAL_PREFIXES = ["local:", "path:"] as const;

function lastSegment(folder: string): string {
  const parts = folder.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? "";
}

export function isLocalKey(key: string): boolean {
  return LOCAL_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function redactRepositoryKey(key: string): string {
  const prefix = LOCAL_PREFIXES.find((candidate) => key.startsWith(candidate));
  return prefix ? `${prefix}${lastSegment(key.slice(prefix.length))}` : key;
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
