// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What every real-Copilot spec needs (vscode-ui-automation.md §7): wait for
// Copilot to be ready, open a chat in the test-only agent, reach the
// analyzer's own MCP server to read what the chat did, and check the model.
// Shared by copilot-agent.e2e.ts (checks 1.4, 2.3, 2.4) and
// copilot-views.e2e.ts (G4, the MCP App views).
// TDD exception: the polling and the chat need a real VS Code; the decisions
// (copilot-readiness.mts, modelMatches) are unit-tested.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { browser } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../../src/diagnostics/test-hooks.js";
import type { McpStdioServerSpec } from "../../../../src/mcp/mcp-server-definitions.js";
import type { SessionsTreeNode } from "../../../../src/sidebar/sessions-tree-model.js";
import { wdioVscodeHost as host } from "../../support/vscode-host.js";
import { modelMatches } from "./copilot-e2e-env.mts";
import { COPILOT_E2E_AGENT } from "./copilot-e2e-settings.mts";
import {
  COPILOT_CHAT_EXTENSION_ID,
  COPILOT_READY_LIMIT_MS,
  COPILOT_READY_POLL_MS,
  copilotReadiness,
  type CopilotReadiness,
  type CopilotSignals,
  NOT_OBSERVED,
} from "./copilot-readiness.mts";
import { logToRun, skipTest } from "./run-log.mts";

export const MODEL = process.env.AI_CREDITS_ANALYZER_COPILOT_E2E_MODEL ?? "claude-haiku-5.5";

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
export async function waitForCopilot(): Promise<CopilotReadiness> {
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

export interface SessionSummary {
  id: string;
  title: string;
  model: string;
  turnCount: number;
}

// The analyzer's own MCP server (the one the chat calls), reached directly to
// read what a chat did; never through the model.
export class AnalyzerClient {
  private constructor(private readonly client: Client) {}

  static async connect(): Promise<AnalyzerClient> {
    const [definition] = await browser.waitUntil(async () => {
      const definitions = await host.hook<McpStdioServerSpec[]>(INTERNAL_COMMAND_IDS.mcpServerDefinitions);
      return definitions.length > 0 ? definitions : false;
    });
    const client = new Client({ name: "copilot-e2e", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: definition!.command, args: definition!.args, env: definition!.env, stderr: "ignore" }));
    return new AnalyzerClient(client);
  }

  async tool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.client.callTool({ name, arguments: args });
    if (result.isError === true) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
    return result.structuredContent as T;
  }

  async session(id: string): Promise<SessionSummary> {
    const { sessions } = await this.tool<{ sessions: SessionSummary[] }>("list_sessions", { query: id });
    const session = sessions.find((candidate) => candidate.id === id);
    if (!session) throw new Error(`list_sessions did not return ${id}`);
    return session;
  }

  async aiCredits(sessionId: string): Promise<number | null> {
    const cost = await this.tool<{ totals: { aiCredits: { value: number | null } } }>("get_session_cost", { sessionId });
    return cost.totals.aiCredits.value;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

function sessionNodes(tree: SessionsTreeNode[]): { sessionId: string; description: string }[] {
  return tree.flatMap((node) => (node.kind === "group" ? node.children : [])).map((node) => ({ sessionId: node.sessionId, description: node.description }));
}

// The sessions the Sessions view lists, with whether their AI Credits are known.
export async function listedSessions(): Promise<{ sessionId: string; creditsKnown: boolean }[]> {
  await host.command("aiCreditsAnalyzer.refreshSessions");
  const tree = await host.hook<SessionsTreeNode[]>(INTERNAL_COMMAND_IDS.sessionsTree);
  return sessionNodes(tree).map((node) => ({ sessionId: node.sessionId, creditsKnown: /^\d/.test(node.description) }));
}

// A new chat in the test-only agent: agent mode with the analyzer's MCP tools only (D6).
export async function sendToAgent(prompt: string): Promise<void> {
  await host.command("workbench.action.chat.newChat").catch(() => undefined);
  await host.command("workbench.action.chat.open", { query: prompt, mode: COPILOT_E2E_AGENT });
}

// Waits for a session that isn't in `known` to show known AI Credits, and returns its id.
export async function waitForNewSession(known: ReadonlySet<string>, timeout: number): Promise<string> {
  let found: string | undefined;
  await browser.waitUntil(
    async () => {
      found = (await listedSessions()).find((node) => !known.has(node.sessionId) && node.creditsKnown)?.sessionId;
      return found !== undefined;
    },
    { timeout, interval: 5_000, timeoutMsg: "no new session with known AI Credits appeared (is Copilot signed in, and is the model available on your plan?)" },
  );
  return found!;
}

// The model Copilot used must be the one asked for; otherwise the run says so and
// skips, never fails on a spelling or a plan difference. The release gate
// still refuses the skip: the owner picks the model and reruns.
export function requireModel(context: Mocha.Context, session: SessionSummary): void {
  // Printed for the owner to add to the Copilot log id register (docs/learn-rule-register.md).
  console.log(`[copilot-e2e] observed Copilot log id for ${MODEL}: ${session.model}`);
  logToRun({ kind: "observed-model", model: session.model });
  if (!modelMatches(MODEL, session.model)) {
    skipTest(context, `the session ran on "${session.model}", not ${MODEL} (not selected in the chat's model picker, not on your plan, or Copilot fell back).`);
  }
}
