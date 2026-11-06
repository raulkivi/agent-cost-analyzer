import { describe, expect, it } from "vitest";
import type { InsightSessionRow, InsightTurnRow } from "@agent-cost-analyzer/domain";
import { createAssociativeEngine } from "../associative/engine.js";
import { sampleInsightsDataset } from "../../test-support/insights-fixture.js";
import { FIELD, createInsightsModel, LIST_BOX_GROUPS, NO_COST, NO_PROJECT, UNATTRIBUTED, UNKNOWN_CHANNEL } from "./insights-model.js";
import { computeKpis, topSessionsByCredits } from "./measures.js";

function viewOf(evaluation: ReturnType<ReturnType<typeof createAssociativeEngine>["evaluate"]>) {
  return {
    sessions: evaluation.rows<InsightSessionRow>("sessions"),
    turns: evaluation.rows<InsightTurnRow>("turns"),
    toolCalls: evaluation.rows("toolCalls") as never[],
    findings: evaluation.rows("findings") as never[],
  };
}

function engineFor() {
  return createAssociativeEngine(createInsightsModel(sampleInsightsDataset()));
}

describe("createInsightsModel", () => {
  it("links findings to their sessions: selecting a severity narrows sessions and turns", () => {
    const result = engineFor().evaluate({ [FIELD.severity]: ["critical"] });
    expect(result.rows<InsightSessionRow>("sessions").map((row) => row.key)).toEqual(["cc:s1"]);
    expect(result.rows<InsightTurnRow>("turns").map((row) => row.key)).toEqual(["cc:s1:0", "cc:s1:1"]);
  });

  it("selecting a program reaches the provider list box through the turn and session", () => {
    const values = engineFor().evaluate({ [FIELD.program]: ["npm"] }).values(FIELD.provider);
    expect(values.map((value) => [value.label, value.state])).toEqual([
      ["VS Code", "possible"],
      ["Claude Code", "excluded"],
    ]);
  });

  it("labels values for humans", () => {
    const engine = engineFor().evaluate({});
    expect(engine.values(FIELD.outcome).map((value) => value.label)).toEqual(["Failed", "Succeeded", "Unknown"]);
    expect(engine.values(FIELD.failureCategory).map((value) => value.label)).toEqual(["Command not found"]);
    expect(engine.values(FIELD.trigger).map((value) => value.label)).toEqual(["compaction"]);
    expect(engine.values(FIELD.hour).map((value) => value.label)).toEqual(["09:00 UTC", "14:00 UTC", "22:00 UTC"]);
    expect(engine.values(FIELD.session).map((value) => value.label)).toEqual(["Docs", "Fix tests", "Refactor"]);
  });

  it("sorts dates newest first and severities most severe first", () => {
    const engine = engineFor().evaluate({});
    expect(engine.values(FIELD.date).map((value) => value.value)).toEqual(["2026-10-10", "2026-10-09"]);
    expect(engine.values(FIELD.severity).map((value) => value.value)).toEqual(["critical", "info"]);
  });

  it("splits usage into known and unknown AI Credits", () => {
    const values = engineFor().evaluate({}).values(FIELD.usage);
    expect(values.map((value) => [value.label, value.count])).toEqual([
      ["AI Credits known", 3],
      ["AI Credits unknown", 1],
    ]);
  });

  describe("attribution fields (step 15.4)", () => {
    it("lists projects by name, with No project, and repositories by key, with Unattributed", () => {
      const engine = engineFor().evaluate({});
      expect(engine.values(FIELD.project).map((value) => [value.value, value.label, value.count])).toEqual([
        ["portal", "Customer portal", 2],
        [NO_PROJECT, "No project", 2],
      ]);
      expect(engine.values(FIELD.repository).map((value) => [value.label, value.count])).toEqual([
        ["github.com/acme/platform", 1],
        ["github.com/acme/portal", 2],
        ["Unattributed", 1],
      ]);
    });

    // Step 15.9: as the cost tabs name it, a local repository by its folder.
    it("names a local repository by its folder, never its full path", () => {
      const dataset = sampleInsightsDataset();
      dataset.turns[0] = { ...dataset.turns[0]!, repositoryKey: "local:/home/dev/scratch" };
      const engine = createAssociativeEngine(createInsightsModel(dataset)).evaluate({});
      expect(engine.values(FIELD.repository).map((value) => value.label)).toContain("scratch (local)");
    });

    it("labels vendors from the dataset and channels from the domain, unknown last", () => {
      const dataset = sampleInsightsDataset();
      dataset.turns[2] = { ...dataset.turns[2]!, channel: null, channelUnknownReason: "No channel is known." };
      const engine = createAssociativeEngine(createInsightsModel(dataset)).evaluate({});

      expect(engine.values(FIELD.vendor).map((value) => value.label)).toEqual(["Anthropic", "OpenAI"]);
      expect(engine.values(FIELD.channel).map((value) => [value.value, value.label])).toEqual([
        ["anthropic-api", "Anthropic API"],
        ["github-copilot", "GitHub Copilot"],
        [UNKNOWN_CHANNEL, "Unknown channel"],
      ]);
    });

    it("filters turns, not whole sessions, by repository: a session that moved counts only its turns there", () => {
      const result = engineFor().evaluate({ [FIELD.repository]: ["github.com/acme/portal"] });

      expect(result.rows<InsightTurnRow>("turns").map((row) => row.key)).toEqual(["cc:s1:0", "vs:s3:0"]);
      expect(result.rows<InsightSessionRow>("sessions").map((row) => row.key)).toEqual(["cc:s1", "vs:s3"]);
      expect(result.values(FIELD.project).map((value) => [value.label, value.state])).toEqual([
        ["Customer portal", "possible"],
        ["No project", "excluded"],
      ]);
    });

    it("selecting Unattributed finds the turns with no repository", () => {
      const result = engineFor().evaluate({ [FIELD.repository]: [UNATTRIBUTED] });
      expect(result.rows<InsightTurnRow>("turns").map((row) => row.key)).toEqual(["cc:s2:0"]);
    });

    it("totals by project and by repository add up to the whole, and match the per-session totals (D1)", () => {
      const engine = engineFor();
      const all = computeKpis(viewOf(engine.evaluate({})));
      for (const fieldId of [FIELD.project, FIELD.repository, FIELD.vendor, FIELD.channel]) {
        const parts = engine.evaluate({}).values(fieldId).map((value) => {
          const view = viewOf(engine.evaluate({ [fieldId]: [value.value] }));
          const kpis = computeKpis(view);
          const perSession = topSessionsByCredits(view.sessions, view.turns, 100).reduce((sum, row) => sum + row.aiCredits.total, 0);
          expect(perSession, `${fieldId}=${value.value}`).toBeCloseTo(kpis.aiCredits.total, 9);
          return kpis.aiCredits;
        });
        expect(parts.reduce((sum, part) => sum + part.total, 0), fieldId).toBeCloseTo(all.aiCredits.total, 9);
        expect(parts.reduce((sum, part) => sum + part.known, 0), fieldId).toBe(all.aiCredits.known);
        expect(parts.reduce((sum, part) => sum + part.count, 0), fieldId).toBe(all.aiCredits.count);
      }
    });
  });

  describe("cost basis field (step 15.6)", () => {
    it("lists each turn's preferred basis in the fixed order billed, reported, priced, then Cost unknown", () => {
      const values = engineFor().evaluate({}).values(FIELD.costBasis);
      expect(values.map((value) => [value.value, value.label, value.count])).toEqual([
        ["billed", "Billed", 1],
        ["reported", "Reported", 1],
        ["priced", "Priced", 1],
        [NO_COST, "Cost unknown", 1],
      ]);
    });

    it("selecting a basis keeps the turns whose preferred figure has it", () => {
      const result = engineFor().evaluate({ [FIELD.costBasis]: ["priced"] });
      expect(result.rows<InsightTurnRow>("turns").map((row) => row.key)).toEqual(["cc:s1:0"]);
    });

    it("puts a row without cost figures under Cost unknown, never dropping it", () => {
      const dataset = sampleInsightsDataset();
      delete dataset.turns[0]!.cost;
      const values = createAssociativeEngine(createInsightsModel(dataset)).evaluate({}).values(FIELD.costBasis);
      expect(values.find((value) => value.value === NO_COST)?.count).toBe(2);
    });
  });

  it("puts Project, Repository, Vendor, Channel and Cost basis first, as the approved mock-up does (steps 15.4, 15.6)", () => {
    expect(LIST_BOX_GROUPS[0]?.fields).toEqual([FIELD.project, FIELD.repository, FIELD.vendor, FIELD.channel, FIELD.costBasis]);
  });

  it("lists every field in exactly one list-box group", () => {
    const grouped = LIST_BOX_GROUPS.flatMap((group) => group.fields);
    expect(new Set(grouped)).toEqual(new Set(Object.values(FIELD)));
    expect(grouped).toHaveLength(Object.values(FIELD).length);
  });
});
