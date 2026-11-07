// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { RepositoryAttribution, Session } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { upperCaseTranslate as T } from "../l10n/upper-case-translate.js";
import { buildSessionsByRepositoryTree, type RepositoryOf } from "./sessions-by-repository-tree-model.js";

// Phase 15 step 15.14 (plan §11.9, board 7): the Sessions tree grouped by
// the repository each session's folder belongs to.

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    mode: "analyze",
    title: overrides.id,
    model: "claude-sonnet-5",
    turns: [],
    turnCount: 3,
    costAiCredits: { known: true, value: 1 },
    usageDataAvailable: true,
    startedAt: "2026-10-24T09:00:00Z",
    ...overrides,
  };
}

const NOW = new Date("2026-10-24T15:00:00Z");

function remote(key: string): RepositoryAttribution {
  return { attributed: true, repository: { key, source: "git-remote", rootPath: `/home/dev/src/${key.split("/").at(-1)}` } };
}

// The session's id names its repository: "portal-1" is in portal, etc.
const REPOSITORIES: Record<string, RepositoryAttribution> = {
  portal: remote("github.com/example/portal-web"),
  billing: remote("github.com/example/billing-api"),
  scratch: { attributed: true, repository: { key: "local:/home/dev/scratch", source: "git-local", rootPath: "/home/dev/scratch" } },
  none: { attributed: false, reason: "The provider reported no working folder for this session." },
  gone: { attributed: false, reason: "The folder no longer exists." },
};
const repositoryOf: RepositoryOf = (s) => REPOSITORIES[s.id.split("-")[0]!]!;

describe("buildSessionsByRepositoryTree", () => {
  it("is empty for no sessions", () => {
    expect(buildSessionsByRepositoryTree([], repositoryOf, NOW, "UTC")).toEqual([]);
  });

  it("groups by repository, the highest known total first, and No repository last", () => {
    const tree = buildSessionsByRepositoryTree(
      [
        session({ id: "billing-1", costAiCredits: { known: true, value: 2 } }),
        session({ id: "none-1", costAiCredits: { known: true, value: 50 } }),
        session({ id: "portal-1", costAiCredits: { known: true, value: 3 } }),
        session({ id: "portal-2", costAiCredits: { known: true, value: 1.5 } }),
        session({ id: "scratch-1", costAiCredits: { known: true, value: 0.25 } }),
      ],
      repositoryOf,
      NOW,
      "UTC",
    );

    expect(tree.map((group) => group.label)).toEqual(["github.com/example/portal-web", "github.com/example/billing-api", "scratch (local)", "No repository"]);
    expect(tree.map((group) => group.description)).toEqual(["4.50", "2.00", "0.25", "50.00"]);
    expect(tree.map((group) => group.children.map((child) => child.sessionId))).toEqual([["portal-1", "portal-2"], ["billing-1"], ["scratch-1"], ["none-1"]]);
  });

  it("totals only known costs and counts the unknown ones, never as 0", () => {
    const [portal, billing] = buildSessionsByRepositoryTree(
      [
        session({ id: "portal-1", costAiCredits: { known: true, value: 2 } }),
        session({ id: "portal-2", costAiCredits: { known: false, reason: "x" } }),
        session({ id: "billing-1", costAiCredits: { known: false, reason: "x" } }),
      ],
      repositoryOf,
      NOW,
      "UTC",
    );

    expect(portal?.description).toBe("2.00 · 1 unknown");
    expect(billing?.description).toBe("1 unknown");
  });

  it("puts a group with no known cost after the ones with a total", () => {
    const tree = buildSessionsByRepositoryTree(
      [session({ id: "billing-1", costAiCredits: { known: false, reason: "x" } }), session({ id: "portal-1", costAiCredits: { known: true, value: 0 } })],
      repositoryOf,
      NOW,
      "UTC",
    );

    expect(tree.map((group) => group.label)).toEqual(["github.com/example/portal-web", "github.com/example/billing-api"]);
  });

  it("sorts each group's sessions newest first and shows the day beside the cost", () => {
    const [portal] = buildSessionsByRepositoryTree(
      [
        session({ id: "portal-old", startedAt: "2026-10-20T09:00:00Z" }),
        session({ id: "portal-today", startedAt: "2026-10-24T14:02:00Z", costAiCredits: { known: true, value: 48.2 } }),
        session({ id: "portal-yesterday", startedAt: "2026-10-23T09:00:00Z" }),
        session({ id: "portal-undated", startedAt: undefined }),
      ],
      repositoryOf,
      NOW,
      "UTC",
    );

    expect(portal?.children.map((child) => child.sessionId)).toEqual(["portal-today", "portal-yesterday", "portal-old", "portal-undated"]);
    expect(portal?.children.map((child) => child.description)).toEqual(["48.20 · Today 14:02", "1.00 · Yesterday", "1.00 · 2026-10-20", "1.00"]);
  });

  it("expands the group with the newest session and collapses the others", () => {
    const tree = buildSessionsByRepositoryTree(
      [session({ id: "portal-1", startedAt: "2026-10-20T09:00:00Z", costAiCredits: { known: true, value: 9 } }), session({ id: "billing-1", startedAt: "2026-10-24T09:00:00Z" })],
      repositoryOf,
      NOW,
      "UTC",
    );

    expect(tree.map((group) => [group.label, group.expanded])).toEqual([
      ["github.com/example/portal-web", false],
      ["github.com/example/billing-api", true],
    ]);
  });

  it("gives each group a stable id that can't clash with a day's", () => {
    const tree = buildSessionsByRepositoryTree([session({ id: "portal-1" }), session({ id: "none-1" })], repositoryOf, NOW, "UTC");

    expect(tree.map((group) => group.id)).toEqual(["repository:github.com/example/portal-web", "no-repository"]);
  });

  it("names a local repository by its folder only, never its path (§10.1.5)", () => {
    const [scratch] = buildSessionsByRepositoryTree([session({ id: "scratch-1" })], repositoryOf, NOW, "UTC");

    expect(JSON.stringify(scratch)).not.toContain("/home/dev");
    expect(scratch?.tooltip).toBe("scratch (local)\n1 session · 1.00 AI Credits");
  });

  it("says in the group's tooltip how many sessions it holds and what they cost", () => {
    const [portal] = buildSessionsByRepositoryTree(
      [session({ id: "portal-1", costAiCredits: { known: true, value: 2 } }), session({ id: "portal-2", costAiCredits: { known: false, reason: "x" } })],
      repositoryOf,
      NOW,
      "UTC",
    );

    expect(portal?.tooltip).toBe("github.com/example/portal-web\n2 sessions · 2.00 AI Credits · 1 unknown");
  });

  it("gives No repository's reasons in its tooltip, each once", () => {
    const [none] = buildSessionsByRepositoryTree(
      [session({ id: "none-1" }), session({ id: "none-2" }), session({ id: "gone-1" })],
      repositoryOf,
      NOW,
      "UTC",
    );

    expect(none?.label).toBe("No repository");
    expect(none?.tooltip).toBe(
      "No repository\n3 sessions · 3.00 AI Credits\nThe provider reported no working folder for this session.\nThe folder no longer exists.",
    );
  });

  it("translates its labels, descriptions and tooltips, but not repository keys or titles", () => {
    const tree = buildSessionsByRepositoryTree(
      [
        session({ id: "portal-1", startedAt: "2026-10-24T14:02:00Z" }),
        session({ id: "scratch-1", costAiCredits: { known: false, reason: "x" } }),
        session({ id: "none-1" }),
      ],
      repositoryOf,
      NOW,
      "UTC",
      T,
    );

    expect(tree.map((group) => group.label)).toEqual(["github.com/example/portal-web", "scratch (LOCAL)", "NO REPOSITORY"]);
    expect(tree[0]?.children[0]?.description).toBe("1.00 · TODAY 14:02");
    expect(tree[0]?.children[0]?.label).toBe("portal-1");
    expect(tree[1]?.description).toBe("1 UNKNOWN");
  });
});
