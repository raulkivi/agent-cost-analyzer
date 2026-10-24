// The real-VS Code integration suite (vscode-extension.md step 10.9, D9),
// run by @vscode/test-cli in an Extension Development Host on the `stable`
// build: `npm run build && npm run test:integration` in this package (under
// xvfb-run on Linux CI). .vscode-test.mjs seeds the fixture, a throwaway
// user-data dir with 200 Copilot Chat sessions, and passes it in the
// environment. Mocha's TDD interface (suite/test) is @vscode/test-cli's
// default. Not part of `npm test`: vitest excludes this folder.
//
// What it can't drive: Copilot Chat itself (agent mode listing the tools
// and calling them needs a signed-in Copilot), and a real click in the
// Sessions view (VS Code has no API for that, so the tests run the command
// the row's click runs). The extension's internals are read through its
// internal test-hook commands (diagnostics/test-hooks.ts), registered only
// in ExtensionMode.Test.
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { INTEGRATION_FIXTURE_ENV, parseIntegrationFixture } from "../../../scripts/integration-fixture-env.mts";
import { COMMAND_IDS, VIEW_IDS } from "../../commands/command-ids.js";
import type { RpcTraceEntry } from "../../diagnostics/rpc-trace.js";
import { INTERNAL_COMMAND_IDS } from "../../diagnostics/test-hooks.js";
import { MCP_ENABLED_SETTING_ID, type McpStdioServerSpec } from "../../mcp/mcp-server-definitions.js";
import { evaluateBudgets, formatBudgetReport } from "../../performance/performance-budgets.js";
import type { TimingMark } from "../../performance/performance-recorder.js";
import type { SessionsTreeNode } from "../../sidebar/sessions-tree-model.js";
import { sessionNodesOf } from "../integration-support/sessions-tree.js";
import { waitFor } from "../integration-support/wait-for.js";

const EXTENSION_ID = "raulkivi.ai-credits-analyzer";
// Generous: a CI machine under xvfb is slow to start a webview. The §3.5
// budgets are asserted separately, from the recorded marks.
const WAIT_MS = 30_000;
// The webview requests the panel makes on its own when it opens.
const STARTUP_METHODS = ["getHealth", "getProductProfile", "listLearnScenarios", "getConfigStatus", "listSessions"];
const MCP_TOOLS = [
  "get_audit_rollup",
  "get_cost_rollup",
  "get_session_audit",
  "get_session_cost",
  "get_turn",
  "list_findings",
  "list_log_providers",
  "list_sessions",
  "list_tool_calls",
];

const fixture = parseIntegrationFixture(process.env[INTEGRATION_FIXTURE_ENV]);

function run<T = unknown>(command: string, ...args: unknown[]): Thenable<T> {
  return vscode.commands.executeCommand<T>(command, ...args);
}

const timingMarks = () => run<TimingMark[]>(INTERNAL_COMMAND_IDS.perfMarks);
const rpcTrace = () => run<RpcTraceEntry[]>(INTERNAL_COMMAND_IDS.rpcTrace);
const sessionsTree = () => run<SessionsTreeNode[]>(INTERNAL_COMMAND_IDS.sessionsTree);
const mcpServerDefinitions = () => run<McpStdioServerSpec[]>(INTERNAL_COMMAND_IDS.mcpServerDefinitions);

// A fresh start for a test: no panel open, no marks or trace from before.
async function closePanelAndReset(): Promise<void> {
  await run("workbench.action.closeAllEditors");
  await run(INTERNAL_COMMAND_IDS.resetDiagnostics);
}

function answered(entries: RpcTraceEntry[], method: string, sessionId?: string): boolean {
  return entries.some((entry) => entry.method === method && entry.ok && (sessionId === undefined || entry.sessionId === sessionId));
}

async function setMcpEnabled(enabled: boolean): Promise<void> {
  await vscode.workspace.getConfiguration().update(MCP_ENABLED_SETTING_ID, enabled, vscode.ConfigurationTarget.Global);
}

suite("AI Credits Analyzer in a real VS Code (step 10.9)", function () {
  this.timeout(120_000);

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not loaded in the Extension Development Host`);
    await extension.activate();
  });

  suiteTeardown(async () => {
    await setMcpEnabled(false);
  });

  test("activates with every contributed command, and its test hooks in ExtensionMode.Test", async () => {
    const commands = new Set(await vscode.commands.getCommands(true));

    for (const id of [...Object.values(COMMAND_IDS), ...Object.values(INTERNAL_COMMAND_IDS)]) {
      assert.ok(commands.has(id), `${id} is not registered`);
    }
  });

  test("opens the panel, whose webview round-trips getHealth, getProductProfile, listLearnScenarios and getConfigStatus", async () => {
    await closePanelAndReset();

    await run(COMMAND_IDS.open);

    const entries = await waitFor(rpcTrace, (trace) => STARTUP_METHODS.every((method) => answered(trace, method)), {
      timeoutMs: WAIT_MS,
      description: `the webview's ${STARTUP_METHODS.join(", ")} requests`,
    });
    assert.deepEqual(
      entries.filter((entry) => !entry.ok),
      [],
      "no webview request failed",
    );
  });

  test("lists the seeded sessions in the Sessions view, and selecting one opens the panel on it", async () => {
    await run(`${VIEW_IDS.sessions}.focus`);
    await run(COMMAND_IDS.refreshSessions);
    const nodes = sessionNodesOf(
      await waitFor(sessionsTree, (tree) => sessionNodesOf(tree).length === fixture.sessionCount, {
        timeoutMs: WAIT_MS,
        description: `${fixture.sessionCount} sessions in the Sessions view`,
      }),
    );
    const usage = nodes.find((node) => node.sessionId === fixture.usageSessionId);
    assert.ok(usage, "the seeded usage session is listed");
    assert.equal(usage.label, fixture.usageSessionTitle);
    await closePanelAndReset();

    // What a click on the row runs (vscode/vscode-sidebar-views.ts).
    await run(COMMAND_IDS.openSession, usage.sessionId);

    await waitFor(rpcTrace, (trace) => answered(trace, "getSession", fixture.usageSessionId), {
      timeoutMs: WAIT_MS,
      description: "the panel to load the selected session",
    });
  });

  test("meets the §3.5 budgets: panel first render under 1 s with 200 sessions, Sessions tree under 500 ms", async () => {
    // The panel's webview infrastructure is warm from the tests above, as
    // it is for a user after the first open; the budget is the panel's.
    await closePanelAndReset();
    await run(COMMAND_IDS.open);
    await run(COMMAND_IDS.refreshSessions);

    const marks = await waitFor(
      timingMarks,
      (recorded) => ["first-render", "data-ready", "sessions-tree"].every((name) => recorded.some((mark) => mark.name === name)),
      { timeoutMs: WAIT_MS, description: "the first-render, data-ready and sessions-tree marks" },
    );

    const report = evaluateBudgets(marks);
    assert.ok(report.ok, `§3.5 budgets not met:\n${formatBudgetReport(report)}`);
  });

  suite("MCP server (D7, carried over from 10.8)", () => {
    test("offers no server while aiCreditsAnalyzer.mcp.enabled is off", async () => {
      await setMcpEnabled(false);

      assert.deepEqual(await mcpServerDefinitions(), []);
    });

    test("with the setting on, offers one server that lists the 9 tools and answers get_session_cost for the seeded session", async () => {
      await setMcpEnabled(true);
      const [definition, ...others] = await waitFor(mcpServerDefinitions, (definitions) => definitions.length > 0, {
        timeoutMs: WAIT_MS,
        description: "the MCP server definition",
      });
      assert.equal(others.length, 0);
      assert.ok(definition);

      // Started exactly as VS Code starts it: the definition's command
      // (VS Code's own Electron, as Node), args and env.
      const client = new Client({ name: "integration-test", version: "1.0.0" });
      await client.connect(
        new StdioClientTransport({ command: definition.command, args: definition.args, env: definition.env, stderr: "ignore" }),
      );
      try {
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map((tool) => tool.name).sort(), MCP_TOOLS);

        const cost = await client.callTool({ name: "get_session_cost", arguments: { sessionId: fixture.usageSessionId } });
        assert.notEqual(cost.isError, true, JSON.stringify(cost.content));
        const totals = (cost.structuredContent as { totals?: { aiCredits?: { value: unknown } } }).totals;
        assert.equal(typeof totals?.aiCredits?.value, "number", "the usage session's AI Credits are known");
      } finally {
        await client.close();
      }
    });

    test("offers no server again once the setting is turned off", async () => {
      await setMcpEnabled(false);

      await waitFor(mcpServerDefinitions, (definitions) => definitions.length === 0, {
        timeoutMs: WAIT_MS,
        description: "no MCP server definition",
      });
    });
  });
});
