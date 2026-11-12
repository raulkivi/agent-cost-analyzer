// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { subagentRunUsageSchema } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import type { JsonlEnvelope } from "./main-jsonl-reader.js";
import { readMainJsonlFile } from "./main-jsonl-reader.js";
import { extractSubagentRunUsage, MAX_SUBAGENT_MODEL_LENGTH, NESTED_SUBAGENTS_REASON } from "./subagent-run-usage.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/jsonl/subagents");

async function extractFixture(caseName: string, file: string, ref: { childSessionId: string | null; label: string | null }) {
  const { envelopes, rawLineCount } = await readMainJsonlFile(path.join(fixturesDir, caseName, file));
  return extractSubagentRunUsage(envelopes, rawLineCount, ref);
}

const request = (attrs: Record<string, unknown>): JsonlEnvelope => ({ type: "llm_request", attrs });
const okRequest = (extra: Record<string, unknown> = {}) =>
  request({ inputTokens: 1000, outputTokens: 100, cachedTokens: 400, copilotUsageNanoAiu: 1_000_000_000, model: "m-1", ...extra });
const ref = { childSessionId: "call_x", label: "runSubagent-Explore" };

function readRun(result: ReturnType<typeof extractSubagentRunUsage>) {
  if (result.status !== "read") {
    throw new Error(`expected a read run, got: ${result.reason}`);
  }
  return result.run;
}

describe("extractSubagentRunUsage over the SA2 fixtures", () => {
  it("sums a runSubagent file's requests, with agentName, model and startedAt", async () => {
    const result = await extractFixture("run-and-search", "runSubagent-Explore-call_fixturerun1.jsonl", {
      childSessionId: "call_fixturerun1",
      label: "runSubagent-Explore",
    });

    expect(result).toEqual({
      status: "read",
      run: {
        id: "call_fixturerun1",
        label: "runSubagent-Explore",
        agentName: "Explore",
        model: "fixture-sub-model",
        roundsCount: 2,
        uncachedInput: { known: true, value: 1000 },
        cacheWrite: expect.objectContaining({ known: false }),
        cacheRead: { known: true, value: 600 },
        reasoning: expect.objectContaining({ known: false }),
        output: { known: true, value: 200 },
        costAiCredits: { known: true, value: expect.closeTo(1.1, 9) },
        startedAt: new Date(1790000011600).toISOString(),
        attribution: "child-session-ref",
      },
    });
    expect(subagentRunUsageSchema.safeParse(readRun(result)).success).toBe(true);
  });

  it("reads a searchSubagent file with 0 nano-AIU as a known 0 and omits agentName", async () => {
    const run = readRun(
      await extractFixture("run-and-search", "searchSubagent-call_fixturesearch1.jsonl", {
        childSessionId: "call_fixturesearch1",
        label: "searchSubagent",
      }),
    );

    expect(run.costAiCredits).toEqual({ known: true, value: 0 });
    expect(run.model).toBe("fixture-search-model");
    expect(run.roundsCount).toBe(1);
    expect(run.agentName).toBeUndefined();
  });

  it("makes AI Credits unknown when a request has no numeric copilotUsageNanoAiu, keeping the token sums", async () => {
    const run = readRun(
      await extractFixture("request-without-credits", "runSubagent-Explore-call_fixturenoaiu.jsonl", {
        childSessionId: "call_fixturenoaiu",
        label: "runSubagent-Explore",
      }),
    );

    expect(run.costAiCredits).toMatchObject({ known: false });
    expect(run.output.known).toBe(true);
    expect(run.roundsCount).toBeGreaterThan(0);
  });

  it("makes every figure unknown for a run that holds a nested child_session_ref", async () => {
    const run = readRun(
      await extractFixture("nested-ref", "runSubagent-Explore-call_fixturenest.jsonl", {
        childSessionId: "call_fixturenest",
        label: "runSubagent-Explore",
      }),
    );

    for (const figure of [run.uncachedInput, run.cacheRead, run.output, run.costAiCredits]) {
      expect(figure).toEqual({ known: false, reason: "nested subagents are not read" });
    }
    expect(subagentRunUsageSchema.safeParse(run).success).toBe(true);
  });

  it("skips a partial last line and reads the rest, as for main.jsonl", async () => {
    const run = readRun(
      await extractFixture("partial-last-line", "runSubagent-Explore-call_fixturepart.jsonl", {
        childSessionId: "call_fixturepart",
        label: "runSubagent-Explore",
      }),
    );

    expect(run.costAiCredits.known).toBe(true);
    expect(run.roundsCount).toBe(1);
  });
});

describe("extractSubagentRunUsage", () => {
  it("splits cached input off the total like extractLlmRequestUsage and converts nano-AIU to AI Credits", () => {
    const run = readRun(
      extractSubagentRunUsage([okRequest(), okRequest({ model: "m-2", copilotUsageNanoAiu: 500_000_000 })], 2, ref),
    );

    expect(run.uncachedInput).toEqual({ known: true, value: 1200 });
    expect(run.cacheRead).toEqual({ known: true, value: 800 });
    expect(run.output).toEqual({ known: true, value: 200 });
    expect(run.costAiCredits).toEqual({ known: true, value: 1.5 });
    expect(run.model).toBe("m-2");
  });

  it("is a known run with 0 requests and 0 AI Credits when the file has no llm_request", () => {
    const run = readRun(extractSubagentRunUsage([{ type: "session_start", ts: 1790000000000 }], 1, ref));

    expect(run.roundsCount).toBe(0);
    expect(run.costAiCredits).toEqual({ known: true, value: 0 });
    expect(run.uncachedInput).toEqual({ known: true, value: 0 });
    expect(run.model).toBe("unknown");
  });

  it("uses the latest known model and 'unknown' when none is a string", () => {
    const withUnknownLast = readRun(extractSubagentRunUsage([okRequest(), okRequest({ model: undefined })], 2, ref));
    const noModel = readRun(extractSubagentRunUsage([okRequest({ model: 7 })], 1, ref));

    expect(withUnknownLast.model).toBe("m-1");
    expect(noModel.model).toBe("unknown");
  });

  it("replaces a model name that is long or has unexpected characters with 'unknown'", () => {
    const long = "m".repeat(MAX_SUBAGENT_MODEL_LENGTH + 1);

    expect(readRun(extractSubagentRunUsage([okRequest({ model: long })], 1, ref)).model).toBe("unknown");
    expect(readRun(extractSubagentRunUsage([okRequest({ model: "m\n<script>" })], 1, ref)).model).toBe("unknown");
    expect(readRun(extractSubagentRunUsage([okRequest({ model: "m".repeat(MAX_SUBAGENT_MODEL_LENGTH) })], 1, ref)).model).toHaveLength(
      MAX_SUBAGENT_MODEL_LENGTH,
    );
  });

  it.each([
    ["a missing value", undefined],
    ["a string", "5"],
    ["a negative number", -1],
    ["NaN", Number.NaN],
  ])("makes AI Credits unknown for %s on one request", (_name, nano) => {
    const run = readRun(extractSubagentRunUsage([okRequest(), okRequest({ copilotUsageNanoAiu: nano })], 2, ref));

    expect(run.costAiCredits).toMatchObject({ known: false });
    expect(run.output).toEqual({ known: true, value: 200 });
  });

  it("makes every figure unknown when an llm_request lacks numeric token counts, never leaving it out of a known sum", () => {
    const run = readRun(extractSubagentRunUsage([okRequest(), request({ model: "m-1" })], 2, ref));

    expect(run.roundsCount).toBe(2);
    expect(run.uncachedInput.known).toBe(false);
    expect(run.cacheRead.known).toBe(false);
    expect(run.output.known).toBe(false);
    expect(run.costAiCredits.known).toBe(false);
  });

  it("makes figures unknown when more than the last raw line failed to parse", () => {
    const run = readRun(extractSubagentRunUsage([okRequest()], 3, ref));

    expect(run.costAiCredits.known).toBe(false);
    expect(run.output.known).toBe(false);
    expect(run.roundsCount).toBe(1);
  });

  it("reports a file with no readable envelope as unreadable", () => {
    expect(extractSubagentRunUsage([], 0, ref)).toMatchObject({ status: "unreadable" });
    expect(extractSubagentRunUsage([], 4, ref)).toMatchObject({ status: "unreadable" });
  });

  it("takes startedAt from session_start, and omits it for a missing or invalid ts", () => {
    const started = readRun(extractSubagentRunUsage([{ type: "session_start", ts: 1790000011600 }], 1, ref));
    const noTs = readRun(extractSubagentRunUsage([{ type: "session_start" }], 1, ref));
    const huge = readRun(extractSubagentRunUsage([{ type: "session_start", ts: 1e20 }], 1, ref));

    expect(started.startedAt).toBe(new Date(1790000011600).toISOString());
    expect(noTs.startedAt).toBeUndefined();
    expect(huge.startedAt).toBeUndefined();
  });

  it("takes agentName from the subagent event only when it is short and made of plain characters", () => {
    const named = (agentName: unknown) =>
      readRun(extractSubagentRunUsage([{ type: "subagent", attrs: { agentName } }], 1, ref)).agentName;

    expect(named("Explore")).toBe("Explore");
    expect(named("my agent-2.1")).toBe("my agent-2.1");
    expect(named("x".repeat(65))).toBeUndefined();
    expect(named("<img src=x onerror=1>")).toBeUndefined();
    expect(named("line\nbreak")).toBeUndefined();
    expect(named(42)).toBeUndefined();
  });
});

describe("extractSubagentRunUsage identity", () => {
  it("falls back to the file's own session id and session_start label when the ref has none", () => {
    const result = extractSubagentRunUsage(
      [{ type: "session_start", sid: "call_own", attrs: { label: "searchSubagent" } }],
      1,
      { childSessionId: null, label: null },
      "timestamp",
    );

    expect(readRun(result)).toMatchObject({ id: "call_own", label: "searchSubagent", attribution: "timestamp" });
  });

  it.each([
    ["an id with a path separator", { childSessionId: "../etc", label: "searchSubagent" }],
    ["an overlong id", { childSessionId: "a".repeat(129), label: "searchSubagent" }],
    ["a missing id", { childSessionId: null, label: "searchSubagent" }],
    ["a label with markup", { childSessionId: "call_x", label: "runSubagent-<b>x</b>" }],
    ["an overlong label", { childSessionId: "call_x", label: `runSubagent-${"a".repeat(65)}` }],
    ["a label with another prefix", { childSessionId: "call_x", label: "other" }],
    ["a missing label", { childSessionId: "call_x", label: null }],
  ])("reports %s as unreadable, never passing it through", (_name, identity) => {
    expect(extractSubagentRunUsage([okRequest()], 1, identity)).toMatchObject({ status: "unreadable" });
  });

  it("never copies hostile text into the run", () => {
    const hostile = "x".repeat(10_000);
    const result = extractSubagentRunUsage(
      [{ type: "subagent", attrs: { agentName: hostile } }, okRequest({ model: hostile })],
      2,
      ref,
    );

    expect(JSON.stringify(result)).not.toContain("xxxx");
    expect(subagentRunUsageSchema.safeParse(readRun(result)).success).toBe(true);
  });
});

describe("extractSubagentRunUsage with the agent-traces join", () => {
  const traced = (responseId: string) => okRequest({ responseId });

  it("keeps cacheWrite and reasoning unknown without a join, as the list reads them", () => {
    const run = readRun(extractSubagentRunUsage([traced("r-1")], 1, ref));

    expect(run.cacheWrite).toMatchObject({ known: false });
    expect(run.reasoning).toMatchObject({ known: false });
  });

  it("sums cacheWrite and reasoning over the run's requests when every responseId resolves", () => {
    const join = new Map([
      ["r-1", { cacheWrite: 10, reasoning: 1 }],
      ["r-2", { cacheWrite: 20, reasoning: 2 }],
    ]);

    const run = readRun(extractSubagentRunUsage([traced("r-1"), traced("r-2")], 2, ref, "child-session-ref", join));

    expect(run.cacheWrite).toEqual({ known: true, value: 30 });
    expect(run.reasoning).toEqual({ known: true, value: 3 });
  });

  it("leaves both unknown when one request's responseId is missing from the join", () => {
    const join = new Map([["r-1", { cacheWrite: 10, reasoning: 1 }]]);

    const run = readRun(extractSubagentRunUsage([traced("r-1"), traced("r-2")], 2, ref, "child-session-ref", join));

    expect(run.cacheWrite).toMatchObject({ known: false });
    expect(run.reasoning).toMatchObject({ known: false });
  });

  it("keeps the join out of a run whose figures are unknown for another reason", () => {
    const join = new Map([["r-1", { cacheWrite: 10, reasoning: 1 }]]);
    const nested: JsonlEnvelope = { type: "child_session_ref" };

    const run = readRun(extractSubagentRunUsage([traced("r-1"), nested], 2, ref, "child-session-ref", join));

    expect(run.cacheWrite).toEqual({ known: false, reason: NESTED_SUBAGENTS_REASON });
  });
});
