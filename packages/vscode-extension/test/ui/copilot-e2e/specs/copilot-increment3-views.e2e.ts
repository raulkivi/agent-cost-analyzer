// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// OPT-IN, OWNER-RUN, spends real AI Credits (about 1 per run): the views of the
// Phase 12 Increment 3 tools the extension serves, in a real Copilot Chat
// (task A33, docs/plans/mcp-apps.md §8.3; step 10.17's rule: no hand
// checklist gates a release). U12 (replay_session, compare_models_for_session),
// U13 (get_price_changes), U4 (get_session_audit, get_audit_rollup) and U5
// (list_sessions). No billing view: the extension serves no get_statement or
// estimate_cost (A26). See wdio.copilot.conf.mts for how to run it.
//
// One chat in the test-only agent asks Copilot to call the six tools in one
// step, over the made-up history (chat-history-seed.mts). Specs assert only on
// the views. Drill-downs inside a view are the view's own tool calls, not
// model turns: the chat must show no new request. The last test presses U5's
// Analyse on one row and records what VS Code did with the message: sent it
// (a model turn, inside the run's AI Credits cap), put it in the chat input
// unsent (VS Code 1.146, A33's first run), or declined, so the row shows the
// text to type (owner, 2026-11-11, §9.2 Q7).
// TDD exception: the spec runs only against a real VS Code and Copilot; its
// pure parts (seeding, prompt, overlay match, the Analyse outcome) are unit-tested.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { copilotTestTitle } from "../../../../scripts/release-evidence/evidence.mts";
import { isWithinTolerance } from "../../support/panel-width.js";
import { OUT_DIR, saveScreenshot } from "../../support/screenshots.js";
import { wdioVscodeHost as host } from "../../support/vscode-host.js";
import { analyseOutcome, type AnalyseRowState } from "../support/analyse-outcome.mts";
import { CHAT_HISTORY_ENV, HISTORY_REPLAY_MODELS, type ChatHistory } from "../support/chat-history-seed.mts";
import { ChatViews, type ViewSnapshot } from "../support/chat-view.js";
import { AnalyzerClient, MODEL, mayStartTurn, recordChatCredits, sendToAgent, waitForCopilot, waitForNewSession } from "../support/copilot-chat.js";
import { modelMatches } from "../support/copilot-e2e-env.mts";
import { logToRun, skipSuite, skipTest } from "../support/run-log.mts";
import { type ViewCall, viewsPrompt } from "../support/view-prompt.mts";

const history = JSON.parse(process.env[CHAT_HISTORY_ENV] ?? "null") as ChatHistory | null;
const VERSION = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../package.json"), "utf8")) as { version: string }).version;
const THEME_SETTING = "workbench.colorTheme";
const KICKER = "AI Credits Analyzer · ";
// The chat turn, its six tool calls and their views; and U5's Analyse turn.
const CHAT_TIMEOUT_MS = 300_000;
const NORMAL_WIDTH = 600;
const NARROW_WIDTH = 360;
// How long U5's message may sit in the chat input before it counts as staged, not sent.
const STAGED_WATCH_MS = 20_000;
// A model with a Copilot price from 2026-10-07, for the replay opened directly.
const DIRECT_REPLAY_MODEL = "claude-haiku-5.5";
// The Increment 3 tools with a view in the extension (A26), and the billing tools it never serves.
const INCREMENT3_VIEW_TOOLS = ["replay_session", "compare_models_for_session", "get_price_changes", "get_session_audit", "get_audit_rollup", "list_sessions"];
const BILLING_TOOLS = ["get_statement", "estimate_cost"];

type ViewKey = "compare" | "replay" | "prices" | "audit" | "rollup" | "picker";

function viewCalls(seeded: ChatHistory): ViewCall[] {
  const { last90Days } = seeded.periods;
  const sessionId = seeded.sessionIds[0];
  return [
    { tool: "compare_models_for_session", args: { sessionId, models: [...HISTORY_REPLAY_MODELS] } },
    { tool: "replay_session", args: { sessionId, model: DIRECT_REPLAY_MODEL } },
    { tool: "get_price_changes", args: { ...last90Days } },
    { tool: "get_session_audit", args: { sessionId } },
    { tool: "get_audit_rollup", args: { since: last90Days.since } },
    { tool: "list_sessions", args: { since: last90Days.since } },
  ];
}

// Which view a snapshot is, from its kicker (and U4's title: both modes share the kicker).
function keyOf(snapshot: ViewSnapshot): ViewKey | undefined {
  switch (snapshot.kicker) {
    case `${KICKER}Replay on other models`:
      return "compare";
    case `${KICKER}Session replay`:
      return "replay";
    case `${KICKER}Price changes`:
      return "prices";
    case `${KICKER}Tool-call audit`:
      return snapshot.title === "Tool-call failures" ? "rollup" : "audit";
    case `${KICKER}Sessions`:
      return "picker";
    default:
      return undefined;
  }
}

const views = new ChatViews();
const VIEW = {} as Record<ViewKey, number>;
let analyzer: AnalyzerClient | undefined;
let knownBefore = new Set<string>();
let chatSessionId: string | undefined;
let creditsRecorded = 0;
let turnsAfterChat = 0;
let normalWidth = 0;

function keep(name: string, snapshot: ViewSnapshot): ViewSnapshot {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, `a33-${name}.json`), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

function groupNames(snapshot: ViewSnapshot): string[] {
  return snapshot.groups.map((candidate) => candidate.name);
}

function group(snapshot: ViewSnapshot, name: string): string {
  const found = snapshot.groups.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`The view has no "${name}" group; it has ${JSON.stringify(groupNames(snapshot))}`);
  return found.text;
}

// The analyzer's turn count of the run's new chats, not the DOM: VS Code pins
// the chat's request at the top while the list's own row for it is also
// rendered near the first view (A33's first run counted 2 DOM requests, one chat request).
async function expectNoNewChatRequest(): Promise<void> {
  expect(await newTurns()).toBe(turnsAfterChat);
}

// The run's new chats (not listed before the views chat): their turns and AI Credits.
async function newSessions() {
  return (await analyzer!.sessions()).filter((session) => !knownBefore.has(session.id));
}

async function newTurns(): Promise<number> {
  return (await newSessions()).reduce((sum, session) => sum + session.turnCount, 0);
}

suite("Increment 3 MCP App views in a real Copilot Chat (A33; opt-in)", function () {
  this.timeout(900_000);

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

    // Unsent, and the suite skips, over the AI Credits cap or on another model.
    await sendToAgent(this, viewsPrompt(viewCalls(history!)), "suite");
    const wanted = viewCalls(history!).length;
    const rendered = await views.waitForViews(wanted, CHAT_TIMEOUT_MS).then(
      () => wanted,
      () => views.count(),
    );
    if (rendered < wanted) skipSuite(this, `Copilot's answer showed ${rendered} of the ${wanted} views the prompt asks for (it made fewer tool calls); rerun`);
    await views.waitForResponse(CHAT_TIMEOUT_MS);
    chatSessionId = await waitForNewSession(knownBefore, CHAT_TIMEOUT_MS);
    const session = await analyzer.session(chatSessionId);
    console.log(`[copilot-e2e] observed Copilot log id for ${MODEL}: ${session.model}`);
    logToRun({ kind: "observed-model", model: session.model });
    if (!modelMatches(MODEL, session.model)) skipSuite(this, `the Increment 3 views chat ran on "${session.model}", not ${MODEL}`);
    // Counted now, so the cap sees it before U5's Analyse starts another turn.
    creditsRecorded = (await analyzer.aiCredits(chatSessionId)) ?? 0;
    recordChatCredits(creditsRecorded);
    console.log(`[copilot-e2e] AI Credits spent by the Increment 3 views chat: ${creditsRecorded.toFixed(4)}`);

    // The views by what they show, so a model that calls the tools in another order still passes.
    for (let index = 0; index < rendered; index++) {
      const key = keyOf(await views.inside(index, (view) => view.snapshot()));
      if (key !== undefined && VIEW[key] === undefined) VIEW[key] = index;
    }
    const missing = (["compare", "replay", "prices", "audit", "rollup", "picker"] as const).filter((key) => VIEW[key] === undefined);
    if (missing.length > 0) skipSuite(this, `the chat showed no ${missing.join(", ")} view (Copilot called other tools); rerun`);
    turnsAfterChat = await newTurns();
    expect(turnsAfterChat).toBe(1);
    normalWidth = await views.setViewWidth(NORMAL_WIDTH);
    console.log(`[copilot-e2e] the views are ${normalWidth} px wide`);
    await saveScreenshot("a33-chat");
  });

  suiteTeardown(async () => {
    if (chatSessionId !== undefined && analyzer !== undefined) {
      // Whatever the run's new chats logged since the count above (U5's Analyse turn, late log lines).
      let total = 0;
      for (const session of await newSessions()) total += (await analyzer.aiCredits(session.id)) ?? 0;
      const rest = Math.max(0, total - creditsRecorded);
      if (rest > 0) recordChatCredits(rest);
      console.log(`[copilot-e2e] AI Credits spent by this spec file's chats: ${total.toFixed(4)}`);
    }
    await analyzer?.close();
  });

  teardown(async function () {
    await views.leave();
    if (this.currentTest?.state === "failed") await saveScreenshot(`a33-failed-${this.currentTest.title.slice(0, 40).replace(/[^\w.-]+/g, "-")}`);
  });

  test(copilotTestTitle("A33 tools", "the extension's tools/list gives the six Increment 3 tools a view and names no billing tool (get_statement, estimate_cost); the chat shows no billing view"), async () => {
    const tools = await analyzer!.tools();
    const names = tools.map((tool) => tool.name);

    for (const name of BILLING_TOOLS) expect(names).not.toContain(name);
    for (const name of INCREMENT3_VIEW_TOOLS) expect({ name, hasView: tools.find((tool) => tool.name === name)?.hasView }).toEqual({ name, hasView: true });
    const kickers: string[] = [];
    for (let index = 0; index < (await views.count()); index++) kickers.push((await views.inside(index, (view) => view.snapshot())).kicker);
    expect(kickers.filter((kicker) => /Statement|Estimate/.test(kicker))).toEqual([]);
  });

  test(copilotTestTitle("A33 U12.compare", "U12 compare: Replay on other models, Simulated, the own-model check, measured row first then the models in the tool's order; a model opens its replay in place, Back returns focus to it, by mouse and keyboard, with no new chat request"), async () => {
    const sessionId = history!.sessionIds[0]!;
    await views.inside(VIEW.compare, async (view) => {
      const u12 = keep("u12-compare", await view.snapshot());
      expect(u12.kicker).toBe(`${KICKER}Replay on other models`);
      expect(u12.title).toMatch(/^Replay on other models/);
      expect(u12.title).toContain("Simulated");
      expect(u12.text).toContain(`Session ${sessionId}`);
      expect(u12.text).toContain("Own-model check:");
      // The tool's order: the session's own model first, then the models asked for.
      const rows = await view.replayRows();
      expect(rows[0]).toBe("measured");
      expect(rows.slice(2)).toEqual([...HISTORY_REPLAY_MODELS]);
      expect(u12.text).toContain("session's own model");

      const model = HISTORY_REPLAY_MODELS[1];
      await view.click(model);
      await view.waitForTitle(new RegExp(`^Replay on ${model.replaceAll(".", "\\.")}`));
      await browser.waitUntil(async () => (await view.snapshot()).images.some((name) => /per turn/.test(name)), { timeout: 30_000, timeoutMsg: "the replay did not load in place" });
      const drilled = keep("u12-replay-in-place", await view.snapshot());
      expect(drilled.kicker).toBe(`${KICKER}Replay on other models › Session replay`);
      expect(drilled.buttons).toContain("Back to model comparison");
      expect(drilled.text).toContain(`Replay comparison / ${model}`);
      expect(drilled.title).toContain("Simulated");
      expect(drilled.text).toMatch(/Self-check passed/);
      expect(groupNames(drilled)).toContain("Difference");
      await view.click("Back to model comparison");
      await view.waitForTitle(/^Replay on other models/);
      await browser.waitUntil(async () => (await view.focusedControl()) === model, { timeout: 10_000, timeoutMsg: "focus did not return to the opened model" });

      // Keyboard only: Tab to the other model, Enter, Tab to Back, Enter.
      const other = HISTORY_REPLAY_MODELS[0];
      await view.tabTo(other);
      await view.pressEnter();
      await view.waitForTitle(new RegExp(`^Replay on ${other.replaceAll(".", "\\.")}`));
      await view.tabTo("Back to model comparison");
      await view.pressEnter();
      await view.waitForTitle(/^Replay on other models/);
      await browser.waitUntil(async () => (await view.focusedControl()) === other, { timeout: 10_000, timeoutMsg: "focus did not return to the model opened by keyboard" });
      expect(await view.focusRingVisible()).toBe(true);
    });
    await expectNoNewChatRequest();
  });

  test(copilotTestTitle("A33 U12.replay", "U12 replay opened directly: Session replay kicker, Replay on <model> with Simulated, the per-turn chart, a passed self-check, the difference tile, no Back"), async () => {
    const replay = keep("u12-replay", await views.inside(VIEW.replay, (view) => view.snapshot()));

    expect(replay.kicker).toBe(`${KICKER}Session replay`);
    expect(replay.title).toMatch(new RegExp(`^Replay on ${DIRECT_REPLAY_MODEL.replaceAll(".", "\\.")}`));
    expect(replay.title).toContain("Simulated");
    expect(replay.images.some((name) => /per turn/.test(name))).toBe(true);
    expect(replay.text).toMatch(/Self-check passed/);
    expect(groupNames(replay)).toContain("Difference");
    expect(replay.text).toContain("would have cost about");
    expect(replay.buttons.filter((name) => /^Back/.test(name))).toEqual([]);
  });

  // U11 → U13 is not checked here: Copilot turns are never priced (no
  // cache-write count), so U11 shows its "nothing priced" state with no
  // Price changes control (A24 1.5). G5 covers the drill-down (A28).
  test(copilotTestTitle("A33 U13", "U13 price changes: kicker, title with the period, the timeline, documented changes tagged with their sources, written signs, no chat request"), async () => {
    const prices = keep("u13", await views.inside(VIEW.prices, (view) => view.snapshot()));

    expect(prices.kicker).toBe(`${KICKER}Price changes`);
    expect(prices.title).toMatch(/^Price changes, /);
    expect(prices.images.some((name) => /^Price changes on a timeline/.test(name))).toBe(true);
    expect(prices.text).toContain("documented");
    expect(prices.text).toMatch(/Source/);
    expect(prices.text).toMatch(/[−+]\d+(\.\d+)? ?%/);
    await expectNoNewChatRequest();
  });

  test(copilotTestTitle("A33 U4.session", "U4 session audit: Tool-call audit kicker, the session's title, tiles with the failure rate Unknown (never 0 %) because Copilot records no outcomes, recovery cost in tokens, not AI Credits, calls by tool"), async () => {
    const audit = keep("u4-session", await views.inside(VIEW.audit, (view) => view.snapshot()));

    expect(audit.kicker).toBe(`${KICKER}Tool-call audit`);
    expect(audit.title).toMatch(/^Placeholder portal-web session/);
    for (const tile of ["Tool calls", "Failed", "Failure rate", "Outcome unknown"]) expect(groupNames(audit)).toContain(tile);
    expect(group(audit, "Failure rate")).toMatch(/Unknown/);
    expect(group(audit, "Failure rate")).not.toMatch(/\b0 ?%/);
    expect(audit.text).toContain("tokens, not AI Credits");
    expect(audit.tables).toContain("Tool calls by tool");
  });

  test(copilotTestTitle("A33 U4.rollup", "U4 rollup: Tool-call failures, tiles with the failure rate Unknown, failed calls per day as Unknown days with View as table, the display-only sessions table; no tool call or chat request"), async () => {
    await views.inside(VIEW.rollup, async (view) => {
      const rollup = keep("u4-rollup", await view.snapshot());
      expect(rollup.kicker).toBe(`${KICKER}Tool-call audit`);
      expect(rollup.title).toBe("Tool-call failures");
      for (const tile of ["Tool calls", "Failed", "Failure rate"]) expect(groupNames(rollup)).toContain(tile);
      expect(group(rollup, "Failure rate")).toMatch(/Unknown/);
      expect(rollup.images.some((name) => /^Failed calls per day/.test(name))).toBe(true);
      expect(rollup.tables).toContain("Most failures by session");
      // The only control: the chart's text form, which calls nothing.
      expect(rollup.buttons).toEqual(["View as table"]);
      await view.click("View as table");
      await browser.waitUntil(async () => (await view.snapshot()).tables.includes("Failed calls per day"), { timeout: 15_000, timeoutMsg: "View as table showed no table" });
      expect((await view.snapshot()).text).toMatch(/Unknown/);
      await view.click("Hide table");
    });
    await expectNoNewChatRequest();
  });

  test(copilotTestTitle("A33 U5.list", "U5 session picker: Sessions, the seeded sessions with short id, turns, model and repository, no cost, an Analyse button per row, the hint that only Analyse session <id> is sent"), async () => {
    const picker = keep("u5", await views.inside(VIEW.picker, (view) => view.snapshot()));
    const newest = history!.sessionIds[0]!.slice(0, 8);

    expect(picker.kicker).toBe(`${KICKER}Sessions`);
    expect(picker.title).toBe("Sessions");
    expect(picker.text).toMatch(/Placeholder portal-web session/);
    expect(picker.text).toContain(newest);
    expect(picker.text).toContain("github.com/example/portal-web");
    expect(picker.buttons).toContain(`Analyse session ${newest}`);
    for (const id of history!.sessionIds) expect(picker.buttons).toContain(`Analyse session ${id.slice(0, 8)}`);
    expect(picker.text).toContain("A click sends only Analyse session <id> to the chat. Titles and other session text are never sent.");
    // list_sessions returns no cost, so no row shows one (§9.2 Q8).
    expect(picker.text.replaceAll("AI Credits Analyzer", "")).not.toMatch(/AI Credits|\$/);
  });

  test(copilotTestTitle("A33 themes", "U12, U13, U4 and U5 follow Light Modern, Dark Modern, Dark and Light High Contrast mid-run; text reaches AA on the chat's ground; focus ring on Tab"), async () => {
    const themes = [
      { name: "Default Light Modern", bodyClass: "vscode-light", scheme: "light" },
      { name: "Default Dark Modern", bodyClass: "vscode-dark", scheme: "dark" },
      { name: "Default High Contrast", bodyClass: "vscode-high-contrast", scheme: "dark" },
      { name: "Default High Contrast Light", bodyClass: "vscode-high-contrast-light", scheme: "light" },
    ];
    const findings: string[] = [];
    for (const theme of themes) {
      await host.setSetting(THEME_SETTING, theme.name);
      for (const [name, index] of Object.entries(VIEW)) {
        await views.scrollTo(index);
        const ground = await views.ground();
        await views.inside(index, async (view) => {
          await browser.waitUntil(async () => (await view.theme()).bodyClasses.includes(theme.bodyClass), { timeout: 30_000, timeoutMsg: `${name} did not follow ${theme.name}` });
          expect((await view.theme()).scheme).toBe(theme.scheme);
          const judged = await view.contrastFindings(ground);
          expect(judged.texts).toBeGreaterThan(10);
          findings.push(...judged.findings.map((finding) => `${theme.name} ${name}: ${finding}`));
          if ((await view.snapshot()).buttons.length > 0) {
            await view.tabToAButton();
            expect({ view: name, focusRing: await view.focusRingVisible() }).toEqual({ view: name, focusRing: true });
          }
        });
      }
      await saveScreenshot(`a33-theme-${theme.bodyClass}`);
    }
    await host.setSetting(THEME_SETTING, "Default Light Modern");
    expect(findings).toEqual([]);
  });

  test(copilotTestTitle("A33 narrow", "narrow chat, about 360 px, and a normal one, about 600 px: U12, U13, U4 and U5 don't scroll sideways"), async () => {
    const narrow = await views.setViewWidth(NARROW_WIDTH);
    try {
      expect(isWithinTolerance(narrow, NARROW_WIDTH)).toBe(true);
      for (const [name, index] of Object.entries(VIEW)) {
        await views.inside(index, async (view) => {
          expect(await view.width()).toBeLessThanOrEqual(narrow);
          expect({ view: name, scrollsSideways: await view.scrollsSideways() }).toEqual({ view: name, scrollsSideways: false });
        });
      }
      await saveScreenshot("a33-narrow");
    } finally {
      normalWidth = await views.setViewWidth(NORMAL_WIDTH);
    }
    expect(normalWidth).toBeGreaterThanOrEqual(NORMAL_WIDTH - 40);
    for (const [name, index] of Object.entries(VIEW)) {
      await views.inside(index, async (view) => {
        expect({ view: name, scrollsSideways: await view.scrollsSideways() }).toEqual({ view: name, scrollsSideways: false });
      });
    }
  });

  test(copilotTestTitle("A33 footer", "footer: every Increment 3 view ends with Read-only · local logs · v<extension version>, and its text can be selected"), async () => {
    for (const index of Object.values(VIEW)) {
      await views.inside(index, async (view) => {
        expect((await view.snapshot()).footer).toBe(`Read-only · local logs · v${VERSION}`);
        expect(await view.textSelectable()).toBe(true);
      });
    }
  });

  // Last: if VS Code sends the message, it adds a chat request (and the views its answer may show).
  test(copilotTestTitle("A33 U5.analyse", "U5 Analyse in VS Code (no `message` capability advertised): one press adds exactly one chat request, Analyse session <id>, or puts exactly that text in the chat input unsent, or the row shows Ask in the chat: Analyse session <id>; which one is recorded"), async function () {
    const allowed = mayStartTurn();
    if (!allowed.send) skipTest(this, allowed.reason);
    const sessionId = history!.sessionIds[0]!;
    const shortId = sessionId.slice(0, 8);
    const turnsBefore = await newTurns();

    let row = "pending" as AnalyseRowState;
    await views.inside(VIEW.picker, async (view) => {
      await view.click(`Analyse session ${shortId}`);
      await browser
        .waitUntil(
          async () => {
            row = await view.analyseRow(shortId);
            return row !== "pending";
          },
          { timeout: 60_000, interval: 500 },
        )
        .catch(() => undefined);
    });
    // Sent: VS Code adds the request, then the analyzer sees its turn. Staged
    // (VS Code 1.146): the text sits in the chat input; it is watched for
    // STAGED_WATCH_MS more, so a late send still counts as sent.
    let requestTexts: string[] = [];
    let inputText = "";
    let turnsAfter = turnsBefore;
    if (row !== "fallback") {
      let stagedSince: number | undefined;
      await browser
        .waitUntil(
          async () => {
            requestTexts = await views.requestTexts();
            inputText = await views.inputText();
            turnsAfter = await newTurns();
            if (turnsAfter > turnsBefore && requestTexts.some((text) => text.includes(sessionId))) return true;
            if (!inputText.includes(sessionId)) return false;
            stagedSince ??= Date.now();
            return Date.now() - stagedSince >= STAGED_WATCH_MS;
          },
          { timeout: 120_000, interval: 2_000 },
        )
        .catch(() => undefined);
      if (turnsAfter > turnsBefore) {
        await views.waitForResponse(CHAT_TIMEOUT_MS);
        turnsAfter = await newTurns();
      }
    }
    const outcome = analyseOutcome({ sessionId, turnsBefore, turnsAfter, requestTexts, inputText, row });
    console.log(`[copilot-e2e] U5 Analyse in Copilot Chat: ${outcome.kind}${outcome.kind === "failed" ? ` (${outcome.reason})` : ""}`);
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path.join(OUT_DIR, "a33-u5-analyse.json"), JSON.stringify({ outcome, turnsBefore, turnsAfter, row }, null, 2));    await saveScreenshot("a33-u5-analyse");
    expect(outcome.kind).not.toBe("failed");
    if (outcome.kind === "sent") {
      // The turn Analyse started ran on the chat's model, like the chat itself.
      const session = await analyzer!.session(chatSessionId!);
      expect(modelMatches(MODEL, session.model)).toBe(true);
    }
  });
});
