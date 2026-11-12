// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { requestTraceSchema, type Harness, type RequestTrace, type TraceRequest } from "@agent-cost-analyzer/domain";
import {
  CacheBreakClassifier,
  classifyCacheBreaks,
  CACHE_BREAK_CAVEAT_TEXT,
  NO_CHANGE_RECORDED_REASON,
  NOT_RECORDED_REASON,
  type CacheRules,
  type CacheRulesLookup,
  type PromptChangeMarker,
} from "./cache-break-classifier.js";

// Phase 16 SR4 (docs/plans/savings-report.md §4 O2–O4, §12 D7, §15): which
// requests of a session's request trace lost the cache, and why. Numbers are
// chosen so each rule is hit on its own: prompt = uncached + read + write.

const CLAUDE: CacheRules = { known: true, minCacheableTokens: 1024, lifetime: { minMinutes: 5, maxMinutes: 5 }, extendedLifetimeMinutes: 60 };
const GPT: CacheRules = { known: true, minCacheableTokens: 1024, lifetime: { minMinutes: 30, maxMinutes: 30 } };
const RANGE: CacheRules = { known: true, minCacheableTokens: 1024, lifetime: { minMinutes: 5, maxMinutes: 60 } };
const BEST_EFFORT_REASON = "xAI's caching is best-effort: no lifetime or minimum is documented.";

const RULES: Record<string, CacheRules> = {
  "claude-sonnet-5": CLAUDE,
  "claude-haiku-5.5": { ...CLAUDE, minCacheableTokens: 4096 },
  "gpt-6.1-sol": GPT,
  "range-model": RANGE,
  "grok-5": { known: false, reason: BEST_EFFORT_REASON },
};
const rules: CacheRulesLookup = (model) => RULES[model] ?? { known: false, reason: `no rules for ${model}` };

const START = Date.parse("2026-10-21T09:00:00.000Z");

type Step = Partial<Omit<TraceRequest, "index" | "startedAt">> & { atMinutes: number };

function trace(steps: Step[], harness: Harness = "vscode-local"): RequestTrace {
  return requestTraceSchema.parse({
    sessionId: "s1",
    providerId: harness === "claude-code" ? "claude-code" : "vscode",
    harness,
    notTraced: [],
    requests: steps.map(({ atMinutes, ...rest }, index) => ({
      index,
      turnIndex: index,
      startedAt: new Date(START + atMinutes * 60_000).toISOString(),
      model: "claude-sonnet-5",
      uncachedInput: 0,
      cacheRead: 0,
      cacheWrite: 0,
      output: 100,
      ...rest,
    })),
  });
}

// A warm request: the whole previous prompt read from cache, `added` new.
const warm = (atMinutes: number, prompt: number, extra: Partial<Step> = {}): Step => ({ atMinutes, cacheRead: prompt - 200, cacheWrite: 200, ...extra });
// A request that read `read` of a `prompt`-token prompt and wrote the rest.
const cold = (atMinutes: number, prompt: number, read = 0, extra: Partial<Step> = {}): Step => ({ atMinutes, cacheRead: read, cacheWrite: prompt - read, ...extra });

const classify = (steps: Step[], options: { harness?: Harness; promptChanges?: ReadonlyMap<number, PromptChangeMarker> } = {}) =>
  classifyCacheBreaks({ trace: trace(steps, options.harness), rules, ...(options.promptChanges ? { promptChanges: options.promptChanges } : {}) });

describe("classifyCacheBreaks: no break", () => {
  it("finds none in a session whose every request reads the previous prompt from cache", () => {
    const result = classify([cold(0, 10_000), warm(1, 10_400), warm(2, 10_800)]);
    expect(result).toMatchObject({ sessionId: "s1", providerId: "vscode", harness: "vscode-local", requests: 3, breaks: [], intended: [], unchecked: [] });
  });

  it("never counts the first request, which has nothing before it to lose", () => {
    expect(classify([cold(0, 50_000)]).breaks).toEqual([]);
  });

  it("counts a prompt under the vendor's minimum as no break: nothing of it was cacheable", () => {
    // Previous prompt 1000 < 1024: losing all of it is under the minimum.
    expect(classify([cold(0, 1000), cold(10, 1100)]).breaks).toEqual([]);
  });
});

describe("classifyCacheBreaks: the D7 threshold", () => {
  // Previous prompt 10,000; this one 10,000; lost = 10,000 - read.
  const lost = (tokens: number, model = "claude-sonnet-5") =>
    classify([cold(0, 10_000, 0, { model }), cold(1, 10_000, 10_000 - tokens, { model })]).breaks.map((b) => b.lostTokens);

  it("counts a break at exactly half the previous prompt and not one token under", () => {
    expect(lost(5000)).toEqual([5000]);
    expect(lost(4999)).toEqual([]);
  });

  it("counts a break at exactly the vendor's minimum cacheable tokens and not one token under", () => {
    // Previous prompt 2000: half is 1000, under claude-sonnet-5's 1024.
    const small = (tokens: number) => classify([cold(0, 2000), cold(1, 2000, 2000 - tokens)]).breaks.map((b) => b.lostTokens);
    expect(small(1024)).toEqual([1024]);
    expect(small(1023)).toEqual([]);
  });

  it("takes the minimum of this request's model", () => {
    // claude-haiku-5.5's minimum is 4096: a 4000-token loss is no break.
    const steps = [cold(0, 6000, 0, { model: "claude-haiku-5.5" }), cold(1, 6000, 2000, { model: "claude-haiku-5.5" })];
    expect(classify(steps).breaks).toEqual([]);
  });

  it("measures the loss against the smaller of the two prompts: a shrunk prompt cannot lose more than it sent", () => {
    // 20,000 then 3,000 with nothing read: 3,000 lost, under half of 20,000.
    expect(classify([cold(0, 20_000), cold(1, 3000)]).breaks).toEqual([]);
  });

  it("measures the prompt as uncached + read + write, with unknown writes inside uncached input", () => {
    const steps: Step[] = [
      { atMinutes: 0, uncachedInput: 10_000, cacheRead: 0, cacheWrite: null },
      { atMinutes: 1, uncachedInput: 8000, cacheRead: 2000, cacheWrite: null },
    ];
    const [found] = classify(steps).breaks;
    expect(found).toMatchObject({ previousPromptTokens: 10_000, promptTokens: 10_000, cacheRead: 2000, lostTokens: 8000, cacheWriteRecorded: false });
  });
});

describe("classifyCacheBreaks: idle expiry (O2)", () => {
  it("classes a break after a gap longer than the vendor's lifetime as idle expiry, with the gap and lifetime", () => {
    const result = classify([cold(0, 10_000), warm(1, 10_500), cold(7, 11_000, 300)]);
    expect(result.breaks).toEqual([
      {
        class: "idle-expiry",
        requestIndex: 2,
        turnIndex: 2,
        startedAt: "2026-10-21T09:07:00.000Z",
        model: "claude-sonnet-5",
        previousModel: "claude-sonnet-5",
        gapMinutes: 6,
        previousPromptTokens: 10_500,
        promptTokens: 11_000,
        cacheRead: 300,
        lostTokens: 10_200,
        cacheWriteRecorded: true,
        lifetime: { minMinutes: 5, maxMinutes: 5, basis: "vendor-default" },
        caveats: ["start-to-start-gap"],
      },
    ]);
  });

  it("uses a fixed lifetime of an automatic-prefix vendor (Copilot, GPT)", () => {
    const steps = [cold(0, 10_000, 0, { model: "gpt-6.1-sol" }), { atMinutes: 31, model: "gpt-6.1-sol", uncachedInput: 10_000, cacheRead: 0, cacheWrite: null }];
    const [found] = classify(steps).breaks;
    expect(found).toMatchObject({ class: "idle-expiry", gapMinutes: 31, lifetime: { minMinutes: 30, maxMinutes: 30, basis: "vendor-default" }, cacheWriteRecorded: false });
  });

  it("counts a gap of exactly the lifetime as within it", () => {
    const steps = [cold(0, 10_000, 0, { model: "gpt-6.1-sol" }), cold(30, 10_000, 0, { model: "gpt-6.1-sol" })];
    expect(classify(steps).breaks.map((b) => b.class)).toEqual(["unexplained"]);
  });

  it("takes the 1-hour lifetime once a request recorded 1-hour writes", () => {
    const steps = [cold(0, 10_000, 0, { extendedCacheWrite: 10_000 }), cold(30, 10_000), cold(91, 10_000)];
    const result = classify(steps);
    expect(result.breaks.map((b) => [b.requestIndex, b.class])).toEqual([
      [1, "unexplained"],
      [2, "idle-expiry"],
    ]);
    expect(result.breaks[1]).toMatchObject({ lifetime: { minMinutes: 60, maxMinutes: 60, basis: "recorded-1h-writes" } });
  });

  it("assumes Claude Code's 1-hour lifetime when its log records no lifetime, and says so", () => {
    const result = classify([cold(0, 10_000), cold(30, 10_000), cold(91, 10_000)], { harness: "claude-code" });
    expect(result.breaks.map((b) => [b.class, "lifetime" in b ? b.lifetime : undefined, b.caveats])).toEqual([
      ["unexplained", { minMinutes: 60, maxMinutes: 60, basis: "harness-default" }, ["lifetime-assumed"]],
      ["idle-expiry", { minMinutes: 60, maxMinutes: 60, basis: "harness-default" }, ["start-to-start-gap", "lifetime-assumed"]],
    ]);
  });

  it("flags a gap inside one turn: the agent was working, not the user away", () => {
    const steps = [cold(0, 10_000), cold(6, 10_000, 0, { turnIndex: 0 })];
    expect(classify(steps).breaks[0]?.caveats).toEqual(["start-to-start-gap", "gap-within-turn"]);
  });

  it("flags a gap inside a documented lifetime range", () => {
    const steps = [cold(0, 10_000, 0, { model: "range-model" }), cold(20, 10_000, 0, { model: "range-model" }), cold(81, 10_000, 0, { model: "range-model" })];
    const result = classify(steps);
    expect(result.breaks.map((b) => [b.class, b.caveats])).toEqual([
      ["idle-expiry", ["start-to-start-gap", "gap-within-lifetime-range"]],
      ["idle-expiry", ["start-to-start-gap"]],
    ]);
  });

  it("keeps a recorded prompt change on an idle expiry as a caveat, not a second class", () => {
    const promptChanges = new Map<number, PromptChangeMarker>([[1, { tools: true }]]);
    expect(classify([cold(0, 10_000), cold(10, 10_000)], { promptChanges }).breaks[0]).toMatchObject({
      class: "idle-expiry",
      caveats: ["start-to-start-gap", "prompt-also-changed"],
    });
  });
});

describe("classifyCacheBreaks: model switch (O4)", () => {
  it("classes a break on a changed model as a model switch, from the model ids even without a trace event", () => {
    const result = classify([cold(0, 10_000), cold(1, 10_000, 0, { model: "gpt-6.1-sol" })]);
    expect(result.breaks).toEqual([
      expect.objectContaining({ class: "model-switch", model: "gpt-6.1-sol", previousModel: "claude-sonnet-5", lostTokens: 10_000, caveats: [] }),
    ]);
  });

  it("says when the gap also exceeded the previous model's lifetime", () => {
    const result = classify([cold(0, 10_000), cold(6, 10_000, 0, { model: "gpt-6.1-sol", event: "model-switch" })]);
    expect(result.breaks[0]).toMatchObject({ class: "model-switch", caveats: ["lifetime-also-exceeded"] });
  });

  it("is no break when the new model still read the cache", () => {
    expect(classify([cold(0, 10_000), warm(1, 10_400, { model: "claude-haiku-5.5", event: "model-switch" })]).breaks).toEqual([]);
  });
});

describe("classifyCacheBreaks: compaction and clear are intended, not breaks", () => {
  it("leaves out a break the log marks as a compaction, listing it as intended", () => {
    const result = classify([cold(0, 30_000), cold(1, 20_000, 0, { event: "compaction" })]);
    expect(result.breaks).toEqual([]);
    // The shrink is the compaction's, so it carries no prompt-shrank caveat.
    expect(result.intended).toEqual([expect.objectContaining({ event: "compaction", requestIndex: 1, lostTokens: 20_000, caveats: [] })]);
  });

  it("leaves out a clear", () => {
    const result = classify([cold(0, 30_000), cold(1, 20_000, 0, { event: "clear" })]);
    expect(result.breaks).toEqual([]);
    expect(result.intended.map((r) => r.event)).toEqual(["clear"]);
  });

  it("puts a compaction ahead of a model switch and an idle gap", () => {
    const result = classify([cold(0, 30_000), cold(90, 20_000, 0, { event: "compaction", model: "gpt-6.1-sol" })]);
    expect(result.breaks).toEqual([]);
    expect(result.intended).toHaveLength(1);
  });

  it("lists a compaction as intended, not unchecked, when the vendor documents no rules", () => {
    const result = classify([cold(0, 30_000, 0, { model: "grok-5" }), cold(1, 20_000, 0, { model: "grok-5", event: "compaction" })]);
    expect(result.unchecked).toEqual([]);
    expect(result.intended.map((r) => r.requestIndex)).toEqual([1]);
  });

  it("lists nothing as intended when the compaction kept the cache", () => {
    expect(classify([cold(0, 30_000), warm(1, 30_000, { event: "compaction" })]).intended).toEqual([]);
  });
});

describe("classifyCacheBreaks: unexplained (O3) and its cause", () => {
  const unexplained = (promptChanges?: ReadonlyMap<number, PromptChangeMarker>) => {
    const [found] = classify([cold(0, 10_000), cold(2, 10_000)], promptChanges ? { promptChanges } : {}).breaks;
    if (found?.class !== "unexplained") throw new Error(`expected an unexplained break, got ${found?.class}`);
    return found;
  };
  const marker = (value: PromptChangeMarker) => new Map([[1, value]]);

  it("says the cause is not recorded when the log gives no signal", () => {
    expect(unexplained()).toMatchObject({
      class: "unexplained",
      gapMinutes: 2,
      lifetime: { minMinutes: 5, maxMinutes: 5, basis: "vendor-default" },
      cause: { recorded: false, reason: NOT_RECORDED_REASON },
      caveats: [],
    });
  });

  it("names a changed tool list", () => {
    expect(unexplained(marker({ tools: true, instructions: false })).cause).toEqual({ recorded: true, changes: ["tools-changed"] });
  });

  it("names changed instructions, which explain a changed system prompt", () => {
    expect(unexplained(marker({ systemPrompt: true, instructions: true })).cause).toEqual({ recorded: true, changes: ["instructions-changed"] });
  });

  it("names a changed system prompt with no recorded cause when the instructions did not change", () => {
    expect(unexplained(marker({ tools: false, systemPrompt: true, instructions: false })).cause).toEqual({ recorded: true, changes: ["system-prompt-changed"] });
  });

  it("names every recorded change, tools first", () => {
    expect(unexplained(marker({ tools: true, systemPrompt: true, instructions: true })).cause).toEqual({ recorded: true, changes: ["tools-changed", "instructions-changed"] });
  });

  it("says the provider may have evicted the cache when the log records all three signals unchanged", () => {
    expect(unexplained(marker({ tools: false, systemPrompt: false, instructions: false })).cause).toEqual({ recorded: false, reason: NO_CHANGE_RECORDED_REASON });
  });

  it("keeps 'not recorded' when some signals are missing and none changed (Claude Code has no system-prompt signal)", () => {
    expect(unexplained(marker({ tools: false, instructions: false })).cause).toEqual({ recorded: false, reason: NOT_RECORDED_REASON });
  });

  it("ignores a marker on another request", () => {
    expect(unexplained(new Map([[0, { tools: true }]])).cause).toEqual({
      recorded: false,
      reason: NOT_RECORDED_REASON,
    });
  });

  it("flags a prompt that shrank with no event: messages may have been removed", () => {
    // 20,000 then 12,000, 2,000 read: 10,000 lost, half of 20,000.
    expect(classify([cold(0, 20_000), cold(1, 12_000, 2000)]).breaks[0]).toMatchObject({ class: "unexplained", lostTokens: 10_000, caveats: ["prompt-shrank"] });
  });
});

describe("classifyCacheBreaks: requests whose vendor documents no caching rules", () => {
  it("lists a possible break as unchecked with the reason, never as no break or a guessed class", () => {
    const result = classify([cold(0, 10_000, 0, { model: "grok-5" }), cold(40, 10_000, 0, { model: "grok-5" })]);
    expect(result.breaks).toEqual([]);
    expect(result.unchecked).toEqual([{ requestIndex: 1, turnIndex: 1, model: "grok-5", lostTokens: 10_000, reason: BEST_EFFORT_REASON }]);
  });

  it("does not list a request that kept at least half of the previous prompt", () => {
    expect(classify([cold(0, 10_000, 0, { model: "grok-5" }), warm(1, 10_400, { model: "grok-5" })]).unchecked).toEqual([]);
  });

  it("keeps a switch to a documented model a model switch after an unchecked request", () => {
    const result = classify([cold(0, 10_000, 0, { model: "grok-5" }), cold(40, 10_000, 0, { model: "grok-5" }), cold(41, 10_000, 0)]);
    // Request 2 switched to a documented model: still a model switch.
    expect(result.breaks.map((b) => [b.requestIndex, b.class, b.caveats])).toEqual([[2, "model-switch", []]]);
    expect(result.unchecked.map((u) => u.requestIndex)).toEqual([1]);
  });
});

describe("CACHE_BREAK_CAVEAT_TEXT", () => {
  it("has a sentence for every caveat code", () => {
    for (const text of Object.values(CACHE_BREAK_CAVEAT_TEXT)) expect(text).toMatch(/^[A-Z].+\.$/);
    expect(Object.keys(CACHE_BREAK_CAVEAT_TEXT).sort()).toEqual(
      ["gap-within-lifetime-range", "gap-within-turn", "lifetime-also-exceeded", "lifetime-assumed", "prompt-also-changed", "prompt-shrank", "start-to-start-gap"].sort(),
    );
  });
});

describe("CacheBreakClassifier", () => {
  it("classifies with the rules it was built with, as classifyCacheBreaks does", () => {
    const steps = [cold(0, 10_000), cold(2, 10_000)];
    const promptChanges = new Map<number, PromptChangeMarker>([[1, { tools: true }]]);
    expect(new CacheBreakClassifier(rules).classify(trace(steps), promptChanges)).toEqual(classify(steps, { promptChanges }));
  });
});
