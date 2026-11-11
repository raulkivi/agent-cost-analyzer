// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What every real-Copilot spec needs (vscode-ui-automation.md §7): wait for
// Copilot to be ready, open a chat in the test-only agent, reach the
// analyzer's own MCP server to read what the chat did, and check the model.
// Shared by copilot-agent.e2e.ts (checks 1.4, 2.3, 2.4), copilot-views.e2e.ts
// (G4, the MCP App views) and extension-rows.e2e.ts (1.14). Every chat goes
// through sendToAgent, which sends only within the run's AI Credits cap and
// only when the chat's model picker shows the requested model (R5).
// TDD exception: the polling and the chat need a real VS Code; the decisions
// (copilot-readiness.mts, modelMatches, pre-send-model.mts, credit-budget.mts,
// in-flight-model.mts) are unit-tested.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { browser } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../../src/diagnostics/test-hooks.js";
import type { McpStdioServerSpec } from "../../../../src/mcp/mcp-server-definitions.js";
import type { SessionsTreeNode } from "../../../../src/sidebar/sessions-tree-model.js";
import { wdioVscodeHost as host } from "../../support/vscode-host.js";
import { readRunArtifacts } from "../../../../scripts/release-evidence/run-artifacts.mts";
import { modelMatches } from "./copilot-e2e-env.mts";
import { COPILOT_E2E_AGENT } from "./copilot-e2e-settings.mts";
import { budgetCheck, creditsSpent, DEFAULT_MAX_AI_CREDITS, MAX_AI_CREDITS_ENV, MAX_AI_CREDITS_INTERNAL_ENV } from "./credit-budget.mts";
import { firstModelRequest, type InFlightCheck, inFlightCheck, loggedCredits, newEntries } from "./in-flight-model.mts";
import { preSendModelCheck, preSendSessionCheck, shownModelOf } from "./pre-send-model.mts";
import {
  COPILOT_CHAT_EXTENSION_ID,
  COPILOT_READY_LIMIT_MS,
  COPILOT_READY_POLL_MS,
  copilotReadiness,
  type CopilotReadiness,
  type CopilotSignals,
  NOT_OBSERVED,
} from "./copilot-readiness.mts";
import { COPILOT_E2E_ROOT_ENV, evidenceDirOf, logToRun, skipSuite, skipTest } from "./run-log.mts";

export const MODEL = process.env.AI_CREDITS_ANALYZER_COPILOT_E2E_MODEL ?? "claude-haiku-5.5";
const MAX_AI_CREDITS = Number(process.env[MAX_AI_CREDITS_INTERNAL_ENV] ?? DEFAULT_MAX_AI_CREDITS);
// How long the picker may take to show the model the open command selected.
const PICKER_SETTLE_MS = 5_000;
// The in-flight guard: how often it reads the new session's debug log, and
// how long it waits for the first logged request before leaving the chat to
// the after-chat check.
const IN_FLIGHT_POLL_MS = 250;
const FIRST_REQUEST_LIMIT_MS = 180_000;
// Written once a chat was cancelled on a wrong model: every later chat of the
// run skips unsent (the same cause would cost the same again).
const STOP_FILE = "stop-sending.txt";

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

// The run log every spec file of the run appends to (run-log.mts).
function runLog() {
  const root = process.env[COPILOT_E2E_ROOT_ENV];
  return root === undefined || root === "" ? [] : readRunArtifacts(evidenceDirOf(root)).log;
}

// What a chat cost, for the release evidence and the run's cap; says when the cap is reached.
export function recordChatCredits(spent: number): void {
  logToRun({ kind: "credits", spent });
  const total = creditsSpent(runLog());
  console.log(`[copilot-e2e] AI Credits spent by the run so far: ${total.toFixed(4)} (cap ${MAX_AI_CREDITS}, ${MAX_AI_CREDITS_ENV})`);
  if (total >= MAX_AI_CREDITS) console.log("[copilot-e2e] AI Credits budget exceeded: every remaining chat skips unsent");
}

// The accessible names in the chat input; the model picker's is "Models, <name>".
async function inputLabels(): Promise<string[]> {
  return browser.execute(() => Array.from(document.querySelectorAll(".interactive-input-part [aria-label]"), (element) => element.getAttribute("aria-label") ?? ""));
}

// The chat input's labels once `ready` holds, or as they are when the settle time passes.
async function settledLabels(ready: (labels: string[]) => boolean): Promise<string[]> {
  let labels: string[] = [];
  await browser
    .waitUntil(
      async () => {
        labels = await inputLabels();
        return ready(labels);
      },
      { timeout: PICKER_SETTLE_MS, interval: 250 },
    )
    .catch(() => undefined);
  return labels;
}

// Copilot's name for the requested model ("Claude Haiku 5.5"), as the picker shows it.
async function requestedModelName(): Promise<string | undefined> {
  const name: unknown = await browser
    .executeWorkbench(async (vscode, id: string) => (await vscode.lm.selectChatModels({ vendor: "copilot", id }))[0]?.name, MODEL)
    .catch(() => undefined);
  return typeof name === "string" ? name : undefined;
}

// A new chat in the test-only agent: agent mode with the analyzer's MCP tools
// only (D6). Sent only while the run is under its AI Credits cap, and only
// when the chat's picker shows MODEL: VS Code 1.146 can start a new chat on
// another model whatever the seeded state says (R5), so the open command
// selects the model (modelSelector) and the picker is read back from the
// widget. Otherwise the test (or, from a suiteSetup, the suite) skips unsent.
export async function sendToAgent(context: Mocha.Context, prompt: string, scope: "test" | "suite" = "test"): Promise<void> {
  const skip = scope === "suite" ? skipSuite : skipTest;
  const stopped = stopReason();
  if (stopped !== undefined) skip(context, `an earlier chat of this run was cancelled (${stopped}); nothing was sent.`);
  const budget = budgetCheck(runLog(), MAX_AI_CREDITS);
  if (!budget.send) skip(context, budget.reason);

  await host.command("workbench.action.chat.newChat").catch(() => undefined);
  let selectError: string | undefined;
  // isPartialQuery puts the prompt in the input without sending it.
  await host
    .command("workbench.action.chat.open", { mode: COPILOT_E2E_AGENT, modelSelector: { vendor: "copilot", id: MODEL }, query: prompt, isPartialQuery: true })
    .catch((error: unknown) => {
      selectError = error instanceof Error ? error.message : String(error);
    });
  const requested = { id: MODEL, name: await requestedModelName() };
  // The picker, the agent and the session target render one after another.
  const preSend = (labels: string[]) => {
    const model = preSendModelCheck({ requested, shown: shownModelOf(labels), selectError });
    return model.send ? preSendSessionCheck(labels, COPILOT_E2E_AGENT) : model;
  };
  const labels = await settledLabels((current) => preSend(current).send);
  const shown = shownModelOf(labels);
  console.log(`[copilot-e2e] the chat's model picker shows ${shown === undefined ? "no model" : `"${shown}"`} before sending`);
  const decision = preSend(labels);
  if (!decision.send) {
    console.log(`[copilot-e2e] the chat input showed: ${JSON.stringify(labels.filter((label) => label.length < 80))}`);
    // Drops the unsent prompt.
    await host.command("workbench.action.chat.newChat").catch(() => undefined);
    skip(context, decision.reason);
  }
  // The generic open has no mode of its own: it sends from the same chat, on the model just read.
  const before = sessionSnapshot();
  await host.command("workbench.action.chat.open", { query: prompt });

  const watched = await watchFirstRequest(before);
  if (watched.check.verdict === "cancel") {
    await host.command("workbench.action.chat.cancel").catch((error: unknown) => console.log(`[copilot-e2e] cancelling the chat failed: ${String(error)}`));
    console.log(`[copilot-e2e] CANCELLED: ${watched.check.reason}`);
    // What the cancelled chat cost so far counts toward the run's cap.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    if (watched.log !== undefined) recordChatCredits(loggedCredits(readText(watched.log)));
    writeFileSync(stopFile()!, watched.check.reason);
    skip(context, watched.check.reason);
  }
  if (watched.check.verdict === "waiting") console.log(`[copilot-e2e] no request was logged within ${FIRST_REQUEST_LIMIT_MS / 1000} s; the after-chat check decides`);
}

function runRoot(): string | undefined {
  const root = process.env[COPILOT_E2E_ROOT_ENV];
  return root === undefined || root === "" ? undefined : root;
}

function stopFile(): string | undefined {
  const root = runRoot();
  return root === undefined ? undefined : path.join(root, STOP_FILE);
}

function stopReason(): string | undefined {
  const file = stopFile();
  return file !== undefined && existsSync(file) ? readFileSync(file, "utf-8") : undefined;
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readText(file: string): string {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return "";
  }
}

// Every Copilot Chat debug log of the run's VS Code (folder and empty-window
// locations), as <dir>/<session id>/main.jsonl.
function debugLogs(): string[] {
  const root = runRoot();
  if (root === undefined) return [];
  const user = path.join(root, "storage", "settings", "User");
  const workspaces = path.join(user, "workspaceStorage");
  const dirs = [...list(workspaces).map((id) => path.join(workspaces, id, "GitHub.copilot-chat", "debug-logs")), path.join(user, "globalStorage", "github.copilot-chat", "debug-logs")];
  return dirs.flatMap((dir) => list(dir).map((session) => path.join(dir, session, "main.jsonl")));
}

// Copilot CLI sessions in the run's COPILOT_HOME: the Copilot SDK harness's chats.
function agentHostSessions(): string[] {
  const home = process.env.COPILOT_HOME;
  return home === undefined || home === "" ? [] : list(path.join(home, "session-state"));
}

interface SessionSnapshot {
  logs: Set<string>;
  agentHost: Set<string>;
}

function sessionSnapshot(): SessionSnapshot {
  return { logs: new Set(debugLogs()), agentHost: new Set(agentHostSessions()) };
}

// Watches what the chat just sent starts, until its first logged request (or a
// Copilot SDK harness session) decides, or the limit passes.
async function watchFirstRequest(before: SessionSnapshot): Promise<{ check: InFlightCheck; log?: string }> {
  const started = Date.now();
  while (Date.now() - started < FIRST_REQUEST_LIMIT_MS) {
    const agentHost = newEntries(before.agentHost, agentHostSessions());
    for (const log of newEntries(before.logs, debugLogs())) {
      const firstRequest = firstModelRequest(readText(log));
      if (firstRequest === undefined) continue;
      console.log(`[copilot-e2e] first logged request after ${((Date.now() - started) / 1000).toFixed(1)} s: ${firstRequest.model} (${firstRequest.debugName ?? "no debug name"})`);
      return { check: inFlightCheck({ requested: MODEL, firstRequest, agentHostSessions: agentHost }), log };
    }
    const check = inFlightCheck({ requested: MODEL, firstRequest: undefined, agentHostSessions: agentHost });
    if (check.verdict !== "waiting") return { check };
    await new Promise((resolve) => setTimeout(resolve, IN_FLIGHT_POLL_MS));
  }
  return { check: { verdict: "waiting" } };
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
