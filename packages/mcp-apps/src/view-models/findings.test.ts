// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { EnrichedFinding, FindingsQueryResult } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { toFindingsViewModel } from "./findings.js";

function finding(overrides: Partial<EnrichedFinding> = {}): EnrichedFinding {
  return {
    key: "f1",
    sessionKey: "copilot:s1",
    turnIndex: 8,
    kind: "security",
    category: "credential-access",
    severity: "critical",
    ruleId: "sec-001",
    title: "Read a credentials file",
    at: "2026-10-30T09:00:00Z",
    why: "The command read a file under ~/.config/deploy.",
    evidence: "$ cat ~/.config/deploy/[REDACTED:path]",
    providerId: "copilot",
    sessionId: "s1",
    sessionTitle: "Rotate deploy keys",
    ...overrides,
  };
}

function result(findings: EnrichedFinding[], overrides: Partial<FindingsQueryResult> = {}): FindingsQueryResult {
  return {
    generatedAt: "2026-11-02T12:00:00Z",
    providers: [],
    total: findings.length,
    bySeverity: { info: 4, low: 12, medium: 7, high: 3, critical: 1 },
    findings,
    ...overrides,
  };
}

describe("toFindingsViewModel summary and tiles", () => {
  it("counts findings and lists the severity tiles most severe first", () => {
    const vm = toFindingsViewModel(result([finding()], { total: 27 }), {});
    expect(vm.summaryText).toBe("27 findings");
    expect(vm.shownText).toBe("Showing 1 of 27, most severe first");
    expect(vm.severityTiles.map((tile) => [tile.severity, tile.label, tile.countText])).toEqual([
      ["critical", "Critical", "1"],
      ["high", "High", "3"],
      ["medium", "Medium", "7"],
      ["low", "Low", "12"],
      ["info", "Info", "4"],
    ]);
    expect(vm.severityTiles.every((tile) => !tile.dimmed)).toBe(true);
  });

  it("uses the singular and omits the shown note when everything is shown", () => {
    const vm = toFindingsViewModel(result([finding()]), {});
    expect(vm.summaryText).toBe("1 finding");
    expect(vm.shownText).toBeUndefined();
  });

  it("says so when nothing matches", () => {
    const vm = toFindingsViewModel(result([], { bySeverity: { info: 0, low: 0, medium: 0, high: 0, critical: 0 } }), { minSeverity: "high" });
    expect(vm.summaryText).toBe("0 findings");
    expect(vm.emptyText).toBe("No findings match these filters.");
  });

  it("dims the severities below the minimum", () => {
    const vm = toFindingsViewModel(result([finding()]), { minSeverity: "high" });
    expect(vm.severityTiles.filter((tile) => tile.dimmed).map((tile) => tile.severity)).toEqual(["medium", "low", "info"]);
  });
});

describe("toFindingsViewModel filters", () => {
  it("selects All when no filter is set", () => {
    const vm = toFindingsViewModel(result([finding()]), {});
    expect(vm.kindOptions.map((option) => option.label)).toEqual(["All", "Security", "Anomaly", "Behaviour change", "Price change"]);
    expect(vm.kindOptions.filter((option) => option.selected).map((option) => option.value)).toEqual(["all"]);
    expect(vm.severityOptions.filter((option) => option.selected).map((option) => option.value)).toEqual(["all"]);
    expect(vm.filterText).toBeUndefined();
  });

  it("selects the active kind and severity and describes them", () => {
    const vm = toFindingsViewModel(result([finding()]), { kind: ["security"], minSeverity: "high" });
    expect(vm.kindOptions.filter((option) => option.selected).map((option) => option.value)).toEqual(["security"]);
    expect(vm.severityOptions.filter((option) => option.selected).map((option) => option.value)).toEqual(["high"]);
    expect(vm.severityOptions.map((option) => option.label)).toEqual(["All severities", "Low and above", "Medium and above", "High and above", "Critical only"]);
    expect(vm.filterText).toBe("Security, High and above");
  });

  it("treats a minimum of info as no severity filter", () => {
    const vm = toFindingsViewModel(result([finding()]), { minSeverity: "info" });
    expect(vm.severityOptions.filter((option) => option.selected).map((option) => option.value)).toEqual(["all"]);
    expect(vm.filterText).toBeUndefined();
  });
});

describe("toFindingsViewModel rows", () => {
  it("describes a finding with its session, turn and day", () => {
    const row = toFindingsViewModel(result([finding()]), {}).rows[0];
    expect(row).toEqual({
      key: "f1",
      title: "Read a credentials file",
      severity: "critical",
      severityLabel: "Critical",
      kind: "security",
      kindLabel: "Security",
      inferred: false,
      providerId: "copilot",
      sessionId: "s1",
      sessionTitle: "Rotate deploy keys",
      turnText: "turn 8",
      whenText: "Oct 30",
      detail: { why: "The command read a file under ~/.config/deploy.", evidence: "$ cat ~/.config/deploy/[REDACTED:path]" },
    });
  });

  it("tags an observed price change as inferred and no other kind", () => {
    const rows = toFindingsViewModel(
      result([finding({ key: "p", kind: "price-change", severity: "info" }), finding({ key: "a", kind: "anomaly" })]),
      {},
    ).rows;
    expect(rows.map((row) => [row.key, row.inferred])).toEqual([
      ["p", true],
      ["a", false],
    ]);
  });

  it("omits what the finding does not record", () => {
    const row = toFindingsViewModel(result([finding({ turnIndex: undefined, at: undefined, evidence: undefined })]), {}).rows[0];
    expect(row?.turnText).toBeUndefined();
    expect(row?.whenText).toBeUndefined();
    expect(row?.detail).toEqual({ why: "The command read a file under ~/.config/deploy." });
  });

  it("keeps logged text under the display-only fields", () => {
    const vm = toFindingsViewModel(result([finding({ why: "WHY-TEXT", evidence: "EVIDENCE-TEXT" })]), {});
    const { detail, ...rest } = vm.rows[0]!;
    expect(detail).toEqual({ why: "WHY-TEXT", evidence: "EVIDENCE-TEXT" });
    expect(JSON.stringify(rest)).not.toMatch(/WHY-TEXT|EVIDENCE-TEXT/);
  });
});
