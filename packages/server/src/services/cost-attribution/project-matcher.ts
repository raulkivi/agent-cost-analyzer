import { normalizeMemberPath, type Project, type ProjectMember, type ProjectsFile } from "@agent-cost-analyzer/domain";

// Phase 15 step 15.3 (docs/plans/cost-by-repository-and-project.md §7, D1):
// which one project a turn (or session) counts in. A member matches when
// its repository is the turn's (after aliases), its path (if any) contains
// the turn's folder, and one of its branch patterns (if any) matches the
// turn's branch. The most specific match wins: a deeper path first, then a
// branch scope over none; file order breaks what's left. Exact ties are
// rejected when the file is saved (validateProjectsFile).

export interface MatchTarget {
  key: string;
  // Relative to the repository root; unknown for recorded-name and path: keys.
  pathInRepo?: string;
  branch?: string;
}

export function resolveAlias(file: ProjectsFile, key: string): string {
  return file.aliases[key] ?? key;
}

type Token = { kind: "any" } | { kind: "segment" } | { kind: "one" } | { kind: "literal"; char: string };

const tokenCache = new Map<string, Token[]>();

function tokenize(pattern: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*" && pattern[i + 1] === "*") {
      // Runs of `**` mean the same as one.
      if (tokens.at(-1)?.kind !== "any") {
        tokens.push({ kind: "any" });
      }
      i += 1;
    } else if (ch === "*") {
      tokens.push({ kind: "segment" });
    } else if (ch === "?") {
      tokens.push({ kind: "one" });
    } else {
      tokens.push({ kind: "literal", char: ch });
    }
  }
  return tokens;
}

// `**` any characters, `*` any within one segment, `?` one character; the
// rest is literal. Matched by dynamic programming over (pattern, branch), so
// it takes at most pattern length × branch length steps whatever the
// pattern: a regex built from a user's `**` runs could backtrack
// exponentially.
export function branchPatternMatches(pattern: string, branch: string): boolean {
  let tokens = tokenCache.get(pattern);
  if (!tokens) {
    tokens = tokenize(pattern);
    tokenCache.set(pattern, tokens);
  }
  const n = branch.length;
  // previous[j]: the tokens so far match branch[0, j).
  let previous: boolean[] = new Array<boolean>(n + 1).fill(false);
  previous[0] = true;
  for (const token of tokens) {
    const next: boolean[] = new Array<boolean>(n + 1).fill(false);
    for (let j = 0; j <= n; j++) {
      const ch = j > 0 ? branch[j - 1] : undefined;
      switch (token.kind) {
        case "any":
          next[j] = previous[j]! || (j > 0 && next[j - 1]!);
          break;
        case "segment":
          next[j] = previous[j]! || (j > 0 && next[j - 1]! && ch !== "/");
          break;
        case "one":
          next[j] = j > 0 && previous[j - 1]! && ch !== "/";
          break;
        case "literal":
          next[j] = j > 0 && previous[j - 1]! && ch === token.char;
          break;
      }
    }
    previous = next;
  }
  return previous[n]!;
}

function pathMatches(memberPath: string, pathInRepo: string | undefined): boolean {
  if (memberPath === "") {
    return true;
  }
  if (pathInRepo === undefined) {
    return false;
  }
  return pathInRepo === memberPath || pathInRepo.startsWith(`${memberPath}/`);
}

function branchMatches(member: ProjectMember, branch: string | undefined): boolean {
  if (!member.branches) {
    return true;
  }
  return branch !== undefined && member.branches.some((pattern) => branchPatternMatches(pattern, branch));
}

function specificity(member: ProjectMember): [number, number] {
  const path = normalizeMemberPath(member.path);
  return [path === "" ? 0 : path.split("/").length, member.branches ? 1 : 0];
}

export function matchProject(file: ProjectsFile, target: MatchTarget): Project | null {
  const key = resolveAlias(file, target.key);
  let best: { project: Project; score: [number, number] } | null = null;
  for (const project of file.projects) {
    for (const member of project.members) {
      if (resolveAlias(file, member.repository) !== key) {
        continue;
      }
      if (!pathMatches(normalizeMemberPath(member.path), target.pathInRepo) || !branchMatches(member, target.branch)) {
        continue;
      }
      const score = specificity(member);
      if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) {
        best = { project, score };
      }
    }
  }
  return best?.project ?? null;
}

// Every project with a member in this repository, whatever its scope.
export function projectIdsForRepository(file: ProjectsFile, key: string): string[] {
  const resolved = resolveAlias(file, key);
  return file.projects
    .filter((project) => project.members.some((member) => resolveAlias(file, member.repository) === resolved))
    .map((project) => project.id);
}
