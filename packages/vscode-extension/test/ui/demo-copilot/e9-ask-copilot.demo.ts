// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Demo scene E9 "Ask Copilot" (docs/plans/docs-refresh-and-demo-recordings.md §4.1, task 1.7): turn on
// aiCreditsAnalyzer.mcp.enabled in the Settings UI, ask agent mode "What drove my spend this week?", the
// cost rollup MCP App view appears in the chat; drill into a top session, open a turn, Back.
// REAL, PAID: one short chat on the suite's model (the model's call to get_cost_rollup is a few thousand tokens).
//
// RUNBOOK (owner)
//   Paid take, about 0.5-0.75 AI Credits (cap 3 stops a runaway):
//     flock "$XDG_RUNTIME_DIR/aica-demo.lock" env COPILOT_E2E=1 \
//       COPILOT_E2E_USER_DATA_DIR=$HOME/.cache/aica-copilot-e2e/user-data COPILOT_E2E_MAX_AI_CREDITS=3 \
//       DEMO_FORBIDDEN='<your GitHub login>,<your email>' \
//       npm run demo:record:copilot -w packages/vscode-extension -- --spec test/ui/demo-copilot/e9-ask-copilot.demo.ts
//   Output: demo-masters/E9-ask-copilot.mp4 (+ .json) and demo-masters/e9-mcp-agent-mode.png (the still, rollup in the chat).
//   A run that fails or skips (no budget, wrong model, the model made no tool call, Copilot not ready) deletes its MP4.
//   With COPILOT_E2E_MAX_AI_CREDITS=0 it plays Settings and the typing, then skips ("no budget") and discards the take.
//   The setting is on in the profile copy from the start; the scene turns it off before recording and on again in the UI.
//   Check in the MP4:
//     - no account name, avatar, email or /tmp path (Settings editor, chat, title bar, notifications);
//     - the setting is typed into the Settings search and its checkbox ticks;
//     - the rollup view (daily chart, by model, top sessions) is whole and readable in the chat, not clipped;
//     - the pointer reaches the top session, a turn and "Back to cost rollup", and the view returns to the rollup;
//     - the model's own text under the view is short and harmless (retake if not);
//     - the wait for the answer is long: suggest a trim window (start,duration) that cuts the waiting.
//   The rollup covers the made-up history plus this chat; "this week" holds the seeded sessions 3 and 6 days old.
//   If the model asks for another window and the view is empty, retake.
import { browser, expect } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../src/diagnostics/test-hooks.js";
import { AnalyzerClient, listedSessions, recordChatCredits, requireModel, sendToAgent, waitForNewSession } from "../copilot-e2e/support/copilot-chat.js";
import { skipTest } from "../copilot-e2e/support/run-log.mts";
import { runDemoScene, type DemoScene } from "../demo/support/demo-driver.ts";
import { wdioVscodeHost as host } from "../support/vscode-host.js";
import { clearToasts, DemoChatViews, find, prepareCopilotScene, saveStill, stageChatPrompt, widenChat } from "./support/chat-scene-helpers.ts";

const PROMPT = "What drove my spend this week?";
const SETTING = "aiCreditsAnalyzer.mcp.enabled";
const ANSWER_TIMEOUT_MS = 300_000;
const SETTINGS_EDITOR = ".settings-editor";
const SEARCH_BOX = ".settings-editor .settings-header .suggest-input-container .monaco-editor";
const BOOL_SETTING = ".settings-editor .setting-item-bool";
const BOOL_CHECKBOX = ".settings-editor .setting-item-bool .setting-value-checkbox";
const ROLLUP_VIEW = 0;
const ROLLUP_KICKER = "AI Credits Analyzer · Cost rollup";

async function serverDefinitions(): Promise<number> {
  return (await host.hook<unknown[]>(INTERNAL_COMMAND_IDS.mcpServerDefinitions)).length;
}

suite("Demo E9 ask Copilot (real Copilot; paid)", function () {
  this.timeout(900_000);

  test("E9 plays through the driver", async function () {
    await prepareCopilotScene(this);
    // The profile copy has the server on; the scene turns it on again where a viewer can see it.
    await host.setSetting(SETTING, false);
    await browser.waitUntil(async () => (await serverDefinitions()) === 0, { timeout: 30_000, timeoutMsg: "the MCP server stayed on after the setting was turned off" });
    await host.command("workbench.action.closeSidebar");
    const known = new Set((await listedSessions()).map((node) => node.sessionId));
    const chat = new DemoChatViews();
    let analyzer: AnalyzerClient | undefined;
    let sessionId: string | undefined;
    let rollupTitle = "";
    let requestsAfterChat = 0;
    let topSession = "";

    const scene: DemoScene = {
      id: "E9",
      slug: "ask-copilot",
      title: "Ask Copilot",
      steps: [
        {
          label: "open Settings",
          beatMs: 1_000,
          action: async () => {
            await host.command("workbench.action.openSettings");
            await browser.$(SETTINGS_EDITOR).waitForExist({ timeout: 30_000 });
          },
        },
        {
          label: "type the setting's name into the search",
          beatMs: 1_200,
          action: async (driver) => {
            const search = await find(SEARCH_BOX);
            await driver.click(search);
            // A DOM click doesn't focus the editor's input; a real one does.
            await search.click();
            await driver.typeSlowly(SETTING, 45);
            await browser.$(BOOL_SETTING).waitForExist({ timeout: 15_000, timeoutMsg: "the Settings search found no checkbox setting" });
          },
        },
        {
          label: "tick the checkbox: the MCP server turns on",
          beatMs: 1_500,
          action: async (driver) => {
            await driver.click(await find(BOOL_CHECKBOX));
            const on = () => browser.waitUntil(async () => (await host.setting(SETTING)) === true, { timeout: 4_000 }).then(() => true, () => false);
            // The toggle answers a real click when a DOM click didn't take.
            if (!(await on())) await (await browser.$(BOOL_CHECKBOX)).click();
            expect(await on()).toBe(true);
            await browser.waitUntil(async () => (await serverDefinitions()) > 0, { timeout: 30_000, timeoutMsg: "VS Code was offered no MCP server after the setting was turned on" });
            analyzer = await AnalyzerClient.connect();
          },
        },
        {
          // VS Code 1.146 opens Settings as a modal editor over the workbench; it would cover the chat.
          label: "close Settings",
          beatMs: 500,
          action: async () => {
            await host.command("workbench.action.closeActiveEditor");
            await browser.$(SETTINGS_EDITOR).waitForExist({ timeout: 10_000, reverse: true, timeoutMsg: "Settings stayed open" });
          },
        },
        {
          label: "Copilot Chat opens in agent mode with the prompt typed",
          beatMs: 2_000,
          action: async () => {
            await stageChatPrompt(PROMPT);
            await widenChat(600);
          },
        },
        {
          // Skips the test (and so discards the take) over the AI Credits cap or on another model.
          label: "send the prompt",
          beatMs: 1_000,
          action: () => sendToAgent(this, PROMPT),
        },
        {
          label: "wait for the cost rollup view in the chat",
          beatMs: 1_500,
          action: async (driver) => {
            // A live model may answer without the tool (risk R2): the take is dropped, not kept.
            await chat.views.waitForViews(1, ANSWER_TIMEOUT_MS).catch(() => skipTest(this, "Copilot made no tool call, so no view appeared in the chat; retake"));
            await chat.views.waitForResponse(ANSWER_TIMEOUT_MS);
            sessionId = await waitForNewSession(known, ANSWER_TIMEOUT_MS);
            requireModel(this, await analyzer!.session(sessionId));
            requestsAfterChat = await chat.views.requestCount();
            await clearToasts();
            await chat.show(ROLLUP_VIEW);
            const snapshot = await chat.inView(ROLLUP_VIEW, (view) => view.snapshot());
            if (snapshot.kicker !== ROLLUP_KICKER) skipTest(this, `the first view is "${snapshot.kicker}", not the cost rollup; retake`);
            rollupTitle = snapshot.title;
            const top = snapshot.tables.find((name) => /^Top sessions by/.test(name));
            if (top === undefined) throw new Error(`The rollup shows no "Top sessions by" table; it shows ${JSON.stringify(snapshot.tables)}`);
            await driver.probePrivacy();
            await saveStill("e9-mcp-agent-mode.png");
          },
        },
        {
          label: "drill into the top session",
          beatMs: 2_500,
          action: async () => {
            topSession = await chat.inView(ROLLUP_VIEW, async () =>
              browser.execute(() => {
                const table = Array.from(document.querySelectorAll("table, [role='table']")).find((candidate) =>
                  (candidate.getAttribute("aria-label") ?? candidate.querySelector("caption")?.textContent ?? "").trim().startsWith("Top sessions by"),
                );
                const button = table?.querySelector("tbody button, [role='row'] button");
                return (button?.getAttribute("aria-label") ?? button?.textContent ?? "").trim();
              }),
            );
            if (topSession === "") throw new Error("The rollup's top sessions table has no session button");
            await chat.click(ROLLUP_VIEW, topSession);
            await chat.inView(ROLLUP_VIEW, (view) => view.waitForTitle(topSession));
          },
        },
        {
          label: "open a turn",
          beatMs: 2_500,
          action: async () => {
            const turn = await chat.inView(ROLLUP_VIEW, async (view) => (await view.snapshot()).buttons.find((name) => /^Turn \d+$/.test(name)));
            if (turn === undefined) throw new Error("The session view shows no turn to open");
            await chat.click(ROLLUP_VIEW, turn);
            await chat.inView(ROLLUP_VIEW, (view) =>
              browser.waitUntil(async () => (await view.snapshot()).buttons.includes("Hide turn"), { timeout: 15_000, timeoutMsg: "the turn did not open" }),
            );
          },
        },
        {
          label: "Back to the rollup",
          beatMs: 2_500,
          action: async () => {
            await chat.click(ROLLUP_VIEW, "Back to cost rollup");
            await chat.inView(ROLLUP_VIEW, (view) => view.waitForTitle(rollupTitle));
          },
        },
      ],
    };

    try {
      const mp4 = await runDemoScene(scene, {
        assertEnd: async () => {
          const end = await chat.inView(ROLLUP_VIEW, (view) => view.snapshot());
          expect(end.kicker).toBe(ROLLUP_KICKER);
          expect(end.title).toBe(rollupTitle);
          // Drilling in and Back are the view's own tool calls, not chat turns.
          expect(await chat.views.requestCount()).toBe(requestsAfterChat);
        },
      });
      console.log(`E9 master: ${mp4}`);
    } finally {
      // What the chat cost counts toward the run's cap, whether or not the take was kept.
      if (sessionId !== undefined && analyzer !== undefined) recordChatCredits((await analyzer.aiCredits(sessionId).catch(() => null)) ?? 0);
      await analyzer?.close();
      // The profile copy is deleted anyway; leaves the setting as the suite has it.
      await host.setSetting(SETTING, true).catch(() => undefined);
    }
  });
});
