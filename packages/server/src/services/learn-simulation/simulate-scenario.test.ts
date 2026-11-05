import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  sessionSchema,
  type ScenarioScript,
  type ScriptEvent,
  type VendorProfile,
} from "@agent-cost-analyzer/domain";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import { simulateScenario } from "./simulate-scenario.js";

const dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/vendor-profiles",
);
const profiles = loadVendorProfiles(dir);
const profile = (id: string): VendorProfile =>
  profiles.find((p) => p.vendorId === id)!;
const anthropic = profile("anthropic");
const xai = profile("xai");

function step(
  index: number,
  events: ScriptEvent[] = [],
  extra: Partial<ScenarioScript["steps"][number]> = {},
): ScenarioScript["steps"][number] {
  return {
    index,
    userMessage: `u${index}`,
    assistantResponse: `a${index}`,
    toolCalls: [],
    explanation: `e${index}`,
    newContent: {
      userTokens: 200,
      toolResultTokens: 300,
      reasoningTokens: 0,
      outputTokens: 100,
    },
    events,
    ...extra,
  };
}
const script = (
  steps: ScenarioScript["steps"],
  extra: Partial<ScenarioScript> = {},
): ScenarioScript => ({
  id: "t",
  title: "T",
  category: "C",
  harnesses: ["claude-code"],
  sessionKind: "main",
  staticPrefix: { toolsTokens: 3000, systemTokens: 1000 },
  steps,
  ...extra,
});
const run = (s: ScenarioScript, p = anthropic, modelId = "claude-sonnet-5.5") =>
  simulateScenario(s, { profile: p, modelId, harness: "claude-code" });
const known = (c: unknown) => (c as { known: true; value: number }).value;

describe("simulateScenario", () => {
  it("produces a schema-valid learn Session with one turn per step", () => {
    const session = run(script([step(1), step(2), step(3)]));
    expect(() => sessionSchema.parse(session)).not.toThrow();
    expect(session).toMatchObject({ id: "t", mode: "learn", turnCount: 3 });
  });

  it("S2: a first turn writes its whole prompt, later turns read the prefix", () => {
    const [t1, t2] = run(script([step(1), step(2)])).turns;
    expect(known(t1!.usage.cacheWrite)).toBe(4500);
    expect(known(t1!.usage.cacheRead)).toBe(0);
    expect(known(t2!.usage.cacheRead)).toBe(4500);
    // step 2 adds the previous output (100) plus its own 500 new tokens
    expect(known(t2!.usage.cacheWrite)).toBe(600);
    expect(t2!.simulation?.cacheOutcome).toBe("hit");
  });

  it("prices turns with the chosen model's real prices", () => {
    const [t1] = run(script([step(1)])).turns;
    // 4500 written at 2.5/M + 100 output at 10/M = $0.01225 = 1.225 credits
    expect(known(t1!.usage.costAiCredits)).toBeCloseTo(1.225, 6);
  });

  it("S8: an image invalidates from messages and is converted from pixels", () => {
    const images = [{ width: 280, height: 280 }];
    const s = script([
      step(1),
      step(2, [{ type: "image-added" }], {
        newContent: {
          userTokens: 200,
          toolResultTokens: 0,
          reasoningTokens: 0,
          outputTokens: 100,
          images,
        },
      }),
    ]);
    const t2 = run(s).turns[1]!;
    expect(known(t2.usage.vision)).toBe(100); // ceil(280/28)^2
    expect(known(t2.usage.cacheRead)).toBe(4000); // tools + system
    expect(t2.simulation).toMatchObject({
      cacheOutcome: "partial",
      invalidatedFrom: "messages",
      confidence: "documented",
    });
    expect(t2.triggeredEvent).toBe("image-change");
  });

  it("S10: a tools change invalidates everything", () => {
    const t2 = run(
      script([step(1), step(2, [{ type: "tools-changed", deltaTokens: 500 }])]),
    ).turns[1]!;
    expect(known(t2.usage.cacheRead)).toBe(0);
    expect(t2.simulation?.cacheOutcome).toBe("miss");
  });

  it("S12: switching to the cheaper sibling starts an empty cache at its price", () => {
    const session = run(
      script([step(1), step(2, [{ type: "model-switch", toRole: "cheaper" }])]),
    );
    const t2 = session.turns[1]!;
    expect(t2.usage.model).toBe("claude-haiku-5.5");
    expect(known(t2.usage.cacheRead)).toBe(0);
    expect(t2.triggeredEvent).toBe("model-switch");
  });

  it("S13: compaction reads the warm prefix, then the summary restarts messages", () => {
    const s = script([
      step(1),
      step(2, [{ type: "compaction", summaryTokens: 400 }]),
      step(3),
    ]);
    const [, t2, t3] = run(s).turns;
    expect(t2!.simulation?.cacheOutcome).toBe("hit");
    expect(known(t3!.usage.cacheRead)).toBe(4000); // tools + system only
    expect(t3!.simulation?.invalidatedFrom).toBe("messages");
  });

  it("S14: clear drops messages but tools and system still hit", () => {
    const s = script([step(1), step(2), step(3, [{ type: "clear" }])]);
    const t3 = run(s).turns[2]!;
    expect(known(t3.usage.cacheRead)).toBe(4000);
    expect(known(t3.usage.cacheWrite)).toBe(500);
  });

  it("S15: rewind reuses the prefix up to the chosen step", () => {
    const s = script([
      step(1),
      step(2),
      step(3),
      step(4, [{ type: "rewind", toStep: 2 }]),
    ]);
    const t4 = run(s).turns[3]!;
    // after step 2: tools+system 4000 + (500+100) + (500+100) = 5200 cached
    expect(known(t4.usage.cacheRead)).toBe(5200);
    expect(known(t4.usage.cacheWrite)).toBe(500);
    expect(t4.simulation?.cacheOutcome).toBe("partial");
  });

  it("rejects a rewind or fork that points at a step not yet played", () => {
    expect(() =>
      run(
        script([
          step(1),
          step(2, [{ type: "fork", branch: "A", fromStep: 2 }]),
        ]),
      ),
    ).toThrow(/fromStep/);
    expect(() =>
      run(script([step(1), step(2, [{ type: "rewind", toStep: 5 }])])),
    ).toThrow(/toStep/);
  });

  it("S4: idle time past the TTL makes the next turn a miss (cache-expiry)", () => {
    const t2 = run(script([step(1), step(2, [], { idleMinutesBefore: 6 })]))
      .turns[1]!;
    expect(known(t2.usage.cacheRead)).toBe(0);
    expect(t2.simulation?.cacheOutcome).toBe("miss");
    expect(t2.triggeredEvent).toBe("cache-expiry");
  });

  it("S5: extended-ttl writes cost more and survive a long idle", () => {
    const s = script([
      step(1, [{ type: "extended-ttl" }]),
      step(2, [], { idleMinutesBefore: 30 }),
    ]);
    const [t1, t2] = run(s).turns;
    // 4500 at the 4.0/M extended write rate + 100 output at 10/M
    expect(known(t1!.usage.costAiCredits)).toBeCloseTo(1.9, 6);
    expect(t2!.simulation?.cacheOutcome).toBe("hit");
  });

  it("an unknown rule makes the turn's cache fields and cost unavailable, not zero", () => {
    const s = script([step(1), step(2, [{ type: "image-added" }])]);
    const t2 = run(s, xai, "grok-4.7").turns[1]!;
    expect(t2.simulation).toMatchObject({
      cacheOutcome: "unknown",
      confidence: "unknown",
      sourceIds: [],
    });
    expect(t2.usage.cacheRead.known).toBe(false);
    expect(t2.usage.cacheWrite.known).toBe(false);
    expect(t2.usage.costAiCredits.known).toBe(false);
  });

  it("a session with an unknown turn has an unavailable total", () => {
    const s = script([step(1), step(2, [{ type: "image-added" }])]);
    expect(run(s, xai, "grok-4.7").costAiCredits.known).toBe(false);
  });

  it("uses the harness-specific text when the script has it", () => {
    const s = script([step(1)], {
      harnesses: ["claude-code", "vscode-local"],
      textByHarness: {
        "vscode-local": { title: "VS Code title", explanations: ["vs e1"] },
      },
    });
    const session = simulateScenario(s, {
      profile: anthropic,
      modelId: "claude-sonnet-5.5",
      harness: "vscode-local",
    });
    expect(session.title).toBe("VS Code title");
    expect(session.turns[0]!.explanation).toBe("vs e1");
  });

  it("rejects a harness the script does not apply to", () => {
    expect(() =>
      simulateScenario(script([step(1)]), {
        profile: anthropic,
        modelId: "claude-sonnet-5.5",
        harness: "vscode-local",
      }),
    ).toThrow(/harness/);
  });
});
