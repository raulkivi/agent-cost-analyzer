import { describe, expect, it } from "vitest";
import type { VarianceCurrency } from "@agent-cost-analyzer/domain";
import { defaultPeriods, formatSigned, monthLabel, monthsOf, projectScope, waterfallSteps } from "./project-model.js";

// Phase 15 step 15.10 (plan §8.4, §11.4; board 3): the Project tab's rules
// as pure functions: which project, which months, and the waterfall from
// period A's cost to period B's.

const placeholders = { project: "(No project)", repository: "(Unattributed)" };

describe("projectScope", () => {
  it("takes the one selected project, with the provider when one is selected", () => {
    expect(projectScope({ project: ["portal"], provider: ["vscode"] }, placeholders)).toEqual({ projectId: "portal", providerId: "vscode", ignored: [] });
  });

  it("needs exactly one real project", () => {
    expect(projectScope({}, placeholders)).toEqual({ reason: "Select one project in the Project list box to see inside it." });
    expect(projectScope({ project: ["a", "b"] }, placeholders)).toEqual({ reason: "Select one project, not 2, to see inside it." });
    expect(projectScope({ project: ["(No project)"] }, placeholders)).toEqual({ reason: "Work outside any project has no project to look inside. Select a project." });
  });

  it("names other selections it can't apply", () => {
    expect(projectScope({ project: ["portal"], model: ["gpt-5.5"] }, placeholders)).toMatchObject({ ignored: ["model"] });
  });
});

describe("months", () => {
  it("lists the months a range touches, oldest first", () => {
    expect(monthsOf({ since: "2026-08-09", until: "2026-11-06" })).toEqual(["2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(monthsOf({ since: "2026-11-01", until: "2026-11-06" })).toEqual(["2026-11"]);
  });

  it("compares the first month with the last by default, or the month before when there is only one", () => {
    expect(defaultPeriods(["2026-08", "2026-09", "2026-10"])).toEqual({ a: "2026-08", b: "2026-10" });
    expect(defaultPeriods(["2026-11"])).toEqual({ a: "2026-10", b: "2026-11" });
    expect(defaultPeriods(["2026-01"])).toEqual({ a: "2025-12", b: "2026-01" });
  });

  it("writes a month as on the board", () => {
    expect(monthLabel("2026-08")).toBe("Aug 2026");
  });
});

describe("waterfallSteps", () => {
  const usd: VarianceCurrency = {
    currency: "USD",
    costA: 182.4,
    costB: 211.2,
    change: 28.8,
    usage: 41.3,
    price: -18.6,
    mix: 6.1,
    turnsA: 10,
    turnsB: 12,
    byTokenType: [],
    models: [],
  };

  it("walks from A's cost through usage, price and mix to B's, in the shown unit", () => {
    const steps = waterfallSteps(usd, "AI_CREDITS", { a: "Aug 2026", b: "Oct 2026" });
    expect(steps.map((step) => [step.key, step.label, step.kind])).toEqual([
      ["a", "Aug 2026", "total"],
      ["usage", "Usage", "increase"],
      ["price", "Price", "decrease"],
      ["mix", "Mix", "increase"],
      ["b", "Oct 2026", "total"],
    ]);
    expect(steps[0]).toMatchObject({ from: 0, to: 18240 });
    expect(steps[1]!.from).toBeCloseTo(18240, 6);
    expect(steps[1]!.to).toBeCloseTo(22370, 6);
    expect(steps[3]!.to).toBeCloseTo(21120, 6);
    expect(steps[4]).toMatchObject({ from: 0 });
    expect(steps[4]!.to).toBeCloseTo(21120, 6);
    expect(steps[2]!.value).toBeCloseTo(-1860, 6);
  });

  it("calls a zero effect no change", () => {
    expect(waterfallSteps({ ...usd, mix: 0, change: 22.7 }, "USD", { a: "A", b: "B" })[3]).toMatchObject({ kind: "none", value: 0 });
  });
});

describe("formatSigned", () => {
  it("always writes the sign, with a typographic minus", () => {
    expect(formatSigned(4130, "AI_CREDITS")).toBe("+4,130.00");
    expect(formatSigned(-1860, "AI_CREDITS")).toBe("−1,860.00");
    expect(formatSigned(-18.6, "USD")).toBe("−$18.60");
    expect(formatSigned(0, "USD")).toBe("$0.00");
  });
});
