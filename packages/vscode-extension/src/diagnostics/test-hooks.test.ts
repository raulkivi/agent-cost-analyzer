import { describe, expect, it, vi } from "vitest";
import { createTestHookHandlers, INTERNAL_COMMAND_IDS, type TestHookSources } from "./test-hooks.js";

function sources(): TestHookSources {
  return {
    performance: { marks: vi.fn(() => [{ name: "sessions-tree" as const, durationMs: 12 }]), clear: vi.fn() },
    rpcTrace: { entries: vi.fn(() => [{ method: "getHealth", ok: true }]), clear: vi.fn() },
    sidebar: { sessionsTree: vi.fn(() => []) },
    mcpServers: { provide: vi.fn(() => []) },
  };
}

describe("test hooks (step 10.9's integration-test seam)", () => {
  it("are internal commands, under their own prefix, one handler each", () => {
    const handlers = createTestHookHandlers(sources());

    expect(Object.keys(handlers).sort()).toEqual(Object.values(INTERNAL_COMMAND_IDS).sort());
    for (const id of Object.values(INTERNAL_COMMAND_IDS)) {
      expect(id).toMatch(/^aiCreditsAnalyzer\.internal\.[a-zA-Z]+$/);
    }
  });

  it("read the recorded marks, the RPC trace, the Sessions tree and the MCP server definitions", () => {
    const from = sources();
    const handlers = createTestHookHandlers(from);

    expect(handlers[INTERNAL_COMMAND_IDS.perfMarks]!()).toEqual([{ name: "sessions-tree", durationMs: 12 }]);
    expect(handlers[INTERNAL_COMMAND_IDS.rpcTrace]!()).toEqual([{ method: "getHealth", ok: true }]);
    expect(handlers[INTERNAL_COMMAND_IDS.sessionsTree]!()).toEqual([]);
    expect(handlers[INTERNAL_COMMAND_IDS.mcpServerDefinitions]!()).toEqual([]);
    expect(from.sidebar.sessionsTree).toHaveBeenCalledTimes(1);
    expect(from.mcpServers.provide).toHaveBeenCalledTimes(1);
  });

  it("reset clears the marks and the trace, so a test reads only its own", () => {
    const from = sources();

    createTestHookHandlers(from)[INTERNAL_COMMAND_IDS.resetDiagnostics]!();

    expect(from.performance.clear).toHaveBeenCalledTimes(1);
    expect(from.rpcTrace.clear).toHaveBeenCalledTimes(1);
  });
});
