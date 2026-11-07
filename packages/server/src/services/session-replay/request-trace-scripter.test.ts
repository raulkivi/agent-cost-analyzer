// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  requestTraceSchema,
  scenarioScriptSchema,
  type RequestTrace,
  type ScriptEvent,
  type TraceRequest,
} from "@agent-cost-analyzer/domain";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import {
  calibrationCaptureSchema,
  requestInputTokens,
} from "../learn-simulation/calibration/capture.js";
import { traceFromCapture } from "../learn-simulation/calibration/replay.js";
import { simulateScenario } from "../learn-simulation/simulate-scenario.js";
import {
  EmptyRequestTraceError,
  RequestTraceScripter,
  scriptFromRequestTrace,
} from "./request-trace-scripter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../../fixtures");
const profile = loadVendorProfiles(path.join(fixtures, "vendor-profiles")).find(
  (p) => p.vendorId === "anthropic",
)!;
// Has a cheaper sibling (claude-haiku-5.5), so model switches can simulate.
const MODEL = "claude-sonnet-5.5";

const BASE = Date.parse("2026-11-01T10:00:00.000Z");
const at = (minutes: number): string =>
  new Date(BASE + Math.round(minutes * 60_000)).toISOString();

type Shape = Partial<TraceRequest> & { input?: number; minute?: number };
// A request whose whole input is cache read unless the shape says otherwise.
const req = (index: number, shape: Shape = {}): TraceRequest => {
  const { input, minute, ...rest } = shape;
  return {
    index,
    turnIndex: index,
    startedAt: at(minute ?? index),
    model: MODEL,
    uncachedInput: 0,
    cacheRead: input ?? 0,
    cacheWrite: 0,
    output: 100,
    ...rest,
  };
};
const trace = (requests: TraceRequest[]): RequestTrace =>
  requestTraceSchema.parse({
    sessionId: "s1",
    providerId: "claude-code",
    harness: "claude-code",
    requests,
    notTraced: [],
  });

const inputOf = (r: TraceRequest): number =>
  r.uncachedInput + r.cacheRead + (r.cacheWrite ?? 0);

const simulate = (t: RequestTrace) =>
  simulateScenario(scriptFromRequestTrace(t), {
    profile,
    modelId: MODEL,
    harness: t.harness,
    harnessCacheDefaults: false,
  });

const simulatedInput = (turn: ReturnType<typeof simulate>["turns"][number]) => {
  const { uncachedInput, cacheRead, cacheWrite } = turn.usage;
  if (!uncachedInput.known || !cacheRead.known || !cacheWrite.known) return NaN;
  return uncachedInput.value + cacheRead.value + cacheWrite.value;
};

const eventsOf = (t: RequestTrace): ScriptEvent[][] =>
  scriptFromRequestTrace(t).steps.map((s) => s.events);

describe("scriptFromRequestTrace", () => {
  it("throws for a trace with no requests", () => {
    expect(() => scriptFromRequestTrace(trace([]))).toThrow(
      EmptyRequestTraceError,
    );
  });

  it("scripts a growing conversation: the first prompt is the prefix, each step adds what is new", () => {
    const script = scriptFromRequestTrace(
      trace([
        req(0, { input: 5000, output: 100 }),
        req(1, { input: 5600, output: 200 }),
        req(2, { input: 6000, output: 50 }),
      ]),
    );
    expect(scenarioScriptSchema.parse(script)).toEqual(script);
    expect(script).toMatchObject({
      id: "s1",
      title: "s1",
      category: "replay",
      harnesses: ["claude-code"],
      sessionKind: "main",
      staticPrefix: { toolsTokens: 2500, systemTokens: 2500 },
    });
    expect(script.steps.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(script.steps.map((s) => s.newContent.userTokens)).toEqual([
      0, 500, 200,
    ]);
    expect(script.steps.map((s) => s.newContent.outputTokens)).toEqual([
      100, 200, 50,
    ]);
    expect(script.steps[0]).toMatchObject({
      userMessage: "",
      assistantResponse: "",
      toolCalls: [],
      explanation: "",
    });
    expect(script.steps.every((s) => s.events.length === 0)).toBe(true);
  });

  it("is the class's script method too", () => {
    const t = trace([req(0, { input: 1000 }), req(1, { input: 1200 })]);
    expect(new RequestTraceScripter().script(t)).toEqual(
      scriptFromRequestTrace(t),
    );
  });

  it("counts null cache writes as inside the uncached input and never invents a write", () => {
    const t = trace([
      req(0, { uncachedInput: 4000, cacheWrite: null }),
      req(1, { uncachedInput: 300, cacheRead: 4000, cacheWrite: null }),
    ]);
    const script = scriptFromRequestTrace(t);
    expect(script.staticPrefix).toEqual({
      toolsTokens: 2000,
      systemTokens: 2000,
    });
    expect(script.steps[1]!.newContent.userTokens).toBe(200);
    expect(simulate(t).turns.map(simulatedInput)).toEqual([4000, 4300]);
  });

  it("bills reasoning but does not carry it into the next prompt", () => {
    const t = trace([
      req(0, { input: 3000, output: 500, reasoning: 400 }),
      req(1, { input: 3150 }),
    ]);
    const [first, second] = scriptFromRequestTrace(t).steps;
    expect(first!.newContent).toMatchObject({
      reasoningTokens: 400,
      outputTokens: 100,
    });
    expect(second!.newContent.userTokens).toBe(50);
    expect(simulate(t).turns.map(simulatedInput)).toEqual([3000, 3150]);
  });

  it("clamps carried output at zero when the log reports more reasoning than output", () => {
    const t = trace([req(0, { input: 3000, output: 10, reasoning: 40 })]);
    expect(scriptFromRequestTrace(t).steps[0]!.newContent).toMatchObject({
      reasoningTokens: 40,
      outputTokens: 0,
    });
  });

  it("turns a shrinking prompt into a compaction on the previous request, summarised to the new prompt", () => {
    const t = trace([
      req(0, { input: 5000 }),
      req(1, { input: 9000 }),
      req(2, { input: 6000, event: "compaction" }),
      req(3, { input: 6400 }),
    ]);
    const script = scriptFromRequestTrace(t);
    expect(script.staticPrefix).toEqual({
      toolsTokens: 2500,
      systemTokens: 2500,
    });
    expect(script.steps.map((s) => s.events)).toEqual([
      [],
      [{ type: "compaction", summaryTokens: 1000 }],
      [],
      [],
    ]);
    expect(script.steps[2]!.newContent.userTokens).toBe(0);
    expect(script.steps[3]!.newContent.userTokens).toBe(300);
    expect(simulate(t).turns.map(simulatedInput)).toEqual([
      5000, 9000, 6000, 6400,
    ]);
  });

  it("treats a shrink without an event as a compaction too", () => {
    const t = trace([
      req(0, { input: 5000 }),
      req(1, { input: 7000 }),
      req(2, { input: 5500 }),
    ]);
    expect(eventsOf(t)[1]).toEqual([
      { type: "compaction", summaryTokens: 500 },
    ]);
  });

  it("treats a compaction event as a compaction even when the prompt does not shrink", () => {
    const t = trace([
      req(0, { input: 5000 }),
      req(1, { input: 6000, event: "compaction" }),
    ]);
    const script = scriptFromRequestTrace(t);
    expect(script.steps[0]!.events).toEqual([
      { type: "compaction", summaryTokens: 1000 },
    ]);
    expect(script.steps[1]!.newContent.userTokens).toBe(0);
    expect(simulate(t).turns.map(simulatedInput)).toEqual([5000, 6000]);
  });

  it("puts a clear on the request itself, whatever the delta", () => {
    const t = trace([
      req(0, { input: 5000 }),
      req(1, { input: 8000 }),
      req(2, { input: 5200, event: "clear" }),
      req(3, { input: 9500, event: "clear" }),
    ]);
    const script = scriptFromRequestTrace(t);
    expect(script.steps.map((s) => s.events)).toEqual([
      [],
      [],
      [{ type: "clear" }],
      [{ type: "clear" }],
    ]);
    expect(script.steps[2]!.newContent.userTokens).toBe(200);
    expect(script.steps[3]!.newContent.userTokens).toBe(4500);
    expect(simulate(t).turns.map(simulatedInput)).toEqual([
      5000, 8000, 5200, 9500,
    ]);
  });

  it("lowers the static prefix to a later prompt that shrinks below the first one", () => {
    const t = trace([
      req(0, { input: 5000 }),
      req(1, { input: 7000 }),
      req(2, { input: 3000 }),
      req(3, { input: 2000, event: "clear" }),
    ]);
    const script = scriptFromRequestTrace(t);
    expect(script.staticPrefix).toEqual({
      toolsTokens: 1000,
      systemTokens: 1000,
    });
    expect(script.steps[0]!.newContent.userTokens).toBe(3000);
    expect(script.steps[1]!.events).toEqual([
      { type: "compaction", summaryTokens: 1000 },
    ]);
    expect(script.steps[3]!.newContent.userTokens).toBe(0);
    expect(simulate(t).turns.map(simulatedInput)).toEqual([
      5000, 7000, 3000, 2000,
    ]);
  });

  it("shrinks to exactly the prefix with an empty summary", () => {
    const t = trace([
      req(0, { input: 5000 }),
      req(1, { input: 9000 }),
      req(2, { input: 5000 }),
    ]);
    expect(eventsOf(t)[1]).toEqual([{ type: "compaction", summaryTokens: 0 }]);
    expect(simulate(t).turns.map(simulatedInput)).toEqual([5000, 9000, 5000]);
  });

  it("switches to the cheaper role away from the first model and back when it returns", () => {
    const t = trace([
      req(0, { input: 5000 }),
      req(1, { input: 5200, model: "claude-haiku-5.5", event: "model-switch" }),
      req(2, { input: 5400, model: "claude-haiku-5.5" }),
      req(3, { input: 5600, model: "some-third-model" }),
      req(4, { input: 5800, event: "model-switch" }),
    ]);
    expect(eventsOf(t)).toEqual([
      [],
      [{ type: "model-switch", toRole: "cheaper" }],
      [],
      [],
      [{ type: "model-switch", toRole: "primary" }],
    ]);
    expect(simulate(t).turns.map((turn) => turn.usage.model)).toEqual([
      MODEL,
      "claude-haiku-5.5",
      "claude-haiku-5.5",
      "claude-haiku-5.5",
      MODEL,
    ]);
  });

  it("switches on the model change even without a model-switch event", () => {
    const t = trace([
      req(0, { input: 5000 }),
      req(1, { input: 5200, model: "other" }),
    ]);
    expect(eventsOf(t)[1]).toEqual([
      { type: "model-switch", toRole: "cheaper" },
    ]);
  });

  it("turns on the 1-hour lifetime from the first request with 1-hour writes", () => {
    const t = trace([
      req(0, { input: 5000 }),
      req(1, {
        uncachedInput: 0,
        cacheRead: 5000,
        cacheWrite: 200,
        extendedCacheWrite: 200,
      }),
      req(2, { input: 5400, cacheWrite: 100, extendedCacheWrite: 100 }),
    ]);
    expect(eventsOf(t)).toEqual([[], [{ type: "extended-ttl" }], []]);
  });

  it("turns 0 one-hour writes into no event", () => {
    const t = trace([req(0, { input: 5000, extendedCacheWrite: 0 })]);
    expect(eventsOf(t)).toEqual([[]]);
  });

  it("keeps the gaps between requests as idle minutes", () => {
    const t = trace([
      req(0, { input: 5000, minute: 0 }),
      req(1, { input: 5200, minute: 2.5 }),
      req(2, { input: 5400, minute: 70 }),
    ]);
    expect(
      scriptFromRequestTrace(t).steps.map((s) => s.idleMinutesBefore),
    ).toEqual([0, 2.5, 67.5]);
  });

  // Calibration (calibration.test.ts) replays these captures through this
  // scripter; they keep the script 13.5a's scriptFromCapture gave them.
  it("scripts every calibration capture as 13.5a did: half tools, half system, no resets", () => {
    const dir = path.join(fixtures, "learn-calibration");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const capture = calibrationCaptureSchema.parse(
        JSON.parse(readFileSync(path.join(dir, file), "utf8")),
      );
      const t = requestTraceSchema.parse(traceFromCapture(capture));
      const script = scriptFromRequestTrace(t);
      const first = inputOf(t.requests[0]!);
      expect(script.staticPrefix, file).toEqual({
        toolsTokens: Math.round(first / 2),
        systemTokens: first - Math.round(first / 2),
      });
      expect(script.steps[0]!.newContent.userTokens, file).toBe(0);
      const extended = t.requests.some((r) => (r.extendedCacheWrite ?? 0) > 0);
      expect(
        script.steps.map((s) => s.events.map((e) => e.type)),
        file,
      ).toEqual(
        script.steps.map((_, i) =>
          i === 0 && extended ? ["extended-ttl"] : [],
        ),
      );
      script.steps.slice(1).forEach((step, i) => {
        const previous = capture.requests[i]!;
        const current = capture.requests[i + 1]!;
        expect(step.newContent.userTokens, `${file} step ${i + 1}`).toBe(
          requestInputTokens(current) -
            requestInputTokens(previous) -
            previous.recorded.output,
        );
        expect(step.idleMinutesBefore).toBeCloseTo(current.gapMinutes, 3);
      });
    }
  });
});

// Valid traces: inputs that grow or shrink, optional reasoning, null or known
// writes, optional clears, and gaps. One model, so switches stay out.
const traceArb = fc
  .array(
    fc.record({
      input: fc.integer({ min: 0, max: 200_000 }),
      writeKnown: fc.boolean(),
      readShare: fc.double({ min: 0, max: 1, noNaN: true }),
      writeShare: fc.double({ min: 0, max: 1, noNaN: true }),
      output: fc.integer({ min: 0, max: 20_000 }),
      reasoning: fc.option(fc.integer({ min: 0, max: 25_000 }), {
        nil: undefined,
      }),
      clear: fc.boolean(),
      compactionEvent: fc.boolean(),
      gapSeconds: fc.integer({ min: 0, max: 3 * 3600 }),
    }),
    { minLength: 1, maxLength: 25 },
  )
  .map((rows): RequestTrace => {
    let seconds = 0;
    return {
      sessionId: "p",
      providerId: "claude-code",
      harness: "claude-code",
      notTraced: [],
      requests: rows.map((row, index) => {
        seconds += index === 0 ? 0 : row.gapSeconds;
        const cacheRead = Math.floor(row.input * row.readShare);
        const rest = row.input - cacheRead;
        const cacheWrite = row.writeKnown
          ? Math.floor(rest * row.writeShare)
          : null;
        return {
          index,
          turnIndex: index,
          startedAt: new Date(BASE + seconds * 1000).toISOString(),
          model: MODEL,
          uncachedInput: rest - (cacheWrite ?? 0),
          cacheRead,
          cacheWrite,
          output: row.output,
          ...(row.reasoning === undefined ? {} : { reasoning: row.reasoning }),
          ...(index > 0 && row.clear
            ? { event: "clear" as const }
            : index > 0 && row.compactionEvent
              ? { event: "compaction" as const }
              : {}),
        };
      }),
    };
  });

// Never shrinks and has no events.
const growingArb = fc
  .array(
    fc.record({
      added: fc.integer({ min: 0, max: 5_000 }),
      output: fc.integer({ min: 0, max: 5_000 }),
      reasoning: fc.option(fc.integer({ min: 0, max: 5_000 }), {
        nil: undefined,
      }),
    }),
    { minLength: 1, maxLength: 25 },
  )
  .chain((rows) =>
    fc.integer({ min: 0, max: 100_000 }).map((first): RequestTrace => {
      let input = first;
      return {
        sessionId: "g",
        providerId: "claude-code",
        harness: "claude-code",
        notTraced: [],
        requests: rows.map((row, index) => {
          if (index > 0) {
            const previous = rows[index - 1]!;
            input +=
              Math.max(0, previous.output - (previous.reasoning ?? 0)) +
              row.added;
          }
          return {
            index,
            turnIndex: index,
            startedAt: at(index),
            model: MODEL,
            uncachedInput: input,
            cacheRead: 0,
            cacheWrite: null,
            output: row.output,
            ...(row.reasoning === undefined
              ? {}
              : { reasoning: row.reasoning }),
          };
        }),
      };
    }),
  );

describe("scriptFromRequestTrace properties", () => {
  it("generates valid traces", () => {
    fc.assert(
      fc.property(traceArb, (t) => {
        requestTraceSchema.parse(t);
      }),
    );
  });

  it("gives a script that parses, with one step per request", () => {
    fc.assert(
      fc.property(traceArb, (t) => {
        const script = scriptFromRequestTrace(t);
        scenarioScriptSchema.parse(script);
        expect(script.steps.map((s) => s.index)).toEqual(
          t.requests.map((r) => r.index + 1),
        );
      }),
    );
  });

  it("simulates every request's input exactly, and conserves output and reasoning", () => {
    fc.assert(
      fc.property(traceArb, (t) => {
        const session = simulate(t);
        expect(session.turns).toHaveLength(t.requests.length);
        session.turns.forEach((turn, i) => {
          const r = t.requests[i]!;
          expect(simulatedInput(turn)).toBe(inputOf(r));
          const output = turn.usage.output;
          const reasoning = turn.usage.reasoning;
          expect(output.known && reasoning.known).toBe(true);
          if (output.known && reasoning.known) {
            expect(reasoning.value).toBe(r.reasoning ?? 0);
            expect(output.value + reasoning.value).toBe(
              Math.max(r.output, r.reasoning ?? 0),
            );
          }
        });
      }),
      { numRuns: 200 },
    );
  });

  it("gives no compaction or clear for a trace that never shrinks", () => {
    fc.assert(
      fc.property(growingArb, (t) => {
        requestTraceSchema.parse(t);
        const types = eventsOf(t)
          .flat()
          .map((e) => e.type);
        expect(types).not.toContain("compaction");
        expect(types).not.toContain("clear");
        expect(scriptFromRequestTrace(t).steps[0]!.newContent.userTokens).toBe(
          0,
        );
        expect(simulate(t).turns.map(simulatedInput)).toEqual(
          t.requests.map(inputOf),
        );
      }),
    );
  });

  it("round-trips the gaps", () => {
    fc.assert(
      fc.property(traceArb, (t) => {
        const steps = scriptFromRequestTrace(t).steps;
        steps.forEach((step, i) => {
          const gap =
            i === 0
              ? 0
              : (Date.parse(t.requests[i]!.startedAt) -
                  Date.parse(t.requests[i - 1]!.startedAt)) /
                60_000;
          expect(step.idleMinutesBefore).toBe(gap);
        });
      }),
    );
  });
});
