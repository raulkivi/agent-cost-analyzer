// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { assertScene, totalBeatMs } from "../scene-timeline.mts";
import { N1, N1_COMMAND, sceneTemplates, TERMINAL_SCENES } from "./terminal-scenes.mts";

describe("N1", () => {
  it("is a valid scene named after the output files", () => {
    expect(() => assertScene(N1)).not.toThrow();
    expect(N1.id).toBe("N1");
    expect(TERMINAL_SCENES.N1).toBe(N1);
  });
  it("leaves room in the 20 s budget for the typing and the waits", () => {
    expect(totalBeatMs(N1)).toBeLessThanOrEqual(14_000);
  });
  it("follows beats 1 to 4: type in A, start line and browser, Analyze, B reuses the app", () => {
    const kinds = N1.steps.map((s) => s.action.kind);
    expect(N1.steps[0]?.action).toEqual({ kind: "showTerminal", terminal: "A" });
    expect(kinds.indexOf("startRecording")).toBeLessThan(kinds.indexOf("type"));
    const typed = N1.steps.flatMap((s) => (s.action.kind === "type" ? [s.action.text] : []));
    expect(typed).toEqual([N1_COMMAND, N1_COMMAND]);
    const waits = N1.steps.flatMap((s) => (s.action.kind === "waitTemplate" ? [s.action.template] : []));
    expect(waits).toEqual(["n1-start-line", "n1-already-running"]);
    expect(kinds.indexOf("waitHealth")).toBeGreaterThan(kinds.indexOf("type"));
    expect(kinds.indexOf("analyzeClaudeCode")).toBeGreaterThan(kinds.indexOf("waitBrowser"));
    const b = N1.steps.findIndex((s) => s.action.kind === "showTerminal" && s.action.terminal === "B");
    expect(b).toBeGreaterThan(kinds.indexOf("analyzeClaudeCode"));
    expect(kinds.lastIndexOf("showBrowser")).toBeGreaterThan(b);
  });
  it("lists the templates it needs", () => {
    expect(sceneTemplates(N1)).toEqual(["n1-start-line", "n1-already-running"]);
  });
});
