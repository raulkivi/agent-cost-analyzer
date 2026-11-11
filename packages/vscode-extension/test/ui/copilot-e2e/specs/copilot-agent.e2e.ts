// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// OPT-IN, OWNER-RUN, spends real AI Credits: manual checks 1.4, 2.3 and 2.4
// (docs/plans/vscode-extension-manual-checks.md) with a real signed-in Copilot
// Chat in agent mode. See wdio.copilot.conf.mts for how to run it and
// docs/plans/vscode-ui-automation.md §7 for what it proves. Never runs in CI.
//
// Asserts only what does not depend on the model's words: a session appears
// with known AI Credits, turns and tokens, and the MCP tool calls appear in the
// session's tool-call audit. No assertion reads response text.
//
// Its result is the release evidence of owner decision D1
// (docs/plans/release-ui-gate.md, G2): test titles start with the check ids the
// release gate requires, and every skip records its reason in the run log.
import { browser, expect } from "@wdio/globals";
import { wdioVscodeHost as host } from "../../support/vscode-host.js";
import { COPILOT_CHAT_CHECKS, copilotTestTitle } from "../../../../scripts/release-evidence/evidence.mts";
import { AnalyzerClient, listedSessions, requireModel, sendToAgent, type SessionSummary, waitForCopilot, waitForNewSession } from "../support/copilot-chat.js";
import { logToRun, skipSuite } from "../support/run-log.mts";

const [CHECK_1_4, CHECK_2_3, CHECK_2_4] = COPILOT_CHAT_CHECKS;

// A chat turn, with tool calls, on a real model.
const TURN_TIMEOUT_MS = 240_000;
// Fixed and short: few tokens, so few AI Credits.
const PROMPT_PLAIN = "Reply with the single word: ok";
const PROMPT_MCP_PROVIDERS = "Call the ai-credits-analyzer MCP tool list_log_providers once, then reply with the single word: done";
const PROMPT_MCP_OTHER_AGENT = "Call the ai-credits-analyzer MCP tool list_sessions with provider claude-code once, then reply with the single word: done";

let analyzer: AnalyzerClient | undefined;
let knownSessionIds = new Set<string>();
let creditsSpent = 0;

async function tool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  return analyzer!.tool<T>(name, args);
}

// Sends a prompt to agent mode and waits for a session that was not there
// before to show known AI Credits. Returns it.
async function chatAndWaitForNewSession(prompt: string): Promise<SessionSummary> {
  // A new chat each time, so each prompt makes its own session.
  await sendToAgent(prompt);
  const found = await waitForNewSession(knownSessionIds, TURN_TIMEOUT_MS);
  knownSessionIds.add(found);
  const session = await analyzer!.session(found);
  const spent = (await analyzer!.aiCredits(found)) ?? 0;
  creditsSpent += spent;
  logToRun({ kind: "credits", spent });
  return session;
}

suite("Real Copilot agent mode (checks 1.4, 2.3, 2.4; opt-in)", function () {
  this.timeout(600_000);

  suiteSetup(async function () {
    await host.waitForExtension();
    // Copilot Chat is built in; it is off until enabled (the profile may already have it on).
    await host.command("workbench.extensions.action.enableAll");
    // Copilot needs a while after start-up: wait for it rather than skip a slow start.
    const readiness = await waitForCopilot();
    if (readiness.status === "gave-up") skipSuite(this, readiness.reason);
    knownSessionIds = new Set((await listedSessions()).map((node) => node.sessionId));
    analyzer = await AnalyzerClient.connect();
  });

  suiteTeardown(async () => {
    await analyzer?.close();
    console.log(`[copilot-e2e] AI Credits spent by the sessions of this spec: ${creditsSpent.toFixed(4)}`);
  });

  test(copilotTestTitle(CHECK_1_4, "a real agent-mode chat produces a session with known AI Credits, turns and tokens, and the MCP tools offer it"), async function () {
    const session = await chatAndWaitForNewSession(PROMPT_PLAIN);
    requireModel(this, session);

    expect(session.turnCount).toBeGreaterThanOrEqual(1);
    const cost = await tool<{ totals: { aiCredits: { value: number }; tokens?: Record<string, { value: number | null }> } }>("get_session_cost", { sessionId: session.id });
    expect(cost.totals.aiCredits.value).toBeGreaterThan(0);
    const status = (await browser.getWorkbench()).getStatusBar().getItems();
    expect((await status).some((item) => item.includes("AI Credits today"))).toBe(true);
  });

  test(copilotTestTitle(CHECK_2_3, "asked to call an MCP tool, Copilot's call appears in the session's tool-call audit"), async function () {
    const session = await chatAndWaitForNewSession(PROMPT_MCP_PROVIDERS);
    requireModel(this, session);

    const calls = await tool<{ total: number; calls: unknown[] }>("list_tool_calls", { sessionId: session.id, kind: ["mcp"] });
    expect(calls.total).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(calls.calls)).toMatch(/list_log_providers/);
  });

  test(copilotTestTitle(CHECK_2_4, "asked about another agent's sessions, Copilot's call to the tool appears in the audit"), async function () {
    const session = await chatAndWaitForNewSession(PROMPT_MCP_OTHER_AGENT);
    requireModel(this, session);

    const calls = await tool<{ total: number; calls: unknown[] }>("list_tool_calls", { sessionId: session.id, kind: ["mcp"] });
    expect(calls.total).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(calls.calls)).toMatch(/list_sessions/);
  });
});
