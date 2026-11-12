// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { insightFindingSchema, type InsightTurnRow } from "@agent-cost-analyzer/domain";
import { billed, costLine, costs, priced } from "../../test-support/cost-cube-fakes.js";
import type { DetectorInput } from "./finding-detector.js";
import { PriceChangeFindingDetector } from "./price-change-finding-detector.js";

// Phase 15 step 15.10 (plan §6.4 point 2, D9, D11, §10.1.2 list_findings
// kind "price-change"): each observed price change is an inferred finding,
// in the Phase 9.11 pipeline beside the other detectors.

function rows(date: string, count: number, ratio: number, session: string): InsightTurnRow[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `vscode:${session}:${index}`,
    sessionKey: `vscode:${session}`,
    turnIndex: index,
    model: "claude-sonnet-5.5",
    uncachedInput: 1,
    cacheWrite: 0,
    cacheRead: 0,
    reasoning: null,
    output: 1,
    aiCredits: 10 * ratio,
    estimated: false,
    toolCallCount: 0,
    repositoryKey: "github.com/acme/app",
    projectId: "app",
    vendorId: "anthropic",
    channel: "github-copilot",
    date,
    cost: costs({ billed: billed(10 * ratio), priced: priced(10, "gh:sonnet:2026-10-01", "AI_CREDITS") }),
  }));
}

const input = (turns: InsightTurnRow[], pricing?: DetectorInput["pricing"]): DetectorInput => ({
  sources: [],
  rows: { sessions: [], turns, toolCalls: [] },
  ...(pricing ? { pricing } : {}),
});

const steady = [...rows("2026-10-14", 20, 1.12, "a"), ...rows("2026-10-21", 20, 1.12, "b")];

describe("PriceChangeFindingDetector", () => {
  it("raises one inferred price-change finding per observed change, linked to its first session", () => {
    const findings = new PriceChangeFindingDetector().detect(input(steady));
    expect(findings).toHaveLength(1);
    const finding = insightFindingSchema.parse(findings[0]);
    expect(finding).toMatchObject({
      key: "price-change:github-copilot:claude-sonnet-5.5:2026-10-12",
      sessionKey: "vscode:a",
      kind: "price-change",
      category: "observed-price-change",
      severity: "medium",
      ruleId: "pricing.observed-change",
      title: "Observed: claude-sonnet-5.5 billed 12% above the price book since 2026-10-12",
      at: "2026-10-12",
    });
    expect(finding.why).toMatch(/inferred/i);
    expect(finding.why).toMatch(/2 weeks in a row/);
    expect(finding.evidence).toBe("2026-W42: 20 turns, billed 224 vs priced 200 AI Credits (×1.12); 2026-W43: 20 turns, billed 224 vs priced 200 AI Credits (×1.12)");
  });

  it("raises nothing when the dataset is priced at today's prices (the gap would be the price change itself)", () => {
    expect(new PriceChangeFindingDetector().detect(input(steady, "today"))).toEqual([]);
  });

  it("raises nothing for turns without both figures", () => {
    const unpriced = steady.map((row) => ({ ...row, cost: costs({ billed: billed(12) }) }));
    expect(new PriceChangeFindingDetector().detect(input(unpriced))).toEqual([]);
  });
});

// Step 10.19 (classic subagents plan §4.5, SA10 exit): billed and priced are
// compared per cost line's model. The main agent on Sonnet is billed exactly
// as priced; only its runs on Sol are billed 20 % above. By the turn's model
// alone, Sonnet would show a false 10 % gap.
describe("PriceChangeFindingDetector with subagent runs", () => {
  function withRuns(date: string, session: string): InsightTurnRow[] {
    return rows(date, 20, 1, session).map((row) => ({
      ...row,
      aiCredits: 22,
      cost: costs({ billed: billed(22), priced: priced(20, "gh:mixed", "AI_CREDITS") }),
      lines: [
        costLine("claude-sonnet-5.5", "anthropic", costs({ billed: billed(10), priced: priced(10, "gh:sonnet:2026-10-01", "AI_CREDITS") }), { subagent: false }),
        costLine("gpt-6.1-sol", "openai", costs({ billed: billed(12), priced: priced(10, "gh:sol:2026-10-01", "AI_CREDITS") })),
      ],
    }));
  }

  it("raises no false finding on the turn's model, and finds the run's model's own gap", () => {
    const findings = new PriceChangeFindingDetector().detect(input([...withRuns("2026-10-14", "a"), ...withRuns("2026-10-21", "b")]));
    expect(findings.map((finding) => finding.key)).toEqual(["price-change:github-copilot:gpt-6.1-sol:2026-10-12"]);
    expect(findings[0]!.sessionKey).toBe("vscode:a");
  });
});
