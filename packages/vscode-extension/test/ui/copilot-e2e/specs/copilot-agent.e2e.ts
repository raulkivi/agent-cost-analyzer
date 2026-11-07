// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// OPT-IN, OWNER-RUN, spends real AI Credits: manual checks 1.4, 2.3 and 2.4
// (docs/plans/vscode-extension-manual-checks.md) with a real signed-in Copilot
// Chat in agent mode. See wdio.copilot.conf.mts for how to run it and
// docs/plans/vscode-ui-automation.md §7 for what it proves. Never runs in CI.
//
// Not verified end to end by its author (no Copilot account on the build
// machine): the chat-opening command's arguments, the auto-approve setting and
// the polling below are written from VS Code's documented commands.
//
// Asserts only what does not depend on the model's words: a session appears
// with known AI Credits, turns and tokens, and the MCP tool calls appear in the
// session's tool-call audit. No assertion reads response text.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { browser, expect } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../../src/diagnostics/test-hooks.js";
import type { McpStdioServerSpec } from "../../../../src/mcp/mcp-server-definitions.js";
import type { SessionsTreeNode } from "../../../../src/sidebar/sessions-tree-model.js";
import { wdioVscodeHost as host } from "../../support/vscode-host.js";
import { modelMatches } from "../support/copilot-e2e-env.mts";

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

// Sends a prompt to agent mode and waits for a session that was not there
// before to show known AI Credits. Returns it.
async function chatAndWaitForNewSession(prompt: string): Promise<SessionSummary> {
  // A new chat each time, so each prompt makes its own session.
  await host.command("workbench.action.chat.newChat").catch(() => undefined);
  await host.command("workbench.action.chat.open", { query: prompt, mode: "agent" });
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
  return session;
}

// The model Copilot used must be the one asked for; otherwise the run says so and
// skips, never fails on a spelling or a plan difference.
function requireModel(context: Mocha.Context, session: SessionSummary): void {
  // Printed for the owner to add to the Copilot log id register (docs/learn-rule-register.md).
  console.log(`[copilot-e2e] observed Copilot log id for ${MODEL}: ${session.model}`);
  if (!modelMatches(MODEL, session.model)) {
    console.log(`[copilot-e2e] SKIPPED: the session ran on "${session.model}", not ${MODEL} (not selected in the chat's model picker, not on your plan, or Copilot fell back).`);
    context.skip();
  }
}

suite("Real Copilot agent mode (checks 1.4, 2.3, 2.4; opt-in)", function () {
  this.timeout(600_000);

  suiteSetup(async function () {
    await host.waitForExtension();
    // Copilot Chat is built in; it is off until enabled (the profile may already have it on).
    await host.command("workbench.extensions.action.enableAll");
    const signedIn = await browser
      .executeWorkbench(async (vscode) => (await vscode.authentication.getAccounts("github")).length > 0)
      .catch(() => false);
    if (!signedIn) {
      console.log("[copilot-e2e] SKIPPED: no GitHub account is signed in in the copied profile: run npm run test:ui:vscode:copilot:signin once.");
      this.skip();
    }
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

  test("1.4 a real agent-mode chat produces a session with known AI Credits, turns and tokens, and the MCP tools offer it", async function () {
    const session = await chatAndWaitForNewSession(PROMPT_PLAIN);
    requireModel(this, session);

    expect(session.turnCount).toBeGreaterThanOrEqual(1);
    const cost = await tool<{ totals: { aiCredits: { value: number }; tokens?: Record<string, { value: number | null }> } }>("get_session_cost", { sessionId: session.id });
    expect(cost.totals.aiCredits.value).toBeGreaterThan(0);
    const status = (await browser.getWorkbench()).getStatusBar().getItems();
    expect((await status).some((item) => item.includes("AI Credits today"))).toBe(true);
  });

  test("2.3 asked to call an MCP tool, Copilot's call appears in the session's tool-call audit", async function () {
    const session = await chatAndWaitForNewSession(PROMPT_MCP_PROVIDERS);
    requireModel(this, session);

    const calls = await tool<{ total: number; calls: unknown[] }>("list_tool_calls", { sessionId: session.id, kind: ["mcp"] });
    expect(calls.total).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(calls.calls)).toMatch(/list_log_providers/);
  });

  test("2.4 asked about another agent's sessions, Copilot's call to the tool appears in the audit", async function () {
    const session = await chatAndWaitForNewSession(PROMPT_MCP_OTHER_AGENT);
    requireModel(this, session);

    const calls = await tool<{ total: number; calls: unknown[] }>("list_tool_calls", { sessionId: session.id, kind: ["mcp"] });
    expect(calls.total).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(calls.calls)).toMatch(/list_sessions/);
  });
});
