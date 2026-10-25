import { describe, expect, it } from "vitest";
import type { Turn } from "@agent-cost-analyzer/domain";
import { makeTurn } from "../test-support/turn-fixture.js";
import { sessionKpis } from "./session-kpis.js";

const known = (value: number) => ({ known: true as const, value });
const unknown = { known: false as const, reason: "not recorded" };

function turnWith(usage: Partial<Turn["usage"]>, toolCalls: Turn["toolCalls"] = []): Turn {
  const base = makeTurn();
  return { ...base, toolCalls, usage: { ...base.usage, ...usage } };
}

// The narrow layout's 2×2 KPIs (mock-up board 4): AI Credits, cache read,
// turns and tool calls.
describe("sessionKpis", () => {
  it("sums AI Credits to 2 decimals when every turn's cost is known", () => {
    const kpis = sessionKpis([turnWith({ costAiCredits: known(1.234) }), turnWith({ costAiCredits: known(2) })]);

    expect(kpis.aiCredits).toEqual({ value: "3.23" });
  });

  it("never shows a partial or missing cost as a total (constraint 6)", () => {
    expect(sessionKpis([turnWith({ costAiCredits: known(1) }), turnWith({ costAiCredits: unknown })]).aiCredits).toEqual({
      value: "unknown",
      note: "1 of 2 turns known",
    });
    expect(sessionKpis([turnWith({ costAiCredits: unknown })]).aiCredits).toEqual({ value: "unknown" });
    expect(sessionKpis([]).aiCredits).toEqual({ value: "unknown" });
  });

  it("gives cache reads as a share of all input, over turns whose input is known", () => {
    const kpis = sessionKpis([
      turnWith({ uncachedInput: known(100), cacheRead: known(300), cacheWrite: known(100) }),
      turnWith({ uncachedInput: known(100), cacheRead: known(400), cacheWrite: unknown }),
      turnWith({ uncachedInput: unknown, cacheRead: unknown }),
    ]);

    expect(kpis.cacheRead).toEqual({ value: "70%", note: "2 of 3 turns known" });
  });

  it("says unknown, not 0%, when no turn's input is known", () => {
    expect(sessionKpis([turnWith({ uncachedInput: unknown, cacheRead: unknown })]).cacheRead).toEqual({ value: "unknown" });
  });

  it("counts turns, and tool calls with their failures", () => {
    const kpis = sessionKpis([
      turnWith({}, [
        { name: "Bash", argsSummary: "ls", outcome: { status: "success" } },
        { name: "Bash", argsSummary: "x", outcome: { status: "error", failureCategory: "command-not-found" } },
      ]),
      turnWith({}, [{ name: "read_file", argsSummary: "a.ts" }]),
    ]);

    expect(kpis.turns).toEqual({ value: "2" });
    expect(kpis.toolCalls).toEqual({ value: "3 · 1 failed" });
    expect(sessionKpis([turnWith({})]).toolCalls).toEqual({ value: "0" });
  });
});
