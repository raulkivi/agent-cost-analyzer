// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { repositoryAttributionSchema, repositoryListSchema, repositoryRefSchema } from "./repository.js";

describe("repositoryRefSchema", () => {
  it("accepts a repository resolved from its git remote, with its root, path inside and branch", () => {
    const sample = {
      key: "github.com/org/app",
      source: "git-remote",
      rootPath: "/home/dev/app",
      pathInRepo: "packages/server",
      branch: "main",
    };
    expect(repositoryRefSchema.parse(sample)).toEqual(sample);
  });

  it("accepts each source", () => {
    for (const [key, source] of [
      ["local:/home/dev/scratch", "git-local"],
      ["github.com/org/app", "recorded-repository"],
      ["path:/home/dev/gone", "folder-path"],
      ["github.com/org/app", "capture-rule"],
    ] as const) {
      expect(repositoryRefSchema.parse({ key, source })).toEqual({ key, source });
    }
  });

  it("accepts the repository root itself as an empty path inside it", () => {
    const sample = { key: "github.com/org/app", source: "git-remote", rootPath: "/home/dev/app", pathInRepo: "" };
    expect(repositoryRefSchema.parse(sample)).toEqual(sample);
  });

  it("rejects an empty key, an unknown source and an absolute or parent path inside the repository", () => {
    expect(repositoryRefSchema.safeParse({ key: "", source: "git-remote" }).success).toBe(false);
    expect(repositoryRefSchema.safeParse({ key: "a", source: "guess" }).success).toBe(false);
    expect(repositoryRefSchema.safeParse({ key: "a", source: "git-remote", pathInRepo: "/etc" }).success).toBe(false);
    expect(repositoryRefSchema.safeParse({ key: "a", source: "git-remote", pathInRepo: "../x" }).success).toBe(false);
  });
});

describe("repositoryAttributionSchema", () => {
  it("accepts an attributed session and an unattributed one with its reason", () => {
    const attributed = { attributed: true, repository: { key: "github.com/org/app", source: "git-remote" } };
    const unattributed = { attributed: false, reason: "mitmproxy captures record no working folder" };

    expect(repositoryAttributionSchema.parse(attributed)).toEqual(attributed);
    expect(repositoryAttributionSchema.parse(unattributed)).toEqual(unattributed);
  });

  it("rejects an unattributed session without a reason (constraint 6)", () => {
    expect(repositoryAttributionSchema.safeParse({ attributed: false, reason: "" }).success).toBe(false);
  });
});

describe("repositoryListSchema", () => {
  it("accepts repositories, Unattributed buckets and provider statuses", () => {
    const sample = {
      repositories: [
        {
          key: "github.com/org/app",
          source: "git-remote",
          rootPath: "/home/dev/app",
          sessionCount: 3,
          turnCount: 12,
          aiCredits: { value: 4.5, knownSessions: 2, sessions: 3 },
          providerIds: ["claude-code", "vscode"],
          firstUsedAt: "2026-10-01T09:00:00.000Z",
          lastUsedAt: "2026-11-05T09:00:00.000Z",
          projectIds: ["portal"],
        },
      ],
      unattributed: [
        {
          reason: "mitmproxy captures record no working folder",
          sessionCount: 2,
          turnCount: 5,
          aiCredits: { value: null, knownSessions: 0, sessions: 2 },
          providerIds: ["mitmproxy"],
        },
      ],
      providers: [
        { id: "claude-code", label: "Claude Code", available: true },
        { id: "pi-agent", label: "pi", available: false, unavailableReason: "No pi sessions directory is configured." },
      ],
    };

    expect(repositoryListSchema.parse(sample)).toEqual(sample);
  });

  it("rejects a negative session count", () => {
    const bad = {
      repositories: [
        {
          key: "k",
          source: "git-remote",
          sessionCount: -1,
          turnCount: 0,
          aiCredits: { value: null, knownSessions: 0, sessions: 0 },
          providerIds: [],
          projectIds: [],
        },
      ],
      unattributed: [],
      providers: [],
    };
    expect(repositoryListSchema.safeParse(bad).success).toBe(false);
  });

  it("keeps AI Credits unknown (null) when no session's figure is known, and its coverage within the sessions (step 15.4)", () => {
    const entry = (aiCredits: unknown) => ({
      repositories: [{ key: "k", source: "git-remote", sessionCount: 1, turnCount: 1, aiCredits, providerIds: [], projectIds: [] }],
      unattributed: [],
      providers: [],
    });
    expect(repositoryListSchema.safeParse(entry({ value: null, knownSessions: 0, sessions: 1 })).success).toBe(true);
    expect(repositoryListSchema.safeParse(entry({ value: 1, knownSessions: 2, sessions: 1 })).success).toBe(false);
    expect(repositoryListSchema.safeParse(entry({ value: 0, knownSessions: 0, sessions: 1 })).success).toBe(false);
  });
});

// Phase 15 step 15.9: shared by the server's outputs (§10.1.5) and the web
// app, which names a local repository by its folder.
describe("repository key privacy", () => {
  it("redacts local: and path: keys to the folder name and leaves remote keys alone", async () => {
    const { redactRepositoryKey, isLocalRepositoryKey, repositoryFolderLabel } = await import("./index.js");
    expect(redactRepositoryKey("local:/home/dev/scratch")).toBe("local:scratch");
    expect(redactRepositoryKey("path:C:\\work\\notes\\")).toBe("path:notes");
    expect(redactRepositoryKey("github.com/acme/portal-web")).toBe("github.com/acme/portal-web");
    expect(isLocalRepositoryKey("path:/x")).toBe(true);
    expect(isLocalRepositoryKey("github.com/acme/x")).toBe(false);
    expect(repositoryFolderLabel("local:/home/dev/scratch")).toBe("scratch");
    expect(repositoryFolderLabel("local:scratch")).toBe("scratch");
    expect(repositoryFolderLabel("github.com/acme/portal-web")).toBe("github.com/acme/portal-web");
  });
});
