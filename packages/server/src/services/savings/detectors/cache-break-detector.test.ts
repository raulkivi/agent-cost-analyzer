// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { requestTraceSchema, savingsActionText, savingsOpportunitySchema, type Harness, type SavingsAmount, type RequestTrace, type TraceRequest } from "@agent-cost-analyzer/domain";
import { ANTHROPIC, COPILOT, savingsInput, session, sessionInput } from "../../../test-support/savings-fakes.js";
import { loadVendorProfiles } from "../../../data-sources/vendor-profiles/loader.js";
import { cacheRulesFromProfiles } from "../cache-rules.js";
import type { CacheRules, CacheRulesLookup, PromptChangeMarker } from "../cache-break-classifier.js";
import { CacheBreakDetector } from "./cache-break-detector.js";

// Phase 16 SR6 (docs/plans/savings-report.md §4 O2–O4, §7): cache breaks of
// each session's request trace, priced as an upper bound (low 0: a break is
// not always avoidable). Golden figures are hand-computed from the bundled
// price book, claude-sonnet-5 from 2026-10-01 (USD per million tokens: input
// 2, cache read 0.2, 1-hour write 4, 5-minute write 2.5; on GitHub Copilot
// 1 AI Credit = $0.01: 200, 20, 250).
const CLAUDE_RULES: CacheRules = { known: true, minCacheableTokens: 1024, lifetime: { minMinutes: 5, maxMinutes: 5 }, extendedLifetimeMinutes: 60 };
const rules: CacheRulesLookup = (model) => (model === "grok-5" ? { known: false, reason: "xAI documents no cache lifetime." } : CLAUDE_RULES);
const START = Date.parse("2026-10-21T09:00:00.000Z");
const WEEKS = 30 / 7;
const detector = new CacheBreakDetector();

type Step = Partial<Omit<TraceRequest, "index" | "startedAt">> & { atMinutes: number };

function trace(steps: Step[], harness: Harness = "claude-code"): RequestTrace {
  return requestTraceSchema.parse({
    sessionId: "s",
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

const warm = (atMinutes: number, prompt: number, extra: Partial<Step> = {}): Step => ({ atMinutes, cacheRead: prompt - 200, cacheWrite: 200, ...extra });
const cold = (atMinutes: number, prompt: number, extra: Partial<Step> = {}): Step => ({ atMinutes, cacheRead: 0, cacheWrite: prompt, ...extra });

function claudeSession(id: string, steps: Step[], promptChanges?: ReadonlyMap<number, PromptChangeMarker>) {
  return sessionInput(session(id), { trace: trace(steps), ...(promptChanges ? { promptChanges } : {}) });
}

const run = (...sessions: ReturnType<typeof claudeSession>[]) => detector.detect(savingsInput(sessions, { cacheRules: rules }));
const high = (amount: SavingsAmount): number => (amount.known ? amount.high : Number.NaN);

describe("CacheBreakDetector: idle expiry (O2)", () => {
  // 90 minutes idle, past Claude Code's 1-hour cache: 10,400 tokens lost.
  const idle = claudeSession("idle", [cold(0, 10_000), warm(1, 10_400), cold(91, 10_600)]);

  it("prices the rebuilt tokens as an upper bound: lost tokens × (1-hour write or uncached − cache read)", () => {
    const { opportunities, notAnalysed } = run(idle);

    expect(notAnalysed).toEqual([]);
    expect(opportunities).toHaveLength(1);
    const [opportunity] = opportunities;
    expect(opportunity).toMatchObject({
      key: "idle-cache-expiry:USD:60",
      kind: "idle-cache-expiry",
      subject: "Idle longer than 60 minutes",
      sessions: [{ providerId: "claude-code", sessionId: "idle" }],
      evidence: { sessions: 1, requests: 3, tokens: { known: true, value: 10_400 }, occurrences: 1 },
      actionParams: { breaks: 1, minutes: 60, tokens: 10_400 },
      // Claude Code's 1-hour lifetime is assumed, not recorded.
      inferred: true,
      coverage: { sessionsInWindow: 1, sessionsAnalysed: 1, notAnalysed: [] },
    });
    // 10,400 × (4 − 0.2) / 1e6, the 1-hour write price being the dearer.
    expect(opportunity!.perWindow).toMatchObject({ known: true, currency: "USD", basis: "priced", label: "upper-bound", low: 0, priceVersionIds: ["anthropic-api:claude-sonnet-5:2026-10-01"] });
    expect(high(opportunity!.perWindow)).toBeCloseTo(0.03952, 9);
    expect(high(opportunity!.perWeek)).toBeCloseTo(0.03952 / WEEKS, 9);
    expect(savingsOpportunitySchema.safeParse(opportunity).success).toBe(true);
    expect(() => savingsActionText("idle-cache-expiry", opportunity!.actionParams)).not.toThrow();
  });

  it("keeps lifetimes apart, and names the extended lifetime when the vendor offers one the log doesn't show in use", () => {
    const { opportunities } = detector.detect(
      savingsInput([sessionInput(session("p", { providerId: "vscode" }), { trace: trace([cold(0, 10_000), cold(30, 10_000)], "vscode-local"), channel: ANTHROPIC }), idle], { cacheRules: rules }),
    );

    expect(opportunities.map((o) => o.key).sort()).toEqual(["idle-cache-expiry:USD:5", "idle-cache-expiry:USD:60"]);
    const fiveMinutes = opportunities.find((o) => o.key.endsWith(":5"))!;
    expect(fiveMinutes.actionParams).toMatchObject({ minutes: 5, extendedMinutes: 60 });
  });

  it("prices GitHub Copilot in AI Credits with unrecorded cache writes as a write or plain input", () => {
    const steps: Step[] = [
      { atMinutes: 0, uncachedInput: 10_000, cacheRead: 0, cacheWrite: null },
      { atMinutes: 2, uncachedInput: 600, cacheRead: 9800, cacheWrite: null },
      { atMinutes: 40, uncachedInput: 10_600, cacheRead: 0, cacheWrite: null },
    ];
    const local = sessionInput(session("cp", { providerId: "vscode" }), { trace: trace(steps, "vscode-local"), channel: COPILOT });

    const { opportunities } = detector.detect(savingsInput([local], { cacheRules: rules }));

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({ key: "idle-cache-expiry:AI_CREDITS:5", inferred: false });
    // 10,400 × (250 − 20) / 1e6: the 5-minute write price, the dearer of write and input.
    expect(high(opportunities[0]!.perWindow)).toBeCloseTo(2.392, 9);
  });
});

describe("CacheBreakDetector: unexplained breaks (O3)", () => {
  const steps = [cold(0, 10_000), warm(1, 10_400), cold(2, 10_600)];

  it("names the cause only where the log records it", () => {
    const withTools = claudeSession("t", steps, new Map([[2, { tools: true, instructions: false }]]));
    const unknown = claudeSession("u", steps);

    const { opportunities } = run(withTools, unknown);

    expect(opportunities.map((o) => [o.key, o.subject, o.inferred])).toEqual([
      ["unexplained-cache-break:USD:tools-changed", "Tool list changed", false],
      ["unexplained-cache-break:USD:unrecorded", "Cause not recorded", true],
    ]);
    expect(opportunities[0]).toMatchObject({ evidence: { occurrences: 1, tokens: { known: true, value: 10_400 } }, actionParams: { breaks: 1, tokens: 10_400 } });
    // 10,400 × (4 − 0.2) / 1e6
    expect(high(opportunities[0]!.perWindow)).toBeCloseTo(0.03952, 9);
    expect(() => savingsActionText("unexplained-cache-break", opportunities[0]!.actionParams)).not.toThrow();
  });

  it("says a system-prompt change has no recorded cause, and instructions explain it when they changed too", () => {
    const system = claudeSession("sys", steps, new Map([[2, { systemPrompt: true, instructions: false }]]));
    const instructions = claudeSession("ins", steps, new Map([[2, { systemPrompt: true, instructions: true }]]));

    const { opportunities } = run(system, instructions);

    expect(opportunities.map((o) => o.subject).sort()).toEqual(["Instructions changed", "System prompt changed, cause not recorded"]);
  });
});

describe("CacheBreakDetector: model switch (O4)", () => {
  it("is its own opportunity, priced at the new model, with the average tokens resent per switch", () => {
    const switched = claudeSession("m", [cold(0, 10_000), warm(1, 10_400), cold(2, 10_600, { model: "claude-opus-5" })]);

    const { opportunities } = run(switched);

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({
      key: "model-switch:USD",
      kind: "model-switch",
      subject: "Model switches",
      inferred: false,
      evidence: { occurrences: 1 },
      actionParams: { times: 1, tokens: 10_400 },
      perWindow: { known: true, label: "upper-bound", low: 0 },
    });
    expect(high(opportunities[0]!.perWindow)).toBeGreaterThan(0);
    expect(() => savingsActionText("model-switch", opportunities[0]!.actionParams)).not.toThrow();
  });
});

describe("CacheBreakDetector: what is not a saving", () => {
  it("ignores a compaction: the rebuild was intended", () => {
    const compacted = claudeSession("c", [cold(0, 10_000), warm(1, 10_400), cold(2, 3000, { event: "compaction" })]);

    expect(run(compacted)).toEqual({ opportunities: [], notAnalysed: [] });
  });

  it("finds nothing in a session that always read its cache", () => {
    expect(run(claudeSession("w", [cold(0, 10_000), warm(1, 10_400), warm(2, 10_800)]))).toEqual({ opportunities: [], notAnalysed: [] });
  });
});

describe("CacheBreakDetector: Not analysed (never 0)", () => {
  it("lists a session with no trace by provider, with the provider's reason or a default", () => {
    const withReason = sessionInput(session("pi", { providerId: "pi-agent" }), { traceUnavailableReason: "pi writes no request trace yet." });
    const plain = sessionInput(session("mm", { providerId: "mitmproxy" }));
    const empty = sessionInput(session("e"), { trace: trace([]) });

    const { opportunities, notAnalysed } = detector.detect(savingsInput([withReason, plain, empty], { cacheRules: rules }));

    expect(opportunities).toEqual([]);
    expect(notAnalysed).toEqual([
      { kind: "idle-cache-expiry", providerId: "claude-code", reason: "The request trace has no requests.", sessions: 1 },
      { kind: "idle-cache-expiry", providerId: "mitmproxy", reason: "This provider's log records no request trace, so cache breaks can't be found.", sessions: 1 },
      { kind: "idle-cache-expiry", providerId: "pi-agent", reason: "pi writes no request trace yet.", sessions: 1 },
    ]);
  });

  it("lists requests the vendor documents no rules for, and keeps the session's other findings", () => {
    const mixed = claudeSession("x", [cold(0, 10_000), warm(1, 10_400), cold(91, 10_600), cold(92, 10_600, { model: "grok-5" })]);

    const { opportunities, notAnalysed } = run(mixed);

    expect(notAnalysed).toEqual([{ kind: "idle-cache-expiry", providerId: "claude-code", reason: "xAI documents no cache lifetime.", sessions: 1 }]);
    expect(opportunities.map((o) => o.kind)).toEqual(["idle-cache-expiry"]);
    expect(opportunities[0]!.coverage).toEqual({ sessionsInWindow: 1, sessionsAnalysed: 0, notAnalysed: [{ reason: "xAI documents no cache lifetime.", sessions: 1 }] });
  });

  it("lists a session with an unknown channel", () => {
    const idle = sessionInput(session("i"), { trace: trace([cold(0, 10_000), warm(1, 10_400), cold(91, 10_600)]), channel: { known: false, reason: "No channel." } });

    const { opportunities, notAnalysed } = detector.detect(savingsInput([idle], { cacheRules: rules }));

    expect(opportunities).toEqual([]);
    expect(notAnalysed).toEqual([{ kind: "idle-cache-expiry", providerId: "claude-code", reason: "No channel.", sessions: 1 }]);
  });

  it("gives an unknown amount with the price book's reason when a model has no price", () => {
    const odd = claudeSession("o", [cold(0, 10_000, { model: "no-such-model" }), cold(91, 10_000, { model: "no-such-model" })]);

    const { opportunities } = run(odd);

    expect(opportunities[0]).toMatchObject({
      perWindow: { known: false, reason: expect.any(String) },
      perWeek: { known: false },
      evidence: { occurrences: 1, tokens: { known: true, value: 10_000 } },
    });
  });
});

describe("CacheBreakDetector: golden report", () => {
  it("over a multi-session, multi-provider window with the real vendor profiles (update with `vitest -u` after checking the diff by hand)", async () => {
    const profiles = loadVendorProfiles(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/vendor-profiles"));
    const claude = claudeSession(
      "cc",
      [cold(0, 10_000), warm(1, 10_400), cold(91, 10_600), warm(92, 10_800), cold(93, 11_000), cold(94, 11_200, { model: "claude-opus-5" }), cold(95, 11_400, { event: "compaction" })],
      new Map([[4, { tools: true, instructions: false }]]),
    );
    const copilot = sessionInput(session("cp", { providerId: "vscode" }), {
      channel: COPILOT,
      trace: trace(
        [
          { atMinutes: 0, uncachedInput: 10_000, cacheRead: 0, cacheWrite: null },
          { atMinutes: 2, uncachedInput: 600, cacheRead: 9800, cacheWrite: null },
          { atMinutes: 40, uncachedInput: 10_600, cacheRead: 0, cacheWrite: null },
          { atMinutes: 41, uncachedInput: 12_000, cacheRead: 0, cacheWrite: null },
        ],
        "vscode-local",
      ),
      promptChanges: new Map([[3, { tools: false, systemPrompt: true, instructions: false }]]),
    });
    const agentHost = sessionInput(session("ah", { providerId: "vscode", copilotHarness: "agent-host" }), {
      channel: COPILOT,
      trace: trace([{ atMinutes: 0, uncachedInput: 10_000, cacheRead: 0, cacheWrite: null }, { atMinutes: 1, uncachedInput: 10_400, cacheRead: 0, cacheWrite: null }], "copilot-agent-host"),
    });
    const pi = sessionInput(session("pi", { providerId: "pi-agent" }), { traceUnavailableReason: "pi writes no request trace yet." });

    const result = detector.detect(savingsInput([claude, copilot, agentHost, pi], { cacheRules: cacheRulesFromProfiles(profiles) }));

    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot("../__golden__/savings-cache-breaks-report.json");
  });
});
