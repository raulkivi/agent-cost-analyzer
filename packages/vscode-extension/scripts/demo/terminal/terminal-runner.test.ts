// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { createTerminalRunner, type TerminalDeps } from "./terminal-runner.mts";

function fakeDeps() {
  const calls: string[] = [];
  const deps: TerminalDeps = {
    raise: async (t) => void calls.push(`raise ${t}`),
    type: async (text) => void calls.push(`type ${text}`),
    press: async (key) => void calls.push(`press ${key}`),
    waitHealth: async () => void calls.push("health"),
    waitTemplate: async (t) => void calls.push(`template ${t}`),
    startRecording: async () => void calls.push("record"),
    browser: {
      waitOpened: async (n) => void calls.push(`opened ${n}`),
      analyzeClaudeCode: async () => void calls.push("analyze"),
      show: async () => void calls.push("show"),
    },
  };
  return { calls, deps };
}

describe("createTerminalRunner", () => {
  it("raises and focuses a terminal", async () => {
    const { calls, deps } = fakeDeps();
    await createTerminalRunner(deps).perform({ kind: "showTerminal", terminal: "B" });
    expect(calls).toEqual(["raise B"]);
  });
  it("types a command and presses Return", async () => {
    const { calls, deps } = fakeDeps();
    await createTerminalRunner(deps).perform({ kind: "type", text: "npx x" });
    expect(calls).toEqual(["type npx x", "press Return"]);
  });
  it("counts browser opens: the first open is 1, the reuse is 2", async () => {
    const { calls, deps } = fakeDeps();
    const runner = createTerminalRunner(deps);
    await runner.perform({ kind: "waitBrowser" });
    await runner.perform({ kind: "showBrowser" });
    expect(calls).toEqual(["opened 1", "opened 2", "show"]);
  });
  it("routes the rest", async () => {
    const { calls, deps } = fakeDeps();
    const runner = createTerminalRunner(deps);
    for (const action of [{ kind: "waitHealth" }, { kind: "waitTemplate", template: "t" }, { kind: "startRecording" }, { kind: "analyzeClaudeCode" }, { kind: "beat" }] as const) {
      await runner.perform(action);
    }
    expect(calls).toEqual(["health", "template t", "record", "analyze"]);
  });
});
