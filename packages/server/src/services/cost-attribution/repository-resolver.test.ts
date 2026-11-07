// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../../test-support/in-memory-file-system.js";
import {
  FOLDER_NOT_IN_REPOSITORY_NOTE,
  MAX_GIT_FILE_BYTES,
  RepositoryResolver,
} from "./repository-resolver.js";

const remote = (url: string, name = "origin") => `[core]\n\tbare = false\n[remote "${name}"]\n\turl = ${url}\n`;
const known = (cwd: string, extra: { repositoryHint?: string; branch?: string } = {}) => ({ known: true as const, cwd, ...extra });

describe("RepositoryResolver", () => {
  it("keys a plain repository by its origin remote, with the root and the path inside it", () => {
    const fs = new InMemoryFileSystem({ "/home/dev/app/.git/config": remote("git@github.com:Org/App.git") }, ["/home/dev/app/packages/server"]);

    expect(new RepositoryResolver(fs).resolve(known("/home/dev/app/packages/server", { branch: "main" }))).toEqual({
      attributed: true,
      repository: {
        key: "github.com/org/app",
        source: "git-remote",
        rootPath: "/home/dev/app",
        pathInRepo: "packages/server",
        branch: "main",
      },
    });
  });

  it("gives the root itself an empty path inside the repository", () => {
    const fs = new InMemoryFileSystem({ "/home/dev/app/.git/config": remote("https://github.com/org/app") });

    const result = new RepositoryResolver(fs).resolve(known("/home/dev/app"));

    expect(result).toMatchObject({ attributed: true, repository: { key: "github.com/org/app", pathInRepo: "" } });
  });

  it("uses the first remote when there is no origin", () => {
    const fs = new InMemoryFileSystem({ "/r/.git/config": remote("https://gitlab.com/group/sub/app.git", "upstream") });

    expect(new RepositoryResolver(fs).resolve(known("/r"))).toMatchObject({ repository: { key: "gitlab.com/group/sub/app", source: "git-remote" } });
  });

  it("strips credentials from a remote written with a token", () => {
    const fs = new InMemoryFileSystem({ "/r/.git/config": remote("https://me:ghp_SECRET123@github.com/org/app.git") });

    const result = new RepositoryResolver(fs).resolve(known("/r"));

    expect(result).toMatchObject({ repository: { key: "github.com/org/app" } });
    expect(JSON.stringify(result)).not.toContain("SECRET123");
  });

  it("keys a repository with no remote by its root, as git-local", () => {
    const fs = new InMemoryFileSystem({ "/home/dev/scratch/.git/config": "[core]\n\tbare = false\n" }, ["/home/dev/scratch/src"]);

    expect(new RepositoryResolver(fs).resolve(known("/home/dev/scratch/src"))).toEqual({
      attributed: true,
      repository: { key: "local:/home/dev/scratch", source: "git-local", rootPath: "/home/dev/scratch", pathInRepo: "src" },
    });
  });

  it("treats a local file remote as no remote", () => {
    const fs = new InMemoryFileSystem({ "/r/.git/config": remote("/srv/git/app.git") });

    expect(new RepositoryResolver(fs).resolve(known("/r"))).toMatchObject({ repository: { key: "local:/r", source: "git-local" } });
  });

  it("follows a worktree's .git file and commondir to the main repository's remote", () => {
    const fs = new InMemoryFileSystem({
      "/home/dev/app/.git/config": remote("git@github.com:org/app.git"),
      "/home/dev/app/.git/worktrees/feature/commondir": "../..\n",
      "/home/dev/app/.git/worktrees/feature/HEAD": "ref: refs/heads/feature\n",
      "/home/dev/app-feature/.git": "gitdir: /home/dev/app/.git/worktrees/feature\n",
    }, ["/home/dev/app-feature/lib"]);

    expect(new RepositoryResolver(fs).resolve(known("/home/dev/app-feature/lib"))).toEqual({
      attributed: true,
      repository: { key: "github.com/org/app", source: "git-remote", rootPath: "/home/dev/app-feature", pathInRepo: "lib" },
    });
  });

  it("keys a remote-less worktree by the main repository's root, so it merges with the main checkout", () => {
    const fs = new InMemoryFileSystem({
      "/home/dev/app/.git/config": "[core]\n",
      "/home/dev/app/.git/worktrees/wt/commondir": "../..",
      "/home/dev/wt/.git": "gitdir: ../app/.git/worktrees/wt",
    });

    expect(new RepositoryResolver(fs).resolve(known("/home/dev/wt"))).toMatchObject({ repository: { key: "local:/home/dev/app", source: "git-local" } });
  });

  it("reads a submodule's own remote through its relative gitdir", () => {
    const fs = new InMemoryFileSystem({
      "/home/dev/app/.git/config": remote("git@github.com:org/app.git"),
      "/home/dev/app/.git/modules/vendor/lib/config": remote("https://github.com/other/lib.git"),
      "/home/dev/app/vendor/lib/.git": "gitdir: ../../.git/modules/vendor/lib\n",
    });

    expect(new RepositoryResolver(fs).resolve(known("/home/dev/app/vendor/lib"))).toMatchObject({
      repository: { key: "github.com/other/lib", rootPath: "/home/dev/app/vendor/lib", pathInRepo: "" },
    });
  });

  it("picks the innermost repository for a nested one", () => {
    const fs = new InMemoryFileSystem({
      "/home/dev/outer/.git/config": remote("https://github.com/org/outer"),
      "/home/dev/outer/inner/.git/config": remote("https://github.com/org/inner"),
    }, ["/home/dev/outer/inner/src"]);

    expect(new RepositoryResolver(fs).resolve(known("/home/dev/outer/inner/src"))).toMatchObject({ repository: { key: "github.com/org/inner", pathInRepo: "src" } });
    expect(new RepositoryResolver(fs).resolve(known("/home/dev/outer"))).toMatchObject({ repository: { key: "github.com/org/outer" } });
  });

  it("keys an existing folder outside any repository by its path, as folder-path", () => {
    const fs = new InMemoryFileSystem({}, ["/tmp/notes"]);

    expect(new RepositoryResolver(fs).resolve(known("/tmp/notes"))).toEqual({
      attributed: true,
      repository: { key: "path:/tmp/notes", source: "folder-path" },
    });
    expect(FOLDER_NOT_IN_REPOSITORY_NOTE).toMatch(/alias/);
  });

  it("uses the provider's recorded repository when the folder no longer exists", () => {
    const fs = new InMemoryFileSystem({});
    const resolver = new RepositoryResolver(fs);

    expect(resolver.resolve(known("/gone/app", { repositoryHint: "https://github.com/Org/App.git", branch: "main" }))).toEqual({
      attributed: true,
      repository: { key: "github.com/org/app", source: "recorded-repository", branch: "main" },
    });
    // host/path without a scheme keys like the remote it names.
    expect(resolver.resolve(known("/gone/api", { repositoryHint: "github.com/Org/Api" }))).toMatchObject({
      repository: { key: "github.com/org/api", source: "recorded-repository" },
    });
    // A bare name has no host, so it keys as a name the user can alias.
    expect(resolver.resolve(known("/gone/web", { repositoryHint: "Org/Web" }))).toEqual({
      attributed: true,
      repository: { key: "repository:org/web", source: "recorded-repository" },
    });
  });

  it("ignores a recorded repository that is neither a remote nor a plain name, so nothing odd (or secret) becomes a key", () => {
    const resolver = new RepositoryResolver(new InMemoryFileSystem({}));

    for (const hint of ["https://tok_123456789@", "user:pass@host", "a b c", "../escape"]) {
      expect(resolver.resolve(known(`/gone/${hint.length}`, { repositoryHint: hint }))).toEqual({
        attributed: true,
        repository: { key: `path:/gone/${hint.length}`, source: "folder-path" },
      });
    }
  });

  it("keys a missing folder with no recorded repository by its path", () => {
    expect(new RepositoryResolver(new InMemoryFileSystem({})).resolve(known("/gone/app"))).toEqual({
      attributed: true,
      repository: { key: "path:/gone/app", source: "folder-path" },
    });
  });

  it("passes an unknown workspace through as Unattributed with its reason", () => {
    const result = new RepositoryResolver(new InMemoryFileSystem({})).resolve({ known: false, reason: "mitmproxy captures record no working folder" });

    expect(result).toEqual({ attributed: false, reason: "mitmproxy captures record no working folder" });
  });

  it("keys by the root when the config is too large to read", () => {
    const fs = new InMemoryFileSystem({ "/r/.git/config": remote("https://github.com/org/app") + "#".repeat(MAX_GIT_FILE_BYTES) });

    expect(new RepositoryResolver(fs).resolve(known("/r"))).toMatchObject({ repository: { key: "local:/r", source: "git-local" } });
  });

  it("reads a gitdir line with surrounding spaces, and stays fast on adversarial whitespace", () => {
    const padded = new InMemoryFileSystem({
      "/home/dev/app/.git/config": remote("https://github.com/org/app"),
      "/home/dev/app/.git/worktrees/w/commondir": "../..",
      "/home/dev/w/.git": "gitdir:   /home/dev/app/.git/worktrees/w   \n",
    });
    expect(new RepositoryResolver(padded).resolve(known("/home/dev/w"))).toMatchObject({ repository: { key: "github.com/org/app" } });

    const hostile = new InMemoryFileSystem({ "/r/.git": `gitdir:${" ".repeat(200_000)}x${" ".repeat(50_000)}y` });
    const started = performance.now();
    new RepositoryResolver(hostile).resolve(known("/r"));
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("treats a .git file without a gitdir line as no repository", () => {
    const fs = new InMemoryFileSystem({ "/r/.git": "garbage\n" });

    expect(new RepositoryResolver(fs).resolve(known("/r"))).toMatchObject({ repository: { key: "path:/r", source: "folder-path" } });
  });

  it("reads each folder once, and still applies each workspace's own branch", () => {
    const fs = new InMemoryFileSystem({ "/r/.git/config": remote("https://github.com/org/app") }, ["/r/src"]);
    const resolver = new RepositoryResolver(fs);

    const first = resolver.resolve(known("/r/src", { branch: "main" }));
    const reads = fs.reads;
    const lookups = fs.lookups;
    const second = resolver.resolve(known("/r/src", { branch: "feature/x" }));

    expect(fs.reads).toBe(reads);
    expect(fs.lookups).toBe(lookups);
    expect(first).toMatchObject({ repository: { branch: "main" } });
    expect(second).toMatchObject({ repository: { key: "github.com/org/app", branch: "feature/x" } });
  });
});
