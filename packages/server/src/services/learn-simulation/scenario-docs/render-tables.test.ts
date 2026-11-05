import { describe, expect, it } from "vitest";
import type { Session, Turn } from "@agent-cost-analyzer/domain";
import { renderSessionSection } from "./render-tables.js";

const turn = (
  index: number,
  model: string,
  u: number,
  w: number,
  r: number,
  credits: number,
  extra: Partial<Turn["usage"]> = {},
): Turn => ({
  index,
  userMessage: "u",
  assistantResponse: "a",
  toolCalls: [],
  explanation: `Step ${index} | with pipe`,
  usage: {
    uncachedInput: { known: true, value: u },
    cacheWrite: { known: true, value: w },
    cacheRead: { known: true, value: r },
    tool: { known: true, value: 10 },
    vision: { known: true, value: 0 },
    reasoning: { known: true, value: 20 },
    output: { known: true, value: 30 },
    costAiCredits: { known: true, value: credits },
    model,
    ...extra,
  },
});

const session = (turns: Turn[]): Session => ({
  id: "x",
  mode: "learn",
  title: "T",
  model: "claude-sonnet-5.5",
  usageDataAvailable: true,
  turnCount: turns.length,
  costAiCredits: {
    known: true,
    value: turns.reduce(
      (s, t) => s + (t.usage.costAiCredits as { value: number }).value,
      0,
    ),
  },
  turns,
});

const options = {
  referenceModel: "Claude Sonnet 5.5",
  checkedAt: "2026-11-03",
};

describe("renderSessionSection", () => {
  const out = renderSessionSection(
    session([turn(1, "m", 0, 1000, 0, 1.234), turn(2, "m", 5, 100, 1000, 0.5)]),
    options,
  );

  it("renders the per-turn table with cache size after = read + write", () => {
    expect(out).toContain(
      "| Turn | What happens | Cache write | Cache read | Cache size after | Uncached input | Tool (in input) | Vision (in input) | Reasoning | Output text | **Turn total** | **Turn AI Credits** |",
    );
    // total = uncached + write + read + reasoning + output
    expect(out).toContain(
      "| 1 | Step 1 \\| with pipe | 1000 | 0 | 1000 | 0 | 10 | 0 | 20 | 30 | **1050** | **1.23** |",
    );
    expect(out).toContain(
      "| 2 | Step 2 \\| with pipe | 100 | 1000 | 1100 | 5 | 10 | 0 | 20 | 30 | **1155** | **0.50** |",
    );
  });

  it("renders running totals", () => {
    expect(out).toContain(
      "| 2 | Step 2 \\| with pipe | 1100 | 1000 | 5 | 20 | 0 | 40 | 60 | **2205** | **1.73** |",
    );
  });

  it("summarises the session with USD and the most expensive turn", () => {
    expect(out).toContain("Session total: **1.73 AI Credits** (≈ $0.0173)");
    expect(out).toContain("most expensive turn: **turn 1** (1.23 AI Credits)");
  });

  it("states what the numbers come from", () => {
    expect(out).toContain("Simulated on Claude Sonnet 5.5");
    expect(out).toContain("checked 2026-11-03");
  });

  it("adds a Model column when the turns use more than one model", () => {
    const multi = renderSessionSection(
      session([
        turn(1, "claude-haiku-5.5", 0, 10, 0, 0.1),
        turn(2, "claude-sonnet-5.5", 0, 10, 0, 0.2),
      ]),
      options,
    );
    expect(multi).toContain("| Turn | What happens | Model |");
    expect(multi).toContain("| 1 | Step 1 \\| with pipe | claude-haiku-5.5 |");
  });

  it("shows n/a for unknown figures instead of zero", () => {
    const na = { known: false as const, reason: "x" };
    const unknown = renderSessionSection(
      session([
        turn(1, "m", 0, 0, 0, 0, {
          cacheWrite: na,
          cacheRead: na,
          uncachedInput: na,
          costAiCredits: na,
        }),
      ]),
      options,
    );
    expect(unknown).toContain(
      "| 1 | Step 1 \\| with pipe | n/a | n/a | n/a | n/a |",
    );
    expect(unknown).not.toContain("Session total: **0.00");
  });

  it("includes a token chart with one series per token type", () => {
    expect(out).toContain("```mermaid\nxychart-beta");
    expect(out).toContain('bar "Cache write" [1000, 100]');
    expect(out).toContain('bar "Cache read" [0, 1000]');
  });
});
