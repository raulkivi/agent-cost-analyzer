import { describe, expect, it } from "vitest";
import * as domain from "./index.js";
import { apiMethodSchema } from "./rpc.js";

describe("apiMethodSchema", () => {
  it("lists every ApiService method the transports share (vscode-extension.md D2)", () => {
    expect(apiMethodSchema.options).toEqual([
      "listSessions",
      "getSession",
      "getTurnDetail",
      "getSystemPromptText",
      "getConfigStatus",
      "setRetentionThreshold",
      "listLearnScenarios",
      "getLearnScenario",
      "getLogProviderStatus",
      "setActiveLogProvider",
      "getSessionAudit",
      "listToolCalls",
      "getAuditRollup",
      "getInsights",
      "getHealth",
      "getProductProfile",
    ]);
  });

  it("accepts a known method name", () => {
    expect(apiMethodSchema.parse("getSession")).toBe("getSession");
  });

  it("rejects an unknown method name", () => {
    expect(() => apiMethodSchema.parse("deleteEverything")).toThrow();
  });

  it("is exported from the domain index", () => {
    expect(domain.apiMethodSchema).toBe(apiMethodSchema);
  });
});
