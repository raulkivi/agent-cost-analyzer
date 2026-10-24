import { afterEach, describe, expect, it } from "vitest";
import { fetchSessionAudit, fetchAuditRollup } from "./audit.js";
import { fetchConfigStatus, updateRetentionThreshold } from "./config-status.js";
import { getApiTransport, resetApiTransport, setApiTransport } from "./current-transport.js";
import { fetchHealth } from "./health.js";
import { HttpTransport } from "./http-transport.js";
import { fetchInsights } from "./insights.js";
import { fetchLearnScenario, fetchLearnScenarios } from "./learn-scenarios.js";
import { fetchLogProviderStatus, setActiveLogProvider } from "./log-providers.js";
import { fetchSession, fetchSessions, fetchSystemPromptText, fetchTurnInspectorDetail } from "./sessions.js";
import type { ApiMethodName, ApiTransport } from "./transport.js";

function recordingTransport() {
  const calls: Array<{ method: ApiMethodName; params: unknown }> = [];
  const transport: ApiTransport = {
    call: <T>(method: ApiMethodName, params?: unknown) => {
      calls.push({ method, params });
      return Promise.resolve("result" as T);
    },
  };
  return { calls, transport };
}

describe("api-client transport provider", () => {
  afterEach(() => {
    resetApiTransport();
  });

  it("defaults to the HTTP transport", () => {
    expect(getApiTransport()).toBeInstanceOf(HttpTransport);
  });

  it("routes every api-client function through the installed transport", async () => {
    const { calls, transport } = recordingTransport();
    setApiTransport(transport);

    await fetchSessions();
    await fetchSession("s1");
    await fetchTurnInspectorDetail("s1", 2);
    await fetchSystemPromptText("s1");
    await fetchConfigStatus();
    await updateRetentionThreshold(300);
    await fetchLearnScenarios();
    await fetchLearnScenario("cache-basics");
    await fetchLogProviderStatus();
    await setActiveLogProvider("vscode");
    await fetchSessionAudit("s1");
    await fetchAuditRollup({ since: "2026-09-01", limit: 100 });
    await fetchInsights({ until: "2026-10-01" });
    await fetchHealth();

    expect(calls).toEqual([
      { method: "listSessions", params: undefined },
      { method: "getSession", params: { id: "s1" } },
      { method: "getTurnDetail", params: { sessionId: "s1", turnIndex: 2 } },
      { method: "getSystemPromptText", params: { id: "s1" } },
      { method: "getConfigStatus", params: undefined },
      { method: "setRetentionThreshold", params: { value: 300 } },
      { method: "listLearnScenarios", params: undefined },
      { method: "getLearnScenario", params: { id: "cache-basics" } },
      { method: "getLogProviderStatus", params: undefined },
      { method: "setActiveLogProvider", params: { id: "vscode" } },
      { method: "getSessionAudit", params: { sessionId: "s1" } },
      { method: "getAuditRollup", params: { since: "2026-09-01", limit: 100 } },
      { method: "getInsights", params: { until: "2026-10-01" } },
      { method: "getHealth", params: undefined },
    ]);
  });

  it("returns whatever the transport resolves", async () => {
    setApiTransport(recordingTransport().transport);
    await expect(fetchSystemPromptText("s1")).resolves.toBe("result");
  });
});
