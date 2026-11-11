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
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { browser, expect } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../../src/diagnostics/test-hooks.js";
import type { McpStdioServerSpec } from "../../../../src/mcp/mcp-server-definitions.js";
import type { SessionsTreeNode } from "../../../../src/sidebar/sessions-tree-model.js";
import { wdioVscodeHost as host } from "../../support/vscode-host.js";
import { copilotTestTitle, REQUIRED_COPILOT_E2E_TESTS } from "../../../../scripts/release-evidence/evidence.mts";
import { modelMatches } from "../support/copilot-e2e-env.mts";
import { COPILOT_E2E_AGENT } from "../support/copilot-e2e-settings.mts";
import {
  COPILOT_CHAT_EXTENSION_ID,
  COPILOT_READY_LIMIT_MS,
  COPILOT_READY_POLL_MS,
  copilotReadiness,
  type CopilotReadiness,
  type CopilotSignals,
  NOT_OBSERVED,
} from "../support/copilot-readiness.mts";
import { logToRun, skipSuite, skipTest } from "../support/run-log.mts";

const [CHECK_1_4, CHECK_2_3, CHECK_2_4] = REQUIRED_COPILOT_E2E_TESTS;

const MODEL = process.env.AI_CREDITS_ANALYZER_COPILOT_E2E_MODEL ?? "claude-haiku-5.5";
// A chat turn, with tool calls, on a real model.
const TURN_TIMEOUT_MS = 240_000;
const POLL_MS = 5_000;
// Fixed and short: few tokens, so few AI Credits.
const PROMPT_PLAIN = "Reply with the single word: ok";
const PROMPT_MCP_PROVIDERS = "Call the ai-credits-analyzer MCP tool list_log_providers once, then reply with the single word: done";
const PROMPT_MCP_OTHER_AGENT = "Call the ai-credits-analyzer MCP tool list_sessions with provider claude-code once, then reply with the single word: done";

interface SessionSummary {
  id: string;
  title: string;
  model: string;
  turnCount: number;
}

let client: Client | undefined;
let knownSessionIds = new Set<string>();
let creditsSpent = 0;

function sessionNodes(tree: SessionsTreeNode[]): { sessionId: string; description: string }[] {
  return tree.flatMap((node) => (node.kind === "group" ? node.children : [])).map((node) => ({ sessionId: node.sessionId, description: node.description }));
}

async function sessionsTree(): Promise<SessionsTreeNode[]> {
  await host.command("aiCreditsAnalyzer.refreshSessions");
  return host.hook<SessionsTreeNode[]>(INTERNAL_COMMAND_IDS.sessionsTree);
}

async function tool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client!.callTool({ name, arguments: args });
  if (result.isError === true) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
  return result.structuredContent as T;
}

let lastSignalError = "";

// Each signal on its own, so one API that isn't there yet doesn't hide the
// others. No nested function in the remote body: it is sent as source text, and
// a helper the TypeScript loader adds to a nested function doesn't exist there.
async function copilotSignals(): Promise<CopilotSignals> {
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
    .catch((error: unknown) => {
      // Said once per distinct error, so a broken read never looks like "not ready yet".
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastSignalError) console.log(`[copilot-e2e] reading Copilot's readiness failed: ${message}`);
      lastSignalError = message;
      return NOT_OBSERVED;
    });
}

// Polls until Copilot is ready or the limit passes (copilotReadiness decides).
// TDD exception: the polling needs a real VS Code; the decision is unit-tested.
async function waitForCopilot(): Promise<CopilotReadiness> {
  const started = Date.now();
  // Asks Copilot Chat to start, in case it only activates when chat is first
  // used; not awaited, the polling below sees when it is active.
  await browser
    .executeWorkbench((vscode, extensionId: string) => {
      void vscode.extensions.getExtension(extensionId)?.activate();
    }, COPILOT_CHAT_EXTENSION_ID)
    .catch((error: unknown) => console.log(`[copilot-e2e] couldn't ask Copilot Chat to activate: ${String(error)}`));
  let readiness: CopilotReadiness = { status: "waiting" };
  await browser.waitUntil(
    async () => {
      readiness = copilotReadiness(await copilotSignals(), Date.now() - started);
      return readiness.status !== "waiting";
    },
    { timeout: COPILOT_READY_LIMIT_MS + 60_000, interval: COPILOT_READY_POLL_MS, timeoutMsg: "reading Copilot's readiness hung" },
  );
  const result = readiness as CopilotReadiness;
  if (result.status === "ready") console.log(`[copilot-e2e] Copilot ready after ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return result;
}

// Sends a prompt to agent mode and waits for a session that was not there
// before to show known AI Credits. Returns it.
async function chatAndWaitForNewSession(prompt: string): Promise<SessionSummary> {
  // A new chat each time, so each prompt makes its own session.
  await host.command("workbench.action.chat.newChat").catch(() => undefined);
  // The test-only agent: agent mode with the analyzer's MCP tools only (D6).
  await host.command("workbench.action.chat.open", { query: prompt, mode: COPILOT_E2E_AGENT });
  let found: string | undefined;
  await browser.waitUntil(
    async () => {
      const fresh = sessionNodes(await sessionsTree()).find((node) => !knownSessionIds.has(node.sessionId) && /^\d/.test(node.description));
      found = fresh?.sessionId;
      return found !== undefined;
    },
    { timeout: TURN_TIMEOUT_MS, interval: POLL_MS, timeoutMsg: "no new session with known AI Credits appeared (is Copilot signed in, and is the model available on your plan?)" },
  );
  knownSessionIds.add(found!);
  const { sessions } = await tool<{ sessions: SessionSummary[] }>("list_sessions", { query: found });
  const session = sessions.find((candidate) => candidate.id === found);
  if (!session) throw new Error(`list_sessions did not return ${found}`);
  const cost = await tool<{ totals: { aiCredits: { value: number } } }>("get_session_cost", { sessionId: found });
  creditsSpent += cost.totals.aiCredits.value;
  logToRun({ kind: "credits", spent: cost.totals.aiCredits.value });
  return session;
}

// The model Copilot used must be the one asked for; otherwise the run says so and
// skips, never fails on a spelling or a plan difference. The release gate
// still refuses the skip: the owner picks the model and reruns.
function requireModel(context: Mocha.Context, session: SessionSummary): void {
  // Printed for the owner to add to the Copilot log id register (docs/learn-rule-register.md).
  console.log(`[copilot-e2e] observed Copilot log id for ${MODEL}: ${session.model}`);
  logToRun({ kind: "observed-model", model: session.model });
  if (!modelMatches(MODEL, session.model)) {
    skipTest(context, `the session ran on "${session.model}", not ${MODEL} (not selected in the chat's model picker, not on your plan, or Copilot fell back).`);
  }
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
    knownSessionIds = new Set(sessionNodes(await sessionsTree()).map((node) => node.sessionId));

    const [definition] = await browser.waitUntil(async () => {
      const definitions = await host.hook<McpStdioServerSpec[]>(INTERNAL_COMMAND_IDS.mcpServerDefinitions);
      return definitions.length > 0 ? definitions : false;
    });
    client = new Client({ name: "copilot-e2e", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: definition!.command, args: definition!.args, env: definition!.env, stderr: "ignore" }));
  });

  suiteTeardown(async () => {
    await client?.close();
    console.log(`[copilot-e2e] AI Credits spent by the sessions of this run: ${creditsSpent.toFixed(4)}`);
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
