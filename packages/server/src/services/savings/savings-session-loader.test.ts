// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { FakeProvider } from "../../test-support/audit-fakes.js";
import { ANTHROPIC, attributorOn, CacheBreakTraceProvider, RequestTraceProvider, session, traceOf, turn, turnPricing } from "../../test-support/savings-fakes.js";
import { buildSessionAudit } from "../tool-audit/session-audit-builder.js";
import { SavingsSessionLoader } from "./savings-session-loader.js";

// Phase 16 SR10 (docs/plans/savings-report.md §5.2, §6): one session of the
// window as every detector reads it: the full session (its tool inventory),
// its channel, its request trace (with prompt changes where the provider
// records them), its tool-call audit and each turn's priced cost figure.

const s1 = session("s1", { turns: [turn(0), turn(1)] });

function loader() {
  return new SavingsSessionLoader({ attributor: attributorOn(ANTHROPIC), turnPricer: turnPricing().snapshot("as-of-use") });
}

describe("SavingsSessionLoader", () => {
  it("reads the session, its channel, its audit and each turn's priced figure", async () => {
    const input = await loader().load(new FakeProvider("claude-code", [s1]), "s1");

    expect(input).toMatchObject({ providerId: "claude-code", channel: ANTHROPIC });
    expect(input!.session).toBe(s1);
    expect(input!.audit).toEqual(buildSessionAudit(s1));
    expect([...input!.turnCosts!.keys()]).toEqual([0, 1]);
    // The priced figure, not the preferred one: it names its price versions.
    expect(input!.turnCosts!.get(0)).toMatchObject({ known: true, currency: "USD", basis: "priced", priceVersionIds: ["anthropic-api:claude-sonnet-5:2026-10-01"] });
  });

  it("returns null for a session the provider no longer has", async () => {
    expect(await loader().load(new FakeProvider("claude-code", []), "gone")).toBeNull();
  });

  it("takes the cache-break trace and its prompt changes where the provider records them", async () => {
    const trace = traceOf(s1);
    const promptChanges = new Map([[1, { tools: true }]]);
    const provider = new CacheBreakTraceProvider("vscode", [s1], new Map([["s1", { trace, promptChanges }]]));

    const input = await loader().load(provider, "s1");

    expect(input!.trace).toBe(trace);
    expect(input!.promptChanges).toBe(promptChanges);
    expect(input!.traceUnavailableReason).toBeUndefined();
  });

  it("takes the plain request trace, with no prompt changes recorded, from a provider that has only that", async () => {
    const trace = traceOf(s1);

    const input = await loader().load(new RequestTraceProvider("claude-code", [s1], new Map([["s1", trace]])), "s1");

    expect(input!.trace).toBe(trace);
    expect(input!.promptChanges).toEqual(new Map());
  });

  it("says why there is no trace for a provider whose log records none (pi, mitmproxy)", async () => {
    const input = await loader().load(new FakeProvider("pi-agent", [s1]), "s1");

    expect(input!.trace).toBeUndefined();
    expect(input!.traceUnavailableReason).toMatch(/records no request trace/);
  });

  it("says why when the provider has no trace for this session", async () => {
    const input = await loader().load(new RequestTraceProvider("claude-code", [s1], new Map()), "s1");

    expect(input!.trace).toBeUndefined();
    expect(input!.traceUnavailableReason).toMatch(/no request trace for this session/);
  });

  it("keeps the session when its trace can't be read, with the reason", async () => {
    class Broken extends RequestTraceProvider {
      override async readRequestTrace(): Promise<never> {
        throw new Error("/home/someone/secret/path is locked");
      }
    }

    const input = await loader().load(new Broken("claude-code", [s1], new Map()), "s1");

    expect(input!.trace).toBeUndefined();
    // A fixed sentence: no path from the error reaches the report.
    expect(input!.traceUnavailableReason).toBe("The session's request trace could not be read.");
  });
});
