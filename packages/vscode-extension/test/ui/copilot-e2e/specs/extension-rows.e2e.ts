// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// OPT-IN, OWNER-RUN: the extension rows that need the real Copilot Chat, step
// 10.17 G7 (docs/plans/release-ui-gate.md): manual check 2.1's *Configure
// Tools* wording and check 1.14 on a real git folder
// (docs/plans/vscode-extension-manual-checks.md). Run with the real-Copilot
// suite (wdio.copilot.conf.mts, docs/plans/vscode-ui-automation.md §7).
//
// 2.1 sends no message and costs no AI Credits. 1.14 runs one short chat in the
// test-only agent (analyzer tools only, nothing auto-approved, as G3/D6) in
// the suite's workspace, a git folder with a made-up remote, and asserts only
// on the analyzer's UI and data, never on the model's text.
import { browser, expect } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../../src/diagnostics/test-hooks.js";
import { COMMAND_IDS } from "../../../../src/commands/command-ids.js";
import type { GroupNode, SessionsTreeNode } from "../../../../src/sidebar/sessions-tree-model.js";
import { copilotTestTitle } from "../../../../scripts/release-evidence/evidence.mts";
import { E2E_REPOSITORY } from "../../../../scripts/ui-automation/git-folder.mts";
import { wdioVscodeHost as host } from "../../support/vscode-host.js";
import { recordChatCredits, sendToAgent } from "../support/copilot-chat.js";
import { ANALYZER_SERVER_LABEL, ConfigureToolsPicker } from "../support/configure-tools-picker.js";
import { groupCredits, repositoryStatusCredits } from "../support/repository-status.mts";
import { skipSuite } from "../support/run-log.mts";
import { waitForCopilotReady } from "../support/wait-for-copilot.js";

const MCP_SETTING = "aiCreditsAnalyzer.mcp.enabled";
const TURN_TIMEOUT_MS = 240_000;
const POLL_MS = 5_000;
// Fixed and short: few tokens, so few AI Credits.
const PROMPT = "Reply with the single word: ok";

async function useCopilot(context: Mocha.Context): Promise<void> {
  await host.waitForExtension();
  // Copilot Chat is built in; it is off until enabled (the profile may already have it on).
  await host.command("workbench.extensions.action.enableAll");
  const readiness = await waitForCopilotReady();
  if (readiness.status === "gave-up") skipSuite(context, readiness.reason);
}

suite("Copilot's Configure Tools picker (check 2.1; opt-in)", function () {
  this.timeout(300_000);
  const picker = new ConfigureToolsPicker(host);

  suiteSetup(async function () {
    await useCopilot(this);
  });

  suiteTeardown(async () => {
    // The suite's settings have it on.
    await host.setSetting(MCP_SETTING, true);
  });

  test(copilotTestTitle("2.1", "with aiCreditsAnalyzer.mcp.enabled off, agent mode's Configure Tools lists no AI Credits Analyzer server"), async () => {
    await host.setSetting(MCP_SETTING, false);

    const rows = await picker.waitUntilListed(false);

    // Not vacuous: the picker is open and lists Copilot's own tools.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.includes(ANALYZER_SERVER_LABEL))).toBe(false);
    console.log(`[copilot-e2e] Configure Tools with the setting off: ${rows.length} rows, no ${ANALYZER_SERVER_LABEL}`);
  });

  test(copilotTestTitle("2.1", "with the setting on, Configure Tools lists the server under its label, AI Credits Analyzer"), async () => {
    await host.setSetting(MCP_SETTING, true);

    const rows = await picker.waitUntilListed(true);

    expect(rows.filter((row) => row.includes(ANALYZER_SERVER_LABEL))).not.toEqual([]);
  });
});

interface NewSession {
  id: string;
  credits: number;
}

let knownSessionIds = new Set<string>();
let chat: NewSession | undefined;

async function sessionsTree(): Promise<SessionsTreeNode[]> {
  await host.command(COMMAND_IDS.refreshSessions);
  return host.hook<SessionsTreeNode[]>(INTERNAL_COMMAND_IDS.sessionsTree);
}

function groups(tree: SessionsTreeNode[]): GroupNode[] {
  return tree.filter((node): node is GroupNode => node.kind === "group");
}

function sessionIds(tree: SessionsTreeNode[]): string[] {
  return groups(tree).flatMap((group) => group.children.map((child) => child.sessionId));
}

function repositoryGroup(tree: SessionsTreeNode[]): GroupNode | undefined {
  return groups(tree).find((group) => group.label === E2E_REPOSITORY.key);
}

async function statusBarItems(): Promise<string[]> {
  return (await browser.getWorkbench()).getStatusBar().getItems();
}

suite("Check 1.14 on a real git folder (opt-in; one chat)", function () {
  this.timeout(600_000);

  suiteSetup(async function () {
    await useCopilot(this);
    await host.command(COMMAND_IDS.groupSessionsByDay);
    knownSessionIds = new Set(sessionIds(await sessionsTree()));
    // Every 1.14 test needs the chat: unsent, and the suite skips, over the AI
    // Credits cap or when the picker shows another model.
    await sendToAgent(this, PROMPT, "suite");
  });

  suiteTeardown(async () => {
    await host.command(COMMAND_IDS.groupSessionsByDay);
    if (chat) console.log(`[copilot-e2e] AI Credits spent by the 1.14 chat: ${chat.credits.toFixed(4)}`);
  });

  test(copilotTestTitle("1.14", "a real agent-mode chat in the git folder produces a session with known AI Credits"), async () => {
    let found: { id: string; description: string } | undefined;
    await browser.waitUntil(
      async () => {
        const fresh = groups(await sessionsTree())
          .flatMap((group) => group.children)
          .find((child) => !knownSessionIds.has(child.sessionId) && /^\d/.test(child.description));
        found = fresh ? { id: fresh.sessionId, description: fresh.description } : undefined;
        return found !== undefined;
      },
      { timeout: TURN_TIMEOUT_MS, interval: POLL_MS, timeoutMsg: "no new session with known AI Credits appeared (is Copilot signed in, and is the model available on your plan?)" },
    );
    const credits = groupCredits(found!.description);
    expect(credits).not.toBeNull();
    expect(credits!).toBeGreaterThan(0);
    chat = { id: found!.id, credits: credits! };
    recordChatCredits(credits!);
  });

  test(copilotTestTitle("1.14", "Group Sessions by Repository lists the folder's repository with the new session's AI Credits, never 0"), async () => {
    await host.command(COMMAND_IDS.groupSessionsByRepository);

    let group: GroupNode | undefined;
    await browser.waitUntil(async () => (group = repositoryGroup(await sessionsTree())) !== undefined, {
      timeout: 60_000,
      interval: 2_000,
      timeoutMsg: `no ${E2E_REPOSITORY.key} group in the Sessions view`,
    });
    expect(group!.children.map((child) => child.sessionId)).toContain(chat!.id);
    const sum = groupCredits(group!.description);
    // Known credits are shown as a sum, never as 0 or as "unknown".
    expect(sum).not.toBeNull();
    expect(sum!).toBeGreaterThan(0);
    // The group sums every session of the folder; the new one is part of it.
    expect(sum!).toBeGreaterThanOrEqual(chat!.credits - 0.005);
  });

  test(copilotTestTitle("1.14", "the status bar names the folder's repository with today's AI Credits"), async () => {
    let items: string[] = [];
    await browser.waitUntil(
      async () => {
        await host.command(COMMAND_IDS.refreshSessions);
        items = await statusBarItems();
        return repositoryStatusCredits(items, E2E_REPOSITORY.name) !== null;
      },
      { timeout: 60_000, interval: 2_000, timeoutMsg: `the status bar never named ${E2E_REPOSITORY.name} with AI Credits` },
    );
    const credits = repositoryStatusCredits(items, E2E_REPOSITORY.name);
    expect(credits!).toBeGreaterThan(0);
    expect(credits!).toBeGreaterThanOrEqual(chat!.credits - 0.005);
    // The visible text carries the name and the figure too.
    expect(items.some((item) => item.includes("AI Credits today") && item.includes(` in ${E2E_REPOSITORY.name},`))).toBe(true);
  });

  test(copilotTestTitle("1.14", "the grouping choice survives a window reload"), async () => {
    await host.command(COMMAND_IDS.groupSessionsByRepository);
    // In normal mode (G3) the wdio session survives a reload: the bridge
    // extension reconnects from the new extension host (the service's own test
    // runner could not, §6.6). The command is cancelled by the reload itself.
    const before = await browser.executeWorkbench(() => process.pid);
    await host.command("workbench.action.reloadWindow").catch(() => undefined);
    await browser.waitUntil(async () => (await browser.executeWorkbench(() => process.pid).catch(() => before)) !== before, {
      timeout: 60_000,
      interval: 1_000,
      timeoutMsg: "the window did not reload (the extension host kept its process)",
    });
    await host.waitForExtension({ keepStartupEditors: true });

    // Without choosing again, the Sessions view is still grouped by repository.
    await browser.waitUntil(async () => repositoryGroup(await sessionsTree()) !== undefined, {
      timeout: 60_000,
      interval: 2_000,
      timeoutMsg: "after the reload the Sessions view is not grouped by repository",
    });
  });
});
