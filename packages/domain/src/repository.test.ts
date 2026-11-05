import { describe, expect, it } from "vitest";
import { repositoryAttributionSchema, repositoryRefSchema } from "./repository.js";

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
