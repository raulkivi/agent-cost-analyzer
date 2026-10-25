import type { Session } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { upperCaseTranslate as T } from "../l10n/upper-case-translate.js";
import { buildLearnTree, learnLoadErrorTree } from "./learn-tree-model.js";

function scenario(overrides: Partial<Session> & { id: string }): Session {
  return {
    mode: "learn",
    title: overrides.id,
    model: "example-model",
    turns: [],
    turnCount: 8,
    costAiCredits: { known: true, value: 0.19 },
    usageDataAvailable: true,
    ...overrides,
  };
}

// Step 10.12: the Learn view lists the bundled scenarios the way the
// Sessions view lists sessions, so the panel needs no list of its own.
describe("buildLearnTree", () => {
  it("is empty for no scenarios", () => {
    expect(buildLearnTree([])).toEqual([]);
  });

  it("groups scenarios by category, in the order the scenarios come, keeping their order", () => {
    const tree = buildLearnTree([
      scenario({ id: "cache-basics", category: "Prompt caching" }),
      scenario({ id: "ttl", category: "Cache TTL" }),
      scenario({ id: "ttl-1h", category: "Cache TTL" }),
      scenario({ id: "clear", category: "Clear" }),
    ]);

    expect(tree.map((group) => group.label)).toEqual(["Prompt caching", "Cache TTL", "Clear"]);
    expect(tree.map((group) => group.children.map((child) => child.scenarioId))).toEqual([
      ["cache-basics"],
      ["ttl", "ttl-1h"],
      ["clear"],
    ]);
    expect(tree.every((group) => group.expanded)).toBe(true);
  });

  it("puts scenarios without a category in an Other group, last", () => {
    const tree = buildLearnTree([scenario({ id: "loose" }), scenario({ id: "cache-basics", category: "Prompt caching" })]);

    expect(tree.map((group) => group.label)).toEqual(["Prompt caching", "Other"]);
  });

  it("counts a group's scenarios in its description", () => {
    const [group] = buildLearnTree([scenario({ id: "a", category: "Cache TTL" }), scenario({ id: "b", category: "Cache TTL" })]);

    expect(group!.description).toBe("2 scenarios");
  });

  it("shows a scenario's turns and AI Credits, unknown as unknown", () => {
    const [group] = buildLearnTree([
      scenario({ id: "known", title: "Cache Basics", category: "Prompt caching" }),
      scenario({
        id: "unknown",
        title: "Mystery",
        category: "Prompt caching",
        turnCount: 1,
        costAiCredits: { known: false, reason: "not extracted" },
      }),
    ]);

    expect(group!.children[0]).toMatchObject({
      kind: "scenario",
      scenarioId: "known",
      label: "Cache Basics",
      description: "8 turns · 0.19 AI Credits",
    });
    expect(group!.children[1]!.description).toBe("1 turn · AI Credits unknown");
    expect(group!.children[0]!.ariaLabel).toBe("Cache Basics, Prompt caching, 8 turns · 0.19 AI Credits");
    expect(group!.children[0]!.tooltip).toContain("Cache Basics");
  });

  it("translates every string it builds", () => {
    const [group] = buildLearnTree([scenario({ id: "a" })], T);

    expect(group!.label).toBe("OTHER");
    expect(group!.description).toBe("1 SCENARIO");
    expect(group!.children[0]!.description).toBe("8 TURNS · 0.19 AI CREDITS");
  });
});

describe("learnLoadErrorTree", () => {
  it("is one message that says what failed and how to retry", () => {
    expect(learnLoadErrorTree()).toEqual([
      { kind: "message", label: "Couldn't load the Learn scenarios", description: "Refresh to retry.", icon: "error" },
    ]);
  });
});
