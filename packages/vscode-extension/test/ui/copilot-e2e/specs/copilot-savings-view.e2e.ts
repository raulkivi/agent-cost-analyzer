// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// OPT-IN, OWNER-RUN, spends real AI Credits (about 0.5 per run): U18, the
// get_savings_report view, in a real Copilot Chat (SR21, docs/plans/savings-report.md
// §10; step 10.17's rule: no hand checklist gates a release). See
// wdio.copilot.conf.mts for how to run it.
//
// One chat in the test-only agent asks Copilot to call get_savings_report
// once over the made-up history (chat-history-seed.mts), in its own spec file
// so a missed tool call skips only these rows. The made-up history may or
// may not hold a saving, so the spec asserts the view's frame always and the
// row detail and the drill-down when a row is there; either way the view must
// be the Savings one. Drill-downs are the view's own tool calls, not model
// turns: the chat must show no new request.
// TDD exception: the spec runs only against a real VS Code and Copilot; the
// ids it reports under are unit-tested (evidence.test.ts).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { copilotTestTitle } from "../../../../scripts/release-evidence/evidence.mts";
import { isWithinTolerance } from "../../support/panel-width.js";
import { OUT_DIR, saveScreenshot } from "../../support/screenshots.js";
import { wdioVscodeHost as host } from "../../support/vscode-host.js";
import { CHAT_HISTORY_ENV, type ChatHistory } from "../support/chat-history-seed.mts";
import { ChatViews, type ChatView, type ViewSnapshot } from "../support/chat-view.js";
import { AnalyzerClient, MODEL, recordChatCredits, sendToAgent, waitForCopilot, waitForNewSession } from "../support/copilot-chat.js";
import { modelMatches } from "../support/copilot-e2e-env.mts";
import { logToRun, skipSuite } from "../support/run-log.mts";
import { viewsPrompt } from "../support/view-prompt.mts";

const history = JSON.parse(process.env[CHAT_HISTORY_ENV] ?? "null") as ChatHistory | null;
const VERSION = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../package.json"), "utf8")) as { version: string }).version;
const THEME_SETTING = "workbench.colorTheme";
const KICKER = "AI Credits Analyzer · Savings";
const CHAT_TIMEOUT_MS = 300_000;
const NORMAL_WIDTH = 600;
const NARROW_WIDTH = 360;
const EMPTY_TEXT = "No savings found in this window.";
// A row's chevron button is the only button of the view that carries aria-expanded.
const ROW = "button[aria-expanded]";

const views = new ChatViews();
let analyzer: AnalyzerClient | undefined;
let knownBefore = new Set<string>();
let chatSessionId: string | undefined;
let creditsRecorded = 0;
let turnsAfterChat = 0;
let viewIndex = 0;

function keep(name: string, snapshot: ViewSnapshot): ViewSnapshot {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, `sr21-${name}.json`), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

async function newTurns(): Promise<number> {
  const sessions = (await analyzer!.sessions()).filter((session) => !knownBefore.has(session.id));
  return sessions.reduce((sum, session) => sum + session.turnCount, 0);
}

async function rowCount(): Promise<number> {
  return (await browser.$$(ROW).getElements()).length;
}

suite("U18 savings view in a real Copilot Chat (SR21; opt-in)", function () {
  this.timeout(600_000);

  suiteSetup(async function () {
    if (history === null) skipSuite(this, "no seeded chat history (run through wdio.copilot.conf.mts)");
    await host.waitForExtension();
    await host.command("workbench.extensions.action.enableAll");
    const readiness = await waitForCopilot();
    if (readiness.status === "gave-up") skipSuite(this, readiness.reason);
    await host.setSetting(THEME_SETTING, "Default Light Modern");
    await host.command("workbench.action.closeSidebar");
    analyzer = await AnalyzerClient.connect();
    knownBefore = new Set((await analyzer.sessions()).map((session) => session.id));

    // Unsent, and the suite skips, over the AI Credits cap or on another model (D12, D9).
    await sendToAgent(this, viewsPrompt([{ tool: "get_savings_report", args: { since: history!.periods.last90Days.since, until: history!.periods.last90Days.until } }]), "suite");
    const rendered = await views.waitForViews(1, CHAT_TIMEOUT_MS).then(
      () => 1,
      () => views.count(),
    );
    if (rendered < 1) skipSuite(this, "Copilot's answer showed no view (it made no get_savings_report call); rerun");
    await views.waitForResponse(CHAT_TIMEOUT_MS);
    chatSessionId = await waitForNewSession(knownBefore, CHAT_TIMEOUT_MS);
    const session = await analyzer.session(chatSessionId);
    console.log(`[copilot-e2e] observed Copilot log id for ${MODEL}: ${session.model}`);
    logToRun({ kind: "observed-model", model: session.model });
    if (!modelMatches(MODEL, session.model)) skipSuite(this, `the savings chat ran on "${session.model}", not ${MODEL}`);
    creditsRecorded = (await analyzer.aiCredits(chatSessionId)) ?? 0;
    recordChatCredits(creditsRecorded);
    console.log(`[copilot-e2e] AI Credits spent by the savings chat: ${creditsRecorded.toFixed(4)}`);

    let found: number | undefined;
    for (let index = 0; index < rendered && found === undefined; index++) {
      if ((await views.inside(index, (view) => view.snapshot())).kicker === KICKER) found = index;
    }
    if (found === undefined) skipSuite(this, "the chat showed no Savings view (Copilot called another tool); rerun");
    viewIndex = found;
    turnsAfterChat = await newTurns();
    expect(turnsAfterChat).toBe(1);
    await views.setViewWidth(NORMAL_WIDTH);
    await saveScreenshot("sr21-chat");
  });

  suiteTeardown(async () => {
    if (chatSessionId !== undefined && analyzer !== undefined) {
      const total = (await analyzer.aiCredits(chatSessionId)) ?? 0;
      const rest = Math.max(0, total - creditsRecorded);
      if (rest > 0) recordChatCredits(rest);
      console.log(`[copilot-e2e] AI Credits spent by this spec file's chats: ${total.toFixed(4)}`);
    }
    await analyzer?.close();
  });

  teardown(async function () {
    await views.leave();
    if (this.currentTest?.state === "failed") await saveScreenshot(`sr21-failed-${this.currentTest.title.slice(0, 40).replace(/[^\w.-]+/g, "-")}`);
  });

  test(copilotTestTitle("SR21 U18", "U18 savings report: Savings kicker, Possible savings, the period and basis line, the ranked-by-the-high-end note, Simulated off says how to ask in text with no control; a row opens in place with its evidence, What to change and the sessions heading, Open cost opens the session in place and Back returns focus to it, by mouse; or, with no saving in the window, the empty line; no new chat request"), async () => {
    await views.inside(viewIndex, async (view: ChatView) => {
      const savings = keep("u18", await view.snapshot());
      expect(savings.kicker).toBe(KICKER);
      expect(savings.title).toBe("Possible savings");
      expect(savings.text).toMatch(/\d+ days · amounts per week · prices (as of use|today)/);
      expect(savings.text).toContain("Opportunities overlap, so they are not added up.");
      expect(savings.text).toContain("Amounts are priced from the price book and cannot be billed.");
      expect(savings.text).toMatch(/Simulated replays are off\./);
      expect(savings.text).toContain("ask in the chat");
      // No Copy and no Cancel (D20, D21); the Simulated section has no control at all.
      expect(savings.buttons.filter((name) => /copy|cancel/i.test(name))).toEqual([]);

      if ((await rowCount()) === 0) {
        // Nothing to rank: the view says so, and invents no row or amount.
        expect(savings.text).toContain(EMPTY_TEXT);
        return;
      }
      expect(savings.text).not.toContain(EMPTY_TEXT);
      expect(savings.text).toMatch(/per week/);
      // Never a bare 0 for an unknown amount.
      expect(savings.text).not.toMatch(/\b0 AI Credits per week/);

      const first = (await browser.$$(ROW).getElements())[0]!;
      expect(await first.getAttribute("aria-expanded")).toBe("false");
      await first.scrollIntoView({ block: "center" });
      await first.click().catch(() => browser.execute((target: HTMLElement) => target.click(), first as unknown as HTMLElement));
      await browser.waitUntil(async () => (await first.getAttribute("aria-expanded")) === "true", { timeout: 10_000, timeoutMsg: "the row did not open in place" });
      const opened = keep("u18-row-open", await view.snapshot());
      expect(opened.text).toContain("What to change");
      expect(opened.text).toContain("Suggestion only. Nothing is changed.");
      expect(opened.text).toMatch(/(Largest \d+ of \d+ sessions|\d+ sessions?), over the \d+ days/);
      expect(opened.text).toMatch(/Prices: \S+, in force on the dates of these requests\./);

      // Open cost: U1 in place, then Back returns focus to the session button. A row
      // with no plain session id has no button; then only the detail is checked.
      const open = (await browser.$$("button.sv-open").getElements())[0];
      if (open === undefined) return;
      const label = String(await open.getAttribute("aria-label"));
      expect(label).toMatch(/^Open (cost|replay) for session /);
      await view.click(label);
      await view.waitForTitle(/\S/);
      await browser.waitUntil(async () => (await view.snapshot()).buttons.includes("Back to savings"), { timeout: 30_000, timeoutMsg: "the session did not open in place" });
      const drilled = keep("u18-session-in-place", await view.snapshot());
      expect(drilled.kicker).toMatch(/^AI Credits Analyzer · Savings › Session (cost|replay)$/);
      await view.click("Back to savings");
      await browser.waitUntil(async () => (await view.focusedControl()) === label, { timeout: 10_000, timeoutMsg: "focus did not return to the session button" });
      expect((await view.snapshot()).kicker).toBe(KICKER);
      expect(await first.getAttribute("aria-expanded")).toBe("true");
    });
    expect(await newTurns()).toBe(turnsAfterChat);
  });

  test(copilotTestTitle("SR21 themes", "U18 follows Light Modern, Dark Modern and both High Contrast themes mid-run; text reaches AA on the chat's ground; focus ring on Tab"), async () => {
    const themes = [
      { name: "Default Light Modern", bodyClass: "vscode-light", scheme: "light" },
      { name: "Default Dark Modern", bodyClass: "vscode-dark", scheme: "dark" },
      { name: "Default High Contrast", bodyClass: "vscode-high-contrast", scheme: "dark" },
      { name: "Default High Contrast Light", bodyClass: "vscode-high-contrast-light", scheme: "light" },
    ];
    const findings: string[] = [];
    for (const theme of themes) {
      await host.setSetting(THEME_SETTING, theme.name);
      await views.scrollTo(viewIndex);
      const ground = await views.ground();
      await views.inside(viewIndex, async (view) => {
        await browser.waitUntil(async () => (await view.theme()).bodyClasses.includes(theme.bodyClass), { timeout: 30_000, timeoutMsg: `U18 did not follow ${theme.name}` });
        expect((await view.theme()).scheme).toBe(theme.scheme);
        const judged = await view.contrastFindings(ground);
        expect(judged.texts).toBeGreaterThan(10);
        findings.push(...judged.findings.map((finding) => `${theme.name}: ${finding}`));
        if ((await view.snapshot()).buttons.length > 0) {
          await view.tabToAButton();
          expect({ theme: theme.name, focusRing: await view.focusRingVisible() }).toEqual({ theme: theme.name, focusRing: true });
        }
      });
      await saveScreenshot(`sr21-theme-${theme.bodyClass}`);
    }
    await host.setSetting(THEME_SETTING, "Default Light Modern");
    expect(findings).toEqual([]);
  });

  test(copilotTestTitle("SR21 narrow", "narrow chat, about 360 px, and a normal one, about 600 px: U18 doesn't scroll sideways"), async () => {
    const narrow = await views.setViewWidth(NARROW_WIDTH);
    try {
      expect(isWithinTolerance(narrow, NARROW_WIDTH)).toBe(true);
      await views.inside(viewIndex, async (view) => {
        expect(await view.width()).toBeLessThanOrEqual(narrow);
        expect(await view.scrollsSideways()).toBe(false);
      });
      await saveScreenshot("sr21-narrow");
    } finally {
      await views.setViewWidth(NORMAL_WIDTH);
    }
    await views.inside(viewIndex, async (view) => {
      expect(await view.scrollsSideways()).toBe(false);
    });
  });

  test(copilotTestTitle("SR21 footer", "footer: U18 ends with Read-only · local logs · v<extension version>, and its text can be selected"), async () => {
    await views.inside(viewIndex, async (view) => {
      expect((await view.snapshot()).footer).toBe(`Read-only · local logs · v${VERSION}`);
      expect(await view.textSelectable()).toBe(true);
    });
  });
});
