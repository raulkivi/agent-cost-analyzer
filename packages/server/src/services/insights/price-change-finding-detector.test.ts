import { describe, expect, it } from "vitest";
import { insightFindingSchema, type InsightTurnRow } from "@agent-cost-analyzer/domain";
import { billed, costs, priced } from "../../test-support/cost-cube-fakes.js";
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
