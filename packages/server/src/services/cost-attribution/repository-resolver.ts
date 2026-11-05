import path from "node:path";
import type { RepositoryAttribution, RepositoryRef, SessionWorkspace } from "@agent-cost-analyzer/domain";
import { parseGitConfigRemotes, preferredRemoteUrl } from "./git-config-remotes.js";
import type { ReadOnlyFileSystem } from "./read-only-file-system.js";
import { normalizeRemoteUrl } from "./remote-url-normalizer.js";

// Phase 15 step 15.2 (docs/plans/cost-by-repository-and-project.md §4.2):
// a session's recorded folder → the repository it belongs to, by reading
// files only (no `git` process, no network, constraint 1).
//
// 1. Walk up to the nearest `.git`. A `.git` file (worktree, submodule) is
//    followed to its `gitdir`, and a worktree's `commondir` to the main
//    repository's git directory.
// 2. Its `config`'s origin remote (else the first), normalised, is the key.
// 3. No usable remote: `local:<main repository root>`.
// 4. The folder no longer exists: the provider's recorded repository
//    (VS Code's store), else `path:<folder>`. An existing folder outside any
//    repository is `path:<folder>` too.
// 5. An unknown workspace stays Unattributed with its reason.
//
// The result for a folder is cached for the resolver's life, like the
// providers' own caches; only the branch comes from each workspace.

// Git config and pointer files are tiny; anything larger is not read.
export const MAX_GIT_FILE_BYTES = 256 * 1024;

export const FOLDER_NOT_IN_REPOSITORY_NOTE =
  "A path: key is a folder outside any git repository (or one that no longer exists); merge it into a repository with an alias in the projects file.";

type FolderRef = Omit<RepositoryRef, "branch">;

interface GitLocation {
  workTree: string;
  gitDir: string;
}

function relativeInside(root: string, folder: string): string {
  return path.relative(root, folder).split(path.sep).join("/");
}

export class RepositoryResolver {
  private readonly cache = new Map<string, FolderRef>();

  constructor(private readonly fs: ReadOnlyFileSystem) {}

  resolve(workspace: SessionWorkspace): RepositoryAttribution {
    if (!workspace.known) {
      return { attributed: false, reason: workspace.reason };
    }
    const folder = path.resolve(workspace.cwd);
    const cacheKey = `${folder}\u0000${workspace.repositoryHint ?? ""}`;
    let ref = this.cache.get(cacheKey);
    if (!ref) {
      ref = this.resolveFolder(folder, workspace.repositoryHint);
      this.cache.set(cacheKey, ref);
    }
    return { attributed: true, repository: { ...ref, ...(workspace.branch ? { branch: workspace.branch } : {}) } };
  }

  private resolveFolder(folder: string, repositoryHint: string | undefined): FolderRef {
    if (this.fs.kindOf(folder) !== "directory") {
      return (repositoryHint ? recordedRepository(repositoryHint) : null) ?? { key: `path:${folder}`, source: "folder-path" };
    }
    const location = this.findGit(folder);
    if (!location) {
      return { key: `path:${folder}`, source: "folder-path" };
    }
    const commonDir = this.commonDir(location.gitDir);
    const url = this.remoteUrl(commonDir);
    const key = url ? normalizeRemoteUrl(url) : null;
    const base = { rootPath: location.workTree, pathInRepo: relativeInside(location.workTree, folder) };
    if (key) {
      return { key, source: "git-remote", ...base };
    }
    // A worktree's common dir is the main checkout's `.git`; its parent is
    // the root that the main checkout keys by, so the two merge.
    const mainRoot = path.basename(commonDir) === ".git" ? path.dirname(commonDir) : location.workTree;
    return { key: `local:${mainRoot}`, source: "git-local", ...base };
  }

  private findGit(folder: string): GitLocation | null {
    let dir = folder;
    for (;;) {
      const dotGit = path.join(dir, ".git");
      const kind = this.fs.kindOf(dotGit);
      if (kind === "directory") {
        return { workTree: dir, gitDir: dotGit };
      }
      if (kind === "file") {
        const gitDir = this.followGitFile(dotGit);
        return gitDir ? { workTree: dir, gitDir } : null;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
  }

  // `.git` as a file holds `gitdir: <path>`, relative to its own folder.
  // Read line by line with trim, not a regex: /^gitdir:\s*(.+?)\s*$/ is
  // quadratic on long whitespace.
  private followGitFile(dotGitFile: string): string | null {
    const text = this.fs.readText(dotGitFile, MAX_GIT_FILE_BYTES);
    for (const line of text?.split("\n") ?? []) {
      const trimmed = line.trim();
      if (trimmed.startsWith("gitdir:")) {
        const target = trimmed.slice("gitdir:".length).trim();
        return target ? path.resolve(path.dirname(dotGitFile), target) : null;
      }
    }
    return null;
  }

  private commonDir(gitDir: string): string {
    const pointer = this.fs.readText(path.join(gitDir, "commondir"), MAX_GIT_FILE_BYTES)?.trim();
    return pointer ? path.resolve(gitDir, pointer) : gitDir;
  }

  private remoteUrl(commonDir: string): string | null {
    const config = this.fs.readText(path.join(commonDir, "config"), MAX_GIT_FILE_BYTES);
    return config === null ? null : preferredRemoteUrl(parseGitConfigRemotes(config));
  }
}

// A recorded name like `org/app`: letters, digits, `.`, `_`, `-`, in
// slash-separated parts. Nothing else (no `@`, `:` or spaces) is kept, so a
// credential in an odd value can't become a key.
const PLAIN_NAME = /^[\w.-]+(\/[\w.-]+)+$/;
// `host.tld/path`, a remote written without a scheme.
const SCHEMELESS_REMOTE = /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i;

// The provider's own repository name: a full remote (with or without a
// scheme) normalises like one; a plain name keys as `repository:<name>`,
// which an alias can merge; anything else is not used (null).
function recordedRepository(hint: string): FolderRef | null {
  const value = hint.trim();
  const remoteKey = normalizeRemoteUrl(value) ?? (SCHEMELESS_REMOTE.test(value) ? normalizeRemoteUrl(`https://${value}`) : null);
  if (remoteKey) {
    return { key: remoteKey, source: "recorded-repository" };
  }
  if (PLAIN_NAME.test(value) && !value.split("/").some((part) => part === "." || part === "..")) {
    return { key: `repository:${value.toLowerCase()}`, source: "recorded-repository" };
  }
  return null;
}
