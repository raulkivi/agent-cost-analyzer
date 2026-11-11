// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The real-Copilot suite's last check before it sends a chat message
// (docs/plans/release-ui-gate.md R5): the model the chat input's picker shows,
// read from the widget rather than from the state we seeded, must be the one
// asked for. VS Code 1.146 can reset a new chat to another model (the owner's
// release run on 5922f21 spent 16.38 AI Credits on Sonnet and GPT-6 Luna before
// the after-chat check skipped), so a mismatch skips the test unsent and costs 0.
import { normalizeModel } from "./copilot-e2e-env.mts";

// The picker button's accessible name in VS Code 1.146: "Models, Claude Haiku 5.5".
const PICKER_LABEL = /^Models, (.+)$/;

export function shownModelOf(ariaLabels: readonly string[]): string | undefined {
  for (const label of ariaLabels) {
    const match = PICKER_LABEL.exec(label.trim());
    if (match) return match[1]!.trim();
  }
  return undefined;
}

// The session target picker's accessible name for VS Code's own harness.
const LOCAL_HARNESS = "Local";

// VS Code 1.146 also shows the chat's harness and agent in the input: the
// model picker means nothing in the Copilot SDK harness (it has its own
// model pool, R5), and plain Agent mode would offer every tool, not only the
// analyzer's (D6). Both labels are exact, as 1.146 renders them.
export function preSendSessionCheck(ariaLabels: readonly string[], agent: string): PreSendDecision {
  const labels = ariaLabels.map((label) => label.trim());
  if (!labels.includes(LOCAL_HARNESS)) {
    return { send: false, reason: `the chat isn't in VS Code's ${LOCAL_HARNESS} harness (the Copilot SDK harness picks its own model); nothing was sent.` };
  }
  if (!labels.includes(agent)) {
    return { send: false, reason: `the chat isn't in the ${agent} agent (its tool list didn't load); nothing was sent.` };
  }
  return { send: true };
}

export interface RequestedModel {
  // COPILOT_E2E_MODEL, the Copilot picker's id.
  id: string;
  // The name Copilot gives it (vscode.lm), when known.
  name?: string;
}

export interface PreSendInput {
  requested: RequestedModel;
  shown: string | undefined;
  // VS Code's error when selecting the model failed (not on the plan, unknown id).
  selectError?: string;
}

export type PreSendDecision = { send: true } | { send: false; reason: string };

export function preSendModelCheck({ requested, shown, selectError }: PreSendInput): PreSendDecision {
  if (selectError !== undefined) {
    return { send: false, reason: `the chat couldn't select ${requested.id} (${selectError}); nothing was sent.` };
  }
  if (shown === undefined) {
    return { send: false, reason: `the chat's model picker showed no model before sending, so ${requested.id} isn't confirmed; nothing was sent.` };
  }
  // Exact, not "contains": a fast or preview line of the same model costs differently.
  const wanted = [requested.id, requested.name].filter((name): name is string => name !== undefined).map(normalizeModel);
  if (wanted.includes(normalizeModel(shown))) return { send: true };
  return { send: false, reason: `the chat's model picker shows "${shown}", not ${requested.id}, before sending; nothing was sent.` };
}
