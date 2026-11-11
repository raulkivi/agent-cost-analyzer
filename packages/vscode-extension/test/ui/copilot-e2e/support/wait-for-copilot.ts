// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Waits for the real Copilot Chat to be ready (signed in, active, a model),
// for the specs of step 10.17 G7. The decision is the unit-tested
// copilot-readiness.mts; this is the polling, which needs a real VS Code (TDD
// exception). copilot-agent.e2e.ts has its own copy of the same loop.
import { browser } from "@wdio/globals";
import {
  COPILOT_CHAT_EXTENSION_ID,
  COPILOT_READY_LIMIT_MS,
  COPILOT_READY_POLL_MS,
  copilotReadiness,
  type CopilotReadiness,
  type CopilotSignals,
  NOT_OBSERVED,
} from "./copilot-readiness.mts";

// Each signal on its own, so one API that isn't there yet doesn't hide the
// others. No nested function in the remote body: it is sent as source text.
async function signals(): Promise<CopilotSignals> {
  return browser
    .executeWorkbench(async (vscode, extensionId: string) => {
      let githubAccount: boolean;
      let copilotModels: number;
      try {
        githubAccount = (await vscode.authentication.getAccounts("github")).length > 0;
      } catch {
        githubAccount = false;
      }
      try {
        copilotModels = (await vscode.lm.selectChatModels({ vendor: "copilot" })).length;
      } catch {
        copilotModels = 0;
      }
      return { githubAccount, copilotChatActive: vscode.extensions.getExtension(extensionId)?.isActive === true, copilotModels };
    }, COPILOT_CHAT_EXTENSION_ID)
    .catch(() => NOT_OBSERVED);
}

export async function waitForCopilotReady(): Promise<CopilotReadiness> {
  const started = Date.now();
  await browser
    .executeWorkbench((vscode, extensionId: string) => {
      void vscode.extensions.getExtension(extensionId)?.activate();
    }, COPILOT_CHAT_EXTENSION_ID)
    .catch(() => undefined);
  let readiness: CopilotReadiness = { status: "waiting" };
  await browser.waitUntil(
    async () => {
      readiness = copilotReadiness(await signals(), Date.now() - started);
      return readiness.status !== "waiting";
    },
    { timeout: COPILOT_READY_LIMIT_MS + 60_000, interval: COPILOT_READY_POLL_MS, timeoutMsg: "reading Copilot's readiness hung" },
  );
  return readiness as CopilotReadiness;
}
