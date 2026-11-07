// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { projectsFileSchema, type ProjectsFile } from "@agent-cost-analyzer/domain";
import { branchPatternMatches, matchProject, projectIdsForRepository, resolveAlias } from "./project-matcher.js";

// Phase 15 step 15.3 (plan §7, D1): a turn belongs to at most one project;
// the most specific matching member wins (a path beats the whole repository,
// a branch scope beats none), and file order breaks any remaining tie.
function file(raw: object): ProjectsFile {
  return projectsFileSchema.parse({ version: 1, ...raw });
}

const catalog = file({
  projects: [
    { id: "platform", name: "Platform", members: [{ repository: "github.com/example/platform" }] },
    { id: "portal", name: "Portal", members: [{ repository: "github.com/example/platform", path: "services/portal-api" }] },
    { id: "infra-portal", name: "Infra portal", members: [{ repository: "github.com/example/infra", branches: ["portal/*"] }] },
    { id: "deep", name: "Deep", members: [{ repository: "github.com/example/platform", path: "services/portal-api/v2", branches: ["**"] }] },
  ],
  aliases: { "path:/home/me/old-platform": "github.com/example/platform" },
});

describe("matchProject", () => {
  it("matches a whole-repository member", () => {
    expect(matchProject(catalog, { key: "github.com/example/platform", pathInRepo: "lib" })?.id).toBe("platform");
  });

  it("prefers a path member over the whole repository, inside that path only", () => {
    expect(matchProject(catalog, { key: "github.com/example/platform", pathInRepo: "services/portal-api" })?.id).toBe("portal");
    expect(matchProject(catalog, { key: "github.com/example/platform", pathInRepo: "services/portal-api/src" })?.id).toBe("portal");
    expect(matchProject(catalog, { key: "github.com/example/platform", pathInRepo: "services/portal-apix" })?.id).toBe("platform");
  });

  it("prefers the deeper path, even over a shallower one with no branch scope", () => {
    expect(matchProject(catalog, { key: "github.com/example/platform", pathInRepo: "services/portal-api/v2/x", branch: "main" })?.id).toBe("deep");
  });

  it("matches a branch member only on a matching branch, and never without a known branch", () => {
    expect(matchProject(catalog, { key: "github.com/example/infra", branch: "portal/login" })?.id).toBe("infra-portal");
    expect(matchProject(catalog, { key: "github.com/example/infra", branch: "main" })).toBeNull();
    expect(matchProject(catalog, { key: "github.com/example/infra" })).toBeNull();
  });

  it("doesn't match a path member when the path inside the repository is unknown", () => {
    expect(matchProject(catalog, { key: "github.com/example/platform" })?.id).toBe("platform");
  });

  it("follows an alias to the repository it merges into", () => {
    expect(matchProject(catalog, { key: "path:/home/me/old-platform" })?.id).toBe("platform");
  });

  it("returns null for a repository in no project", () => {
    expect(matchProject(catalog, { key: "github.com/example/docs" })).toBeNull();
  });

  it("breaks a remaining tie by file order", () => {
    const overlapping = file({
      projects: [
        { id: "first", name: "First", members: [{ repository: "r", branches: ["release/*"] }] },
        { id: "second", name: "Second", members: [{ repository: "r", branches: ["**"] }] },
      ],
    });

    expect(matchProject(overlapping, { key: "r", branch: "release/1.0" })?.id).toBe("first");
  });
});

describe("branchPatternMatches", () => {
  it("treats * as one segment, ** as any depth and ? as one character", () => {
    expect(branchPatternMatches("portal/*", "portal/login")).toBe(true);
    expect(branchPatternMatches("portal/*", "portal/a/b")).toBe(false);
    expect(branchPatternMatches("portal/**", "portal/a/b")).toBe(true);
    expect(branchPatternMatches("v?", "v1")).toBe(true);
    expect(branchPatternMatches("main", "main")).toBe(true);
    expect(branchPatternMatches("main", "maintenance")).toBe(false);
  });

  it("treats regular-expression characters literally", () => {
    expect(branchPatternMatches("fix.(a)+", "fix.(a)+")).toBe(true);
    expect(branchPatternMatches("fix.(a)+", "fixx(a)")).toBe(false);
  });
});

describe("resolveAlias and projectIdsForRepository", () => {
  it("maps an alias to its target and leaves other keys alone", () => {
    expect(resolveAlias(catalog, "path:/home/me/old-platform")).toBe("github.com/example/platform");
    expect(resolveAlias(catalog, "github.com/example/docs")).toBe("github.com/example/docs");
  });

  it("lists every project with any member in the repository, in file order", () => {
    expect(projectIdsForRepository(catalog, "github.com/example/platform")).toEqual(["platform", "portal", "deep"]);
    expect(projectIdsForRepository(catalog, "path:/home/me/old-platform")).toEqual(["platform", "portal", "deep"]);
    expect(projectIdsForRepository(catalog, "github.com/example/docs")).toEqual([]);
  });
});

// Branch patterns come from the user's projects file: matching must not
// backtrack exponentially (CodeQL js/polynomial-redos family, PR #137).
describe("branchPatternMatches on adversarial patterns", () => {
  it("answers quickly for many ** and * against a long branch that doesn't match", () => {
    const started = performance.now();
    expect(branchPatternMatches(`${"**".repeat(40)}x`, "a".repeat(250))).toBe(false);
    expect(branchPatternMatches(`${"*a".repeat(40)}x`, "a".repeat(250))).toBe(false);
    expect(branchPatternMatches(`${"**/".repeat(40)}x`, `${"a/".repeat(120)}b`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("still matches across segments with **", () => {
    expect(branchPatternMatches("**/fix-*", "team/a/fix-login")).toBe(true);
    expect(branchPatternMatches("**", "")).toBe(true);
    expect(branchPatternMatches("*", "a/b")).toBe(false);
  });
});
