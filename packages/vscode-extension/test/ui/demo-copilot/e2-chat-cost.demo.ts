// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Demo scene E2 "Chat, then see its cost" (docs/plans/docs-refresh-and-demo-recordings.md §4.1, task 1.7):
// a real agent-mode chat, then its session in Sessions (by day) with its AI Credits, the session's
// tooltip and the status bar's AI Credits today. REAL, PAID: one short chat on the suite's model.
//
// RUNBOOK (owner)
//   Paid take, about 0.5-0.75 AI Credits (cap 3 stops a runaway; the chat is one short answer):
//     flock "$XDG_RUNTIME_DIR/aica-demo.lock" env COPILOT_E2E=1 \
//       COPILOT_E2E_USER_DATA_DIR=$HOME/.cache/aica-copilot-e2e/user-data COPILOT_E2E_MAX_AI_CREDITS=3 \
//       DEMO_FORBIDDEN='<your GitHub login>,<your email>' \
//       npm run demo:record:copilot -w packages/vscode-extension -- --spec test/ui/demo-copilot/e2-chat-cost.demo.ts
//   Output: demo-masters/E2-chat-cost.mp4 (+ .json) and demo-masters/stills/e2-sidebar.png (the still, before the hover).
//   A run that fails or skips (no budget, wrong model, Copilot not ready) deletes its MP4; nothing is kept.
//   With COPILOT_E2E_MAX_AI_CREDITS=0 it plays up to the send, then skips ("no budget") and discards the take.
//   Check in the MP4, frame by frame where it matters:
//     - no account name, avatar, email or /tmp path anywhere (chat panel, title bar, notifications);
//     - the prompt is visible before it is sent, the model picker names the suite's model;
//     - the answer is a short sentence (retake if it rambles or Copilot shows an error);
//     - the new session sits in today's group in Sessions with a figure, not "AI Credits unknown";
//     - the session tooltip and the status bar tooltip appear (a hover that missed leaves a plain frame: retake);
//     - the wait for the answer is long: suggest a trim window (start,duration) that cuts the waiting.
//   The prompt asks for no tools: the test agent has only the analyzer's tools and the opened git folder is empty,
//   so "summarise a file" (the plan's example) is not possible.
import { browser, expect } from "@wdio/globals";
import { COMMAND_IDS } from "../../../src/commands/command-ids.js";
import type { SessionNode, SessionsTreeNode } from "../../../src/sidebar/sessions-tree-model.js";
import { INTERNAL_COMMAND_IDS } from "../../../src/diagnostics/test-hooks.js";
import { AnalyzerClient, listedSessions, recordChatCredits, requireModel, sendToAgent, waitForNewSession } from "../copilot-e2e/support/copilot-chat.js";
import { ChatViews } from "../copilot-e2e/support/chat-view.js";
import { runDemoScene, type DemoScene } from "../demo/support/demo-driver.ts";
import { stillPath } from "../demo/support/demo-launch.mts";
import { wdioVscodeHost as host } from "../support/vscode-host.js";
import { clearToasts, find, hoverForTooltip, markedElement, markElement, prepareCopilotScene, saveStill, stageChatPrompt, widenChat } from "./support/chat-scene-helpers.ts";

// Fixed and short: few tokens, few AI Credits.
const PROMPT = "In one short sentence, explain what a git branch is. Do not call any tools.";
const ANSWER_TIMEOUT_MS = 240_000;
const ACTIVITY_BAR_ICON = ".part.activitybar [aria-label*='AI Credits Analyzer']";
const SESSION_ROWS = ".pane .monaco-list-row";
const STATUS_ITEM = ".part.statusbar [aria-label^='AI Credits today']";

async function sessionNode(sessionId: string): Promise<SessionNode> {
  const tree = await host.hook<SessionsTreeNode[]>(INTERNAL_COMMAND_IDS.sessionsTree);
  const nodes = tree.flatMap((node) => (node.kind === "group" ? node.children : [node]));
  const found = nodes.find((node): node is SessionNode => node.kind === "session" && node.sessionId === sessionId);
  if (!found) throw new Error(`No Sessions view row for ${sessionId}`);
  return found;
}

suite("Demo E2 chat and its cost (real Copilot; paid)", function () {
  this.timeout(900_000);

  test("E2 plays through the driver", async function () {
    await prepareCopilotScene(this);
    await host.command("workbench.action.closeSidebar");
    await host.command(COMMAND_IDS.groupSessionsByDay);
    const known = new Set((await listedSessions()).map((node) => node.sessionId));
    const analyzer = await AnalyzerClient.connect();
    const chat = new ChatViews();
    let sessionId: string | undefined;

    const scene: DemoScene = {
      id: "E2",
      slug: "chat-cost",
      title: "Chat, then see its cost",
      steps: [
        {
          label: "open the Sessions view: the made-up history, by day",
          beatMs: 1_500,
          action: async (driver) => {
            await driver.click(await find(ACTIVITY_BAR_ICON));
            await browser.waitUntil(async () => (await browser.$$(SESSION_ROWS).length) > 0, { timeout: 30_000, timeoutMsg: "the Sessions view showed no rows" });
          },
        },
        {
          label: "Copilot Chat opens in agent mode with the prompt typed",
          beatMs: 2_000,
          action: async () => {
            await stageChatPrompt(PROMPT);
            await widenChat(480);
          },
        },
        {
          // Skips the test (and so discards the take) over the AI Credits cap or on another model.
          label: "send the prompt",
          beatMs: 1_000,
          action: () => sendToAgent(this, PROMPT),
        },
        {
          label: "wait for the answer and its session",
          beatMs: 2_000,
          action: async (driver) => {
            sessionId = await waitForNewSession(known, ANSWER_TIMEOUT_MS);
            await chat.waitForResponse(ANSWER_TIMEOUT_MS);
            requireModel(this, await analyzer.session(sessionId));
            await clearToasts();
            // The answer is on screen: nothing of the owner's may show now.
            await driver.probePrivacy();
          },
        },
        {
          label: "the session in Sessions with its AI Credits",
          beatMs: 2_000,
          action: async (driver) => {
            await host.command(COMMAND_IDS.refreshSessions);
            await host.command(COMMAND_IDS.groupSessionsByDay);
            const node = await sessionNode(sessionId!);
            // Today's group starts collapsed in a profile with older sessions: open it as a viewer would.
            if (!(await markElement(SESSION_ROWS, node.label))) {
              if (await markElement(SESSION_ROWS, new Date().toLocaleDateString("sv"))) await driver.click(await markedElement());
              await browser.pause(500);
            }
            await browser.waitUntil(() => markElement(SESSION_ROWS, node.label), { timeout: 30_000, timeoutMsg: `the Sessions view shows no row for "${node.label}"` });
            await driver.pointerTo(await markedElement());
            await saveStill("e2-sidebar", { keepHover: true });
          },
        },
        {
          label: "hover the session: its tooltip",
          beatMs: 3_000,
          action: async () => {
            const shown = await hoverForTooltip(await markedElement());
            if (!shown) console.log("[demo] no tooltip showed over the session row");
          },
        },
        {
          label: "the status bar: AI Credits today, and its tooltip",
          beatMs: 3_000,
          action: async (driver) => {
            // Shown once a session that started today has been read.
            await browser.$(STATUS_ITEM).waitForExist({ timeout: 30_000, timeoutMsg: "the status bar shows no AI Credits today" });
            const item = await find(STATUS_ITEM);
            await driver.pointerTo(item);
            const shown = await hoverForTooltip(item);
            if (!shown) console.log("[demo] no tooltip showed over the status bar item");
          },
        },
      ],
    };

    try {
      const mp4 = await runDemoScene(scene, {
        assertEnd: async () => {
          const listed = (await listedSessions()).find((node) => node.sessionId === sessionId);
          expect(listed?.creditsKnown).toBe(true);
          const status = await (await browser.getWorkbench()).getStatusBar().getItems();
          expect(status.some((item) => item.startsWith("AI Credits today"))).toBe(true);
        },
      });
      console.log(`E2 master: ${mp4}; still: ${stillPath("e2-sidebar")}`);
    } finally {
      // What the chat cost counts toward the run's cap, whether or not the take was kept.
      if (sessionId !== undefined) recordChatCredits((await analyzer.aiCredits(sessionId).catch(() => null)) ?? 0);
      await analyzer.close();
    }
  });
});
