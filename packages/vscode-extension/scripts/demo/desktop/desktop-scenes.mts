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
  // A key press with nothing typed, e.g. Return to send what a view put in the composer.
  | { kind: "press"; key: string }
  // Wheel-down over the side pane; the views are taller than the pane, and the target is in the last screenful.
  | { kind: "scrollPane"; clicks: number }
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
    // The pane mounts a fresh view at the rollup, so the drill-down happens in the pane.
    step("Open the host side pane", { kind: "click", template: "expand" }, 2500),
    step("Open the top session", { kind: "click", template: "row-scratch" }, 2500),
    step("Open a turn", { kind: "click", template: "pane-turn-row" }, 3000),
    step("Back", { kind: "click", template: "back-link" }, 2500),
  ],
};

// The opening every scene shares: nothing typed or greeted on screen (D17).
const opening = (prompt: string): DesktopScene["steps"] => [
  step("New chat", { kind: "newChat" }, 500),
  step("Wait for the composer", { kind: "waitFor", template: "new-chat-composer" }, 500),
  step("Send the question", { kind: "prompt", text: prompt }, 0),
  step("Start recording", { kind: "startRecording" }, 500),
];

// Enough notches to reach the bottom of any view; the pane stops there, so overshooting is harmless.
const TO_BOTTOM = 12;

// M2. "Why did ... cost more" most likely makes Claude call explain_cost_change (the waterfall), with periods of
// its own choosing. Price changes sit in the fixture on 7 and 20 October, so any period around them enables the
// button. If Claude calls compare_costs instead, the first wait times out: retake. F1 covers the drill-down chain.
const M2: DesktopScene = {
  id: "M2",
  slug: "cost-change",
  title: "Why a project cost more, in Claude Desktop",
  steps: [
    ...opening("Why did the Customer portal project cost more in October?"),
    step("Wait for the cost change view", { kind: "waitFor", template: "cost-change-kicker" }, 1500),
    step("Wait for the answer", { kind: "waitAnswerDone" }, 1500),
    step("Open the host side pane", { kind: "click", template: "expand" }, 3500),
    step("Scroll to Price changes", { kind: "scrollPane", clicks: TO_BOTTOM }, 1500),
    step("Open Price changes", { kind: "click", template: "price-changes-button" }, 4000),
    step("Back", { kind: "click", template: "back-to-cost-change" }, 2500),
  ],
};

// M3. The statement is read-only text and tables: the pane shows the per-currency tables after one scroll.
const M3: DesktopScene = {
  id: "M3",
  slug: "statement",
  title: "A draft statement in Claude Desktop",
  steps: [
    ...opening("Draft October's statement for the Customer portal project."),
    step("Wait for the statement view", { kind: "waitFor", template: "statement-kicker" }, 1500),
    step("Wait for the answer", { kind: "waitAnswerDone" }, 1500),
    step("Open the host side pane", { kind: "click", template: "expand" }, 4000),
    step("Scroll to the tables", { kind: "scrollPane", clicks: TO_BOTTOM }, 4000),
  ],
};

// M4. The audit rollup of this fixture has no failed commands (its Claude Code sessions record no tool calls), so
// the scene starts at the session picker, which is the point: Analyse hands "Analyse session <id>" back to the
// chat, and Claude answers with the session audit. One day, so one row and one Analyse button. §4.2 named the
// rollup first; that needs a fixture with failures.
const M4: DesktopScene = {
  id: "M4",
  slug: "analyse-session",
  title: "Pick a session to audit in Claude Desktop",
  steps: [
    ...opening("Show my Claude Code sessions from 30 October so I can pick one to analyse."),
    step("Wait for the session picker", { kind: "waitFor", template: "sessions-kicker" }, 1500),
    step("Wait for the answer", { kind: "waitAnswerDone" }, 1500),
    step("Open the host side pane", { kind: "click", template: "expand" }, 3000),
    step("Analyse the session", { kind: "click", template: "analyse-button" }, 1500),
    // Desktop puts the view's "Analyse session <id>" in the composer under a caution note and waits for Enter.
    step("Send it", { kind: "press", key: "Return" }, 500),
    step("Wait for the session audit", { kind: "waitFor", template: "audit-kicker" }, 1500),
    step("Wait for the answer", { kind: "waitAnswerDone" }, 3500),
  ],
};

// M5. Two medium anomalies and nine "first use" notes; the Anomaly filter narrows to the two, and "Why flagged"
// opens one's evidence. The severity filter is a native select, which a screen click can't drive reliably.
const M5: DesktopScene = {
  id: "M5",
  slug: "findings",
  title: "Findings across providers in Claude Desktop",
  steps: [
    ...opening("Anything risky in my sessions in October?"),
    step("Wait for the findings view", { kind: "waitFor", template: "findings-kicker" }, 1500),
    step("Wait for the answer", { kind: "waitAnswerDone" }, 1500),
    step("Open the host side pane", { kind: "click", template: "expand" }, 3000),
    step("Filter to anomalies", { kind: "click", template: "kind-anomaly" }, 2500),
    step("Open the evidence", { kind: "click", template: "why-flagged" }, 4000),
  ],
};

// M6. The model may call list_sessions first, which shows a second view (the picker) above the comparison; if two
// expand icons are on screen the click may pick the picker's. The first live take will show.
const M6: DesktopScene = {
  id: "M6",
  slug: "replay",
  title: "Replay a session on other models in Claude Desktop",
  steps: [
    ...opening('What would my Claude Code session "scratch" from 30 October have cost on Claude Haiku 5.5 or GPT-6 Luna?'),
    step("Wait for the model comparison", { kind: "waitFor", template: "replay-kicker" }, 1500),
    step("Wait for the answer", { kind: "waitAnswerDone" }, 1500),
    step("Open the host side pane", { kind: "click", template: "expand" }, 3500),
    step("Replay on Haiku", { kind: "click", template: "model-haiku" }, 3500),
    step("Scroll to the chart and assumptions", { kind: "scrollPane", clicks: TO_BOTTOM }, 3500),
    step("Back", { kind: "click", template: "back-to-model-comparison" }, 2000),
  ],
};

// M7. estimate_cost reads a 12-week window to the real clock. Mobile app has six priced pi days (3 to 29 October),
// so the range holds until about 26 December 2026; after that the view says "Not enough history". (The Customer
// portal has 2 known days, so it always refuses.) A "Simulated" estimate on another model can't be shown: pi's
// logs can't be replayed.
const M7: DesktopScene = {
  id: "M7",
  slug: "estimate",
  title: "A cost estimate in Claude Desktop",
  steps: [
    ...opening("What would ten more active days on the Mobile app cost?"),
    step("Wait for the estimate view", { kind: "waitFor", template: "estimate-kicker" }, 1500),
    step("Wait for the answer", { kind: "waitAnswerDone" }, 1500),
    step("Open the host side pane", { kind: "click", template: "expand" }, 4000),
    step("Scroll to the end", { kind: "scrollPane", clicks: TO_BOTTOM }, 3500),
  ],
};

export const DESKTOP_SCENES: Record<string, DesktopScene> = { M1, M2, M3, M4, M5, M6, M7 };

export function sceneTemplates(scene: DesktopScene): string[] {
  const names = new Set<string>();
  for (const { action } of scene.steps) if ("template" in action) names.add(action.template);
  return [...names];
}
