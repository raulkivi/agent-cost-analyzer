import { describe, expect, it } from "vitest";
import type { ApiMethodName, ApiTransport } from "./transport.js";

// What a transport's fake backend does with the next request.
export interface ContractHarness {
  transport: ApiTransport;
  // The backend answers the next request successfully with `value`.
  succeedWith(value: unknown): void;
  // The backend answers the next request with an error of this status.
  failWith(status: number): void;
}

// Every method with representative params; the harness answers any of them.
const CASES: Array<[ApiMethodName, unknown]> = [
  ["listSessions", undefined],
  ["getSession", { id: "s1" }],
  ["getTurnDetail", { sessionId: "s1", turnIndex: 2 }],
  ["getSystemPromptText", { id: "s1" }],
  ["getConfigStatus", undefined],
  ["setRetentionThreshold", { value: 300 }],
  ["listLearnScenarios", undefined],
  ["getLearnScenario", { id: "cache-basics" }],
  ["getLogProviderStatus", undefined],
  ["setActiveLogProvider", { id: "vscode" }],
  ["getSessionAudit", { sessionId: "s1" }],
  ["listToolCalls", { sessionId: "s1", status: ["failed"], limit: 10 }],
  ["getAuditRollup", { since: "2026-09-01" }],
  ["getInsights", {}],
  ["getHealth", undefined],
  ["getProductProfile", undefined],
];

// Behaviour every ApiTransport adapter must share, so api-client can't tell
// which one it is running on.
export function describeApiTransportContract(name: string, makeHarness: () => ContractHarness): void {
  describe(`${name} satisfies the ApiTransport contract`, () => {
    it.each(CASES.filter(([method]) => method !== "getSystemPromptText"))(
      "%s resolves with the backend's JSON result",
      async (method, params) => {
        const harness = makeHarness();
        harness.succeedWith({ marker: method });
        await expect(harness.transport.call(method, params)).resolves.toEqual({ marker: method });
      },
    );

    it("getSystemPromptText resolves with the raw text", async () => {
      const harness = makeHarness();
      harness.succeedWith("You are an expert AI assistant.");
      await expect(harness.transport.call("getSystemPromptText", { id: "s1" })).resolves.toBe(
        "You are an expert AI assistant.",
      );
    });

    it.each(CASES)("%s rejects with the status in the message when the backend fails", async (method, params) => {
      const harness = makeHarness();
      harness.failWith(404);
      await expect(harness.transport.call(method, params)).rejects.toThrow(/failed with status 404/);
    });
  });
}
