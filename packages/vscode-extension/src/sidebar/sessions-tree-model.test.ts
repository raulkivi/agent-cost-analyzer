import type { Session } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { upperCaseTranslate as T } from "../l10n/upper-case-translate.js";
import { buildSessionsTree, sessionsLoadErrorTree } from "./sessions-tree-model.js";

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    mode: "analyze",
    title: overrides.id,
    model: "claude-sonnet-5",
    turns: [],
    turnCount: 12,
    costAiCredits: { known: true, value: 1 },
    usageDataAvailable: true,
    ...overrides,
  };
}

const NOW = new Date("2026-10-24T15:00:00Z");

describe("buildSessionsTree", () => {
  it("is empty for no sessions", () => {
    expect(buildSessionsTree([], NOW, "UTC")).toEqual([]);
  });

  it("groups by local day, newest day first: Today, Yesterday, then ISO dates", () => {
    const tree = buildSessionsTree(
      [
        session({ id: "old", startedAt: "2026-10-01T09:00:00Z" }),
        session({ id: "yesterday", startedAt: "2026-10-23T09:00:00Z" }),
        session({ id: "today", startedAt: "2026-10-24T09:00:00Z" }),
        session({ id: "older", startedAt: "2026-09-30T09:00:00Z" }),
      ],
      NOW,
      "UTC",
    );

    expect(tree.map((group) => group.label)).toEqual(["Today", "Yesterday", "2026-10-01", "2026-09-30"]);
    expect(tree.map((group) => group.children.map((child) => child.sessionId))).toEqual([
      ["today"],
      ["yesterday"],
      ["old"],
      ["older"],
    ]);
  });

  it("sorts sessions inside a day newest first", () => {
    const [today] = buildSessionsTree(
      [
        session({ id: "morning", startedAt: "2026-10-24T08:00:00Z" }),
        session({ id: "noon", startedAt: "2026-10-24T12:00:00Z" }),
        session({ id: "early", startedAt: "2026-10-24T01:00:00Z" }),
      ],
      NOW,
      "UTC",
    );

    expect(today?.children.map((child) => child.sessionId)).toEqual(["noon", "morning", "early"]);
  });

  it("keeps the input order for sessions that started at the same instant", () => {
    const [today] = buildSessionsTree(
      [
        session({ id: "b", startedAt: "2026-10-24T08:00:00Z" }),
        session({ id: "a", startedAt: "2026-10-24T08:00:00Z" }),
        session({ id: "c", startedAt: "2026-10-24T08:00:00.000Z" }),
      ],
      NOW,
      "UTC",
    );

    expect(today?.children.map((child) => child.sessionId)).toEqual(["b", "a", "c"]);
  });

  it("puts sessions without a start date in a last 'Undated' group and never invents a date", () => {
    const tree = buildSessionsTree(
      [
        session({ id: "none" }),
        session({ id: "garbage", startedAt: "not a date" }),
        session({ id: "dated", startedAt: "2026-10-24T08:00:00Z" }),
      ],
      NOW,
      "UTC",
    );

    expect(tree.map((group) => group.label)).toEqual(["Today", "Undated"]);
    expect(tree[1]?.children.map((child) => child.sessionId)).toEqual(["none", "garbage"]);
    expect(tree[1]?.children[0]?.tooltip).toContain("start time unknown");
  });

  it("judges days in the given time zone, across local midnight", () => {
    // 22:30 UTC on the 23rd is already the 24th in Helsinki (UTC+3).
    const sessions = [
      session({ id: "late", startedAt: "2026-10-23T22:30:00Z" }),
      session({ id: "earlier", startedAt: "2026-10-23T10:00:00Z" }),
    ];

    expect(buildSessionsTree(sessions, NOW, "Europe/Helsinki").map((group) => group.label)).toEqual(["Today", "Yesterday"]);
    expect(buildSessionsTree(sessions, NOW, "UTC").map((group) => group.label)).toEqual(["Yesterday"]);
  });

  it("judges 'now' in the same zone: just after local midnight, the previous evening is Yesterday", () => {
    const justAfterMidnight = new Date("2026-10-24T21:10:00Z"); // 00:10 on the 25th in Helsinki

    const tree = buildSessionsTree([session({ id: "evening", startedAt: "2026-10-24T17:00:00Z" })], justAfterMidnight, "Europe/Helsinki");

    expect(tree.map((group) => group.label)).toEqual(["Yesterday"]);
  });

  it("labels a session with its title", () => {
    const [today] = buildSessionsTree([session({ id: "s", title: "Refactor token cache", startedAt: "2026-10-24T08:00:00Z" })], NOW, "UTC");

    expect(today?.children[0]).toMatchObject({ kind: "session", sessionId: "s", label: "Refactor token cache" });
  });

  describe("AI Credits", () => {
    it("describes a known cost rounded to 2 decimals", () => {
      const [today] = buildSessionsTree(
        [
          session({ id: "a", startedAt: "2026-10-24T09:00:00Z", costAiCredits: { known: true, value: 4.8249 } }),
          session({ id: "b", startedAt: "2026-10-24T08:00:00Z", costAiCredits: { known: true, value: 3.1 } }),
          session({ id: "c", startedAt: "2026-10-24T07:00:00Z", costAiCredits: { known: true, value: 0 } }),
        ],
        NOW,
        "UTC",
      );

      expect(today?.children.map((child) => child.description)).toEqual(["4.82", "3.10", "0.00"]);
    });

    it("says 'AI Credits unknown' for an unknown cost, never 0 (constraint 6)", () => {
      const [today] = buildSessionsTree(
        [session({ id: "a", startedAt: "2026-10-24T09:00:00Z", costAiCredits: { known: false, reason: "no main.jsonl" } })],
        NOW,
        "UTC",
      );

      expect(today?.children[0]?.description).toBe("AI Credits unknown");
      expect(today?.children[0]?.tooltip).toContain("AI Credits unknown");
      expect(today?.children[0]?.tooltip).not.toContain("0.00");
    });

    it("sums only the known costs in a group and counts the unknown ones", () => {
      const [today] = buildSessionsTree(
        [
          session({ id: "a", startedAt: "2026-10-24T09:00:00Z", costAiCredits: { known: true, value: 4.82 } }),
          session({ id: "b", startedAt: "2026-10-24T08:00:00Z", costAiCredits: { known: true, value: 3.17 } }),
          session({ id: "c", startedAt: "2026-10-24T07:00:00Z", costAiCredits: { known: true, value: 4.41 } }),
          session({ id: "d", startedAt: "2026-10-24T06:00:00Z", costAiCredits: { known: false, reason: "x" } }),
        ],
        NOW,
        "UTC",
      );

      expect(today?.description).toBe("12.40 · 1 unknown");
    });

    it("shows just the sum when every cost is known, and just the count when none is", () => {
      const tree = buildSessionsTree(
        [
          session({ id: "a", startedAt: "2026-10-24T09:00:00Z", costAiCredits: { known: true, value: 6.084 } }),
          session({ id: "b", startedAt: "2026-10-24T08:00:00Z", costAiCredits: { known: true, value: 3.876 } }),
          session({ id: "c", startedAt: "2026-10-23T08:00:00Z", costAiCredits: { known: false, reason: "x" } }),
          session({ id: "d", startedAt: "2026-10-23T07:00:00Z", costAiCredits: { known: false, reason: "x" } }),
        ],
        NOW,
        "UTC",
      );

      expect(tree.map((group) => group.description)).toEqual(["9.96", "2 unknown"]);
    });

    it("sums the Undated group the same way", () => {
      const [undated] = buildSessionsTree(
        [session({ id: "a", costAiCredits: { known: true, value: 2 } }), session({ id: "b", costAiCredits: { known: false, reason: "x" } })],
        NOW,
        "UTC",
      );

      expect(undated?.description).toBe("2.00 · 1 unknown");
    });
  });

  describe("tooltip and accessible label", () => {
    it("names the turn count, local start time and model", () => {
      const [today] = buildSessionsTree(
        [session({ id: "a", title: "Refactor", startedAt: "2026-10-24T14:02:00Z", turnCount: 12, model: "claude-sonnet-5" })],
        NOW,
        "UTC",
      );

      expect(today?.children[0]?.tooltip).toBe("Refactor\n12 turns · started 2026-10-24 14:02 · claude-sonnet-5\n1.00 AI Credits");
    });

    it("leaves the model out when it isn't known, and says '1 turn' for one", () => {
      const [today] = buildSessionsTree(
        [session({ id: "a", title: "T", startedAt: "2026-10-24T14:02:00Z", turnCount: 1, model: "unknown" })],
        NOW,
        "UTC",
      );

      expect(today?.children[0]?.tooltip).toBe("T\n1 turn · started 2026-10-24 14:02\n1.00 AI Credits");
    });

    it("shows the start time in the given time zone", () => {
      const [today] = buildSessionsTree([session({ id: "a", startedAt: "2026-10-24T14:02:00Z" })], NOW, "Europe/Helsinki");

      expect(today?.children[0]?.tooltip).toContain("started 2026-10-24 17:02");
    });

    it("gives the screen-reader label as title, cost and turns", () => {
      const tree = buildSessionsTree(
        [
          session({ id: "a", title: "Known", startedAt: "2026-10-24T09:00:00Z", costAiCredits: { known: true, value: 4.82 }, turnCount: 3 }),
          session({ id: "b", title: "Unknown", startedAt: "2026-10-24T08:00:00Z", costAiCredits: { known: false, reason: "x" }, turnCount: 1 }),
        ],
        NOW,
        "UTC",
      );

      expect(tree[0]?.children.map((child) => child.ariaLabel)).toEqual([
        "Known, 4.82 AI Credits, 3 turns",
        "Unknown, AI Credits unknown, 1 turn",
      ]);
    });
  });

  it("expands Today and Yesterday and collapses the older days", () => {
    const tree = buildSessionsTree(
      [
        session({ id: "a", startedAt: "2026-10-24T09:00:00Z" }),
        session({ id: "b", startedAt: "2026-10-23T09:00:00Z" }),
        session({ id: "c", startedAt: "2026-10-22T09:00:00Z" }),
        session({ id: "d" }),
      ],
      NOW,
      "UTC",
    );

    expect(tree.map((group) => group.expanded)).toEqual([true, true, false, false]);
  });

  it("gives each group a stable id (the day, or 'undated')", () => {
    const tree = buildSessionsTree([session({ id: "a", startedAt: "2026-10-24T09:00:00Z" }), session({ id: "b" })], NOW, "UTC");

    expect(tree.map((group) => group.id)).toEqual(["2026-10-24", "undated"]);
  });
});

describe("sessionsLoadErrorTree", () => {
  it("is one error node that says nothing was changed and how to retry", () => {
    expect(sessionsLoadErrorTree()).toEqual([
      {
        kind: "message",
        label: "Couldn't read your Copilot Chat sessions",
        description: "Nothing was changed. Refresh to retry.",
        icon: "error",
      },
    ]);
  });
});

describe("translation (vscode-extension.md §3.5 Localization)", () => {
  it("translates the day labels, the cost text, the tooltip and the screen-reader label, but not the title or model", () => {
    const tree = buildSessionsTree(
      [
        session({ id: "a", title: "Refactor", startedAt: "2026-10-24T14:02:00Z", turnCount: 12 }),
        session({ id: "b", title: "Other", startedAt: "2026-10-23T14:02:00Z", turnCount: 1, costAiCredits: { known: false, reason: "x" } }),
        session({ id: "c", title: "None", model: "unknown" }),
      ],
      NOW,
      "UTC",
      T,
    );

    expect(tree.map((group) => group.label)).toEqual(["TODAY", "YESTERDAY", "UNDATED"]);
    expect(tree[0]?.children[0]).toMatchObject({
      label: "Refactor",
      tooltip: "Refactor\n12 TURNS · STARTED 2026-10-24 14:02 · claude-sonnet-5\n1.00 AI CREDITS",
      ariaLabel: "Refactor, 1.00 AI CREDITS, 12 TURNS",
    });
    expect(tree[1]?.children[0]).toMatchObject({
      description: "AI CREDITS UNKNOWN",
      tooltip: "Other\n1 TURN · STARTED 2026-10-23 14:02 · claude-sonnet-5\nAI CREDITS UNKNOWN",
      ariaLabel: "Other, AI CREDITS UNKNOWN, 1 TURN",
    });
    expect(tree[2]?.children[0]?.tooltip).toBe("None\n12 TURNS · START TIME UNKNOWN\n1.00 AI CREDITS");
  });

  it("translates the group totals' unknown counts", () => {
    const [mixed, none] = buildSessionsTree(
      [
        session({ id: "a", startedAt: "2026-10-24T09:00:00Z", costAiCredits: { known: true, value: 2 } }),
        session({ id: "b", startedAt: "2026-10-24T08:00:00Z", costAiCredits: { known: false, reason: "x" } }),
        session({ id: "c", startedAt: "2026-10-23T08:00:00Z", costAiCredits: { known: false, reason: "x" } }),
      ],
      NOW,
      "UTC",
      T,
    );

    expect(mixed?.description).toBe("2.00 · 1 UNKNOWN");
    expect(none?.description).toBe("1 UNKNOWN");
  });

  it("translates the load error", () => {
    expect(sessionsLoadErrorTree(T)).toEqual([
      {
        kind: "message",
        label: "COULDN'T READ YOUR COPILOT CHAT SESSIONS",
        description: "NOTHING WAS CHANGED. REFRESH TO RETRY.",
        icon: "error",
      },
    ]);
  });
});
