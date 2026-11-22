// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Scene } from "../scene-timeline.mts";
import type { TerminalName } from "./terminal-layout.mts";

// What an N1-style scene can do. `template` names a PNG in ../desktop/templates (without extension).
export type TerminalAction =
  | { kind: "showTerminal"; terminal: TerminalName }
  | { kind: "startRecording" }
  | { kind: "type"; text: string }
  | { kind: "waitHealth" }
  | { kind: "waitTemplate"; template: string }
  | { kind: "waitBrowser" }
  | { kind: "analyzeClaudeCode" }
  | { kind: "showBrowser" }
  | { kind: "beat" };

export type TerminalScene = Scene<TerminalAction>;

export const N1_COMMAND = "npx agent-cost-analyzer";

const step = (label: string, action: TerminalAction, beatMs: number) => ({ label, action, beatMs });

// N1 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/demo-recordings-1.0.md §3.2). Typing and the waits add to these beats: the master runs about 17 s.
export const N1: TerminalScene = {
  id: "N1",
  slug: "npx-quick-start",
  title: "npx quick start",
  steps: [
    step("Terminal A to the front", { kind: "showTerminal", terminal: "A" }, 0),
    step("Start recording on the bare prompt", { kind: "startRecording" }, 800),
    // Beat 1
    step("Type the command", { kind: "type", text: N1_COMMAND }, 300),
    // Beat 2
    step("Wait for the server", { kind: "waitHealth" }, 0),
    step("Wait for the start line", { kind: "waitTemplate", template: "n1-start-line" }, 1500),
    step("Wait for the browser to open", { kind: "waitBrowser" }, 1500),
    // Beat 3
    step("Analyze, Source Claude Code", { kind: "analyzeClaudeCode" }, 2500),
    // Beat 4
    step("Terminal B to the front", { kind: "showTerminal", terminal: "B" }, 600),
    step("Type the command again", { kind: "type", text: N1_COMMAND }, 0),
    step("Wait for the reuse message", { kind: "waitTemplate", template: "n1-already-running" }, 1200),
    step("The browser comes to the front", { kind: "showBrowser" }, 2500),
  ],
};

export const TERMINAL_SCENES: Record<string, TerminalScene> = { N1 };

export function sceneTemplates(scene: TerminalScene): string[] {
  return scene.steps.flatMap((s) => (s.action.kind === "waitTemplate" ? [s.action.template] : []));
}
