import { describe, expect, it } from "vitest";
import type { InsightSessionRow, InsightTurnRow } from "@agent-cost-analyzer/domain";
import { createAssociativeEngine } from "../associative/engine.js";
import { sampleInsightsDataset } from "../../test-support/insights-fixture.js";
import { FIELD, createInsightsModel, LIST_BOX_GROUPS } from "./insights-model.js";

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

  it("lists every field in exactly one list-box group", () => {
    const grouped = LIST_BOX_GROUPS.flatMap((group) => group.fields);
    expect(new Set(grouped)).toEqual(new Set(Object.values(FIELD)));
    expect(grouped).toHaveLength(Object.values(FIELD).length);
  });
});
