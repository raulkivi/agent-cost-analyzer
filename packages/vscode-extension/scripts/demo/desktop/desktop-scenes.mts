// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Scene } from "../scene-timeline.mts";

// What a Desktop scene can do. `template` names a PNG in ./templates (without extension).
export type DesktopAction =
  | { kind: "waitFor"; template: string }
  | { kind: "waitAnswerDone" }
  | { kind: "newChat" }
  | { kind: "prompt"; text: string }
  | { kind: "startRecording" }
  | { kind: "click"; template: string }
  | { kind: "beat" };

export type DesktopScene = Scene<DesktopAction>;

const step = (label: string, action: DesktopAction, beatMs: number) => ({ label, action, beatMs });

// M1 (docs/plans/docs-refresh-and-demo-recordings.md §4.2, §4.3). The prompt goes in before the recording
// starts (D17: no typing or greeting on screen), and the take stops at the side pane (D18: no fullscreen).
const M1: DesktopScene = {
  id: "M1",
  slug: "cost-rollup",
  title: "Cost rollup in Claude Desktop",
  steps: [
    step("New chat", { kind: "newChat" }, 500),
    step("Wait for the composer", { kind: "waitFor", template: "new-chat-composer" }, 500),
    step("Send the question", { kind: "prompt", text: "What did my coding agents cost in October?" }, 0),
    step("Start recording", { kind: "startRecording" }, 500),
    step("Wait for the cost rollup view", { kind: "waitFor", template: "row-scratch" }, 1500),
    step("Wait for the answer", { kind: "waitAnswerDone" }, 2500),
    step("Open the top session", { kind: "click", template: "row-scratch" }, 2500),
    step("Open the host side pane", { kind: "click", template: "expand" }, 2500),
    step("Open a turn", { kind: "click", template: "pane-turn-row" }, 3000),
    step("Back", { kind: "click", template: "back-link" }, 2500),
  ],
};

export const DESKTOP_SCENES: Record<string, DesktopScene> = { M1 };

export function sceneTemplates(scene: DesktopScene): string[] {
  const names = new Set<string>();
  for (const { action } of scene.steps) if ("template" in action) names.add(action.template);
  return [...names];
}
