// The opt-in, owner-run suite that drives a real signed-in Copilot Chat
// (docs/plans/vscode-ui-automation.md §7). Never part of the default UI suite
// or CI: it runs only with COPILOT_E2E=1, and skips with a reason otherwise.
import { existsSync } from "node:fs";
import { parseMaxAiCredits } from "./credit-budget.mts";

// Claude Haiku 5.5 and GPT-6 Luna cost the same (docs/learn-rule-register.md);
// COPILOT_E2E_MODEL=gpt-6-luna picks the other.
export const DEFAULT_COPILOT_E2E_MODEL = "claude-haiku-5.5";

export type CopilotE2eEnv = { status: "skip"; reason: string } | { status: "run"; userDataDir: string; model: string; maxAiCredits: number };

export function readCopilotE2eEnv(env: Record<string, string | undefined>): CopilotE2eEnv {
  if (env.COPILOT_E2E !== "1") {
    return { status: "skip", reason: "The real-Copilot suite is opt-in and spends AI Credits: set COPILOT_E2E=1 to run it (owner's machine only, never CI)." };
  }
  const userDataDir = env.COPILOT_E2E_USER_DATA_DIR;
  if (userDataDir === undefined || userDataDir === "") {
    return { status: "skip", reason: "COPILOT_E2E_USER_DATA_DIR is not set: point it at the throwaway VS Code user-data directory you signed in to Copilot with (npm run test:ui:vscode:copilot:signin)." };
  }
  if (!existsSync(userDataDir)) {
    return { status: "skip", reason: `COPILOT_E2E_USER_DATA_DIR (${userDataDir}) does not exist: run npm run test:ui:vscode:copilot:signin once to create it.` };
  }
  // A run never starts without a cap on what its chats may spend (D12, proposed).
  const budget = parseMaxAiCredits(env.COPILOT_E2E_MAX_AI_CREDITS);
  if (!budget.ok) return { status: "skip", reason: budget.reason };
  return { status: "run", userDataDir, model: env.COPILOT_E2E_MODEL?.trim() || DEFAULT_COPILOT_E2E_MODEL, maxAiCredits: budget.max };
}

// Lowercase letters and digits only, so "Claude Haiku 5.5", "claude-haiku-5.5"
// and "claude-haiku-5-5" are one model: Copilot's log id for a model is not
// always the id its picker or docs use.
export function normalizeModel(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function modelMatches(expected: string, used: string): boolean {
  const wanted = normalizeModel(expected);
  const ran = normalizeModel(used);
  // A dated variant ("...-20261101") still counts; a shorter id does not.
  return wanted !== "" && ran.includes(wanted);
}
