// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Is Copilot ready for an agent-mode chat? VS Code is signed in, but Copilot
// takes a while to start after launch, so the real-Copilot suite polls these
// signals instead of checking once (a slow start would otherwise skip the run,
// and a skip blocks the release, G2). The signals, read through the VS Code API:
// - a GitHub account: vscode.authentication.getAccounts("github");
// - Copilot Chat active: vscode.extensions.getExtension("GitHub.copilot-chat").isActive;
// - a Copilot model: vscode.lm.selectChatModels({ vendor: "copilot" }) is not
//   empty, which needs the sign-in and entitlement Copilot Chat checked, so
//   chat can take a request.

export const COPILOT_CHAT_EXTENSION_ID = "GitHub.copilot-chat";
export const COPILOT_READY_POLL_MS = 2_000;
export const COPILOT_READY_LIMIT_MS = 120_000;

export interface CopilotSignals {
  githubAccount: boolean;
  copilotChatActive: boolean;
  copilotModels: number;
}

// What a failed read of the signals counts as.
export const NOT_OBSERVED: CopilotSignals = { githubAccount: false, copilotChatActive: false, copilotModels: 0 };

export type CopilotReadiness = { status: "ready" } | { status: "waiting" } | { status: "gave-up"; reason: string };

function missingParts(signals: CopilotSignals): string[] {
  return [
    ...(signals.githubAccount ? [] : ["no GitHub account is signed in in the copied profile (run npm run test:ui:vscode:copilot:signin once)"]),
    ...(signals.copilotChatActive ? [] : [`Copilot Chat (${COPILOT_CHAT_EXTENSION_ID}) isn't active`]),
    ...(signals.copilotModels > 0 ? [] : ["no Copilot language model is available"]),
  ];
}

export function copilotReadiness(signals: CopilotSignals, elapsedMs: number, limitMs = COPILOT_READY_LIMIT_MS): CopilotReadiness {
  const missing = missingParts(signals);
  if (missing.length === 0) return { status: "ready" };
  if (elapsedMs < limitMs) return { status: "waiting" };
  return { status: "gave-up", reason: `Copilot wasn't ready after ${Math.round(elapsedMs / 1000)} s: ${missing.join("; ")}.` };
}
