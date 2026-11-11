// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// OPT-IN, OWNER-RUN, spends real AI Credits (about 0.5 per run): the MCP App
// views in a real Copilot Chat (step 10.17 G4, docs/plans/release-ui-gate.md),
// in place of the owner's VS Code checks A24 §1 (U9, U10, U11) and A16 §1
// (U1, U2, U3). See wdio.copilot.conf.mts for how to run it.
//
// One chat in the test-only agent asks Copilot to call eight analyzer tools
// in one step; each call renders its view under it. The data is made up
// (chat-history-seed.mts: two repositories over several weeks); the copy's
// earlier chats are cleared first. Specs assert only on the views, never on
// the model's words. Drill-downs and Back inside a view are tool calls the
// view makes, not model turns: the chat must show no new request.
// TDD exception: the spec runs only against a real VS Code and Copilot; its
// pure parts (seeding, prompt, overlay match) are unit-tested.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { copilotTestTitle } from "../../../../scripts/release-evidence/evidence.mts";
import { isWithinTolerance } from "../../support/panel-width.js";
import { OUT_DIR, saveScreenshot } from "../../support/screenshots.js";
import { wdioVscodeHost as host } from "../../support/vscode-host.js";
import { CHAT_HISTORY_ENV, HISTORY_REPOSITORIES, type ChatHistory } from "../support/chat-history-seed.mts";
import { ChatViews, type ChatView, type ViewSnapshot } from "../support/chat-view.js";
import { AnalyzerClient, listedSessions, MODEL, recordChatCredits, sendToAgent, waitForCopilot, waitForNewSession } from "../support/copilot-chat.js";
import { modelMatches } from "../support/copilot-e2e-env.mts";
import { logToRun, skipSuite } from "../support/run-log.mts";
import { type ViewCall, viewsPrompt } from "../support/view-prompt.mts";

const history = JSON.parse(process.env[CHAT_HISTORY_ENV] ?? "null") as ChatHistory | null;
const VERSION = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../package.json"), "utf8")) as { version: string }).version;
const PORTAL = HISTORY_REPOSITORIES.portal.key;
const BILLING = HISTORY_REPOSITORIES.billing.key;
const MISSING_REPOSITORY = "no-such-repo";
const THEME_SETTING = "workbench.colorTheme";
// The chat turn, its eight tool calls and their views.
const CHAT_TIMEOUT_MS = 300_000;
// A normal-width chat panel's views (A24 1.8's 600 px) and a narrow one.
const NORMAL_WIDTH = 600;
const NARROW_WIDTH = 360;

// The views in tool-call order (the order of the prompt's calls).
const VIEW = { u9: 0, project: 1, u10: 2, u11: 3, missing: 4, u1: 5, u2: 6, u3: 7 } as const;

function viewCalls(seeded: ChatHistory): ViewCall[] {
  const { last90Days, comparison, change } = seeded.periods;
  return [
    { tool: "get_repository_cost", args: { repository: PORTAL, bucket: "week", ...last90Days } },
    { tool: "get_project_cost", args: { projectId: "demo" } },
    { tool: "compare_costs", args: { groupBy: "repository", ids: [PORTAL, BILLING], ...comparison } },
    { tool: "explain_cost_change", args: { groupBy: "repository", id: PORTAL, ...change } },
    { tool: "get_repository_cost", args: { repository: MISSING_REPOSITORY } },
    { tool: "get_session_cost", args: { sessionId: seeded.sessionIds[0] } },
    { tool: "get_cost_rollup", args: { since: last90Days.since } },
    { tool: "list_findings", args: { since: last90Days.since } },
  ];
}

const views = new ChatViews();
let analyzer: AnalyzerClient | undefined;
let chatSessionId: string | undefined;
let requestsAfterChat = 0;
let normalWidth = 0;

// Each view's snapshot, kept with the run's screenshots for the owner.
function keep(name: string, snapshot: ViewSnapshot): ViewSnapshot {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, `g4-${name}.json`), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

function group(snapshot: ViewSnapshot, name: string): string {
  const found = snapshot.groups.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`The view has no "${name}" group; it has ${JSON.stringify(snapshot.groups.map((candidate) => candidate.name))}`);
  return found.text;
}

async function useTheme(name: string): Promise<void> {
  await host.setSetting(THEME_SETTING, name);
}

async function expectNoNewChatRequest(): Promise<void> {
  expect(await views.requestCount()).toBe(requestsAfterChat);
}

suite("MCP App views in a real Copilot Chat (A24 §1, A16 §1; opt-in)", function () {
  this.timeout(900_000);

  suiteSetup(async function () {
    if (history === null) skipSuite(this, "no seeded chat history (run through wdio.copilot.conf.mts)");
    await host.waitForExtension();
    await host.command("workbench.extensions.action.enableAll");
    const readiness = await waitForCopilot();
    if (readiness.status === "gave-up") skipSuite(this, readiness.reason);
    // A24 1.7: the first pass is in Light Modern. Room for a 600 px chat.
    await useTheme("Default Light Modern");
    await host.command("workbench.action.closeSidebar");
    const known = new Set((await listedSessions()).map((node) => node.sessionId));
    analyzer = await AnalyzerClient.connect();

    // Unsent, and the suite skips, over the AI Credits cap or on another model.
    await sendToAgent(this, viewsPrompt(viewCalls(history!)), "suite");
    // A live model may make fewer calls than asked (risk R2): the run skips
    // with the reason, and the release gate refuses the skip.
    const wanted = Object.keys(VIEW).length;
    const rendered = await views.waitForViews(wanted, CHAT_TIMEOUT_MS).then(
      () => wanted,
      () => views.count(),
    );
    if (rendered < wanted) skipSuite(this, `Copilot's answer showed ${rendered} of the ${wanted} views the prompt asks for (it made fewer tool calls); rerun`);
    await views.waitForResponse(CHAT_TIMEOUT_MS);
    chatSessionId = await waitForNewSession(known, CHAT_TIMEOUT_MS);
    const session = await analyzer.session(chatSessionId);
    console.log(`[copilot-e2e] observed Copilot log id for ${MODEL}: ${session.model}`);
    logToRun({ kind: "observed-model", model: session.model });
    if (!modelMatches(MODEL, session.model)) skipSuite(this, `the views chat ran on "${session.model}", not ${MODEL}`);
    requestsAfterChat = await views.requestCount();
    normalWidth = await views.setViewWidth(NORMAL_WIDTH);
    console.log(`[copilot-e2e] the views are ${normalWidth} px wide`);
    await saveScreenshot("g4-chat");
  });

  suiteTeardown(async () => {
    if (chatSessionId !== undefined && analyzer !== undefined) {
      const spent = (await analyzer.aiCredits(chatSessionId)) ?? 0;
      recordChatCredits(spent);
      console.log(`[copilot-e2e] AI Credits spent by the views chat: ${spent.toFixed(4)}`);
    }
    await analyzer?.close();
  });

  teardown(async function () {
    await views.leave();
    if (this.currentTest?.state === "failed") await saveScreenshot(`g4-failed-${this.currentTest.title.slice(0, 40).replace(/[^\w.-]+/g, "-")}`);
  });

  test(copilotTestTitle("A24 1.1", "U9 repository cost over time: kicker, title, period line, four basis tiles, weekly chart, no sessions, vendor or token tables, no currency control"), async () => {
    const u9 = keep("u9", await views.inside(VIEW.u9, (view) => view.snapshot()));

    expect(u9.kicker).toBe("AI Credits Analyzer · Repository cost");
    expect(u9.title).toBe(PORTAL);
    expect(u9.subtitle).toMatch(/week/);
    for (const tile of ["Total · preferred basis", "Billed", "Reported", "Priced"]) expect(u9.groups.map((candidate) => candidate.name)).toContain(tile);
    expect(group(u9, "Billed")).toMatch(/AI Credits/);
    // Copilot logs report nothing and price nothing here: Unknown, never 0.
    expect(group(u9, "Reported")).toMatch(/Unknown/);
    expect(u9.images.some((name) => /^Cost per week/.test(name))).toBe(true);
    for (const table of ["Top sessions by cost", "Cost by vendor, then model", "Tokens by type, per model"]) expect(u9.tables).not.toContain(table);
    expect(u9.groups.map((candidate) => candidate.name)).not.toContain("Currency");
  });

  test(copilotTestTitle("A24 1.2", "U9 project in the extension: No projects here, the extension's reason, what to ask instead, the tool's answer, no chart"), async () => {
    const project = keep("project", await views.inside(VIEW.project, (view) => view.snapshot()));

    expect(project.title).toBe("No projects here");
    expect(project.kicker).toBe("AI Credits Analyzer · Project cost");
    expect(project.text).toContain("AI Credits Analyzer has no projects: projects are edited in the standalone Agent Cost Analyzer app.");
    expect(project.text).toContain("What to ask instead");
    expect(project.text).toContain('Unknown project id "demo"');
    expect(project.images).toEqual([]);
  });

  test(copilotTestTitle("A24 1.3", "U10 repository comparison: title, units sentence, rows most expensive first, change with sign, Together, rows are buttons"), async () => {
    const u10 = keep("u10", await views.inside(VIEW.u10, (view) => view.snapshot()));

    expect(u10.kicker).toBe("AI Credits Analyzer · Cost comparison");
    expect(u10.title).toBe("2 repositories compared");
    expect(u10.text).toContain("All money in AI Credits on the preferred basis: billed, then reported, then priced.");
    expect(u10.tables).toContain("Cost by repository");
    // Portal has more sessions, so it comes first.
    const rows = u10.buttons.filter((name) => name === PORTAL || name === BILLING);
    expect(rows).toEqual([PORTAL, BILLING]);
    expect(u10.text).toMatch(/Together/);
    // Both had an earlier figure: a signed percentage, never "from 0".
    expect(u10.text).toMatch(/[+−-]\d+(\.\d+)? ?%/);
    expect(u10.text).not.toMatch(/from 0/);
  });

  test(copilotTestTitle("A24 1.4", "U10 → U9 drill-down in place: kicker, trail, Back with focus on the row, keyboard only, no new chat request"), async () => {
    await views.inside(VIEW.u10, async (view) => {
      await view.click(PORTAL);
      await view.waitForTitle(PORTAL);
      // Loaded: U9's basis tiles are there, not "Loading …".
      await browser.waitUntil(async () => (await view.snapshot()).groups.some((candidate) => candidate.name === "Billed"), { timeout: 30_000, timeoutMsg: "U9 did not load in place" });
      const drilled = keep("u10-u9", await view.snapshot());
      expect(drilled.images.some((name) => /^Cost per /.test(name))).toBe(true);
      expect(drilled.kicker).toBe("AI Credits Analyzer · Cost comparison › Repository cost");
      expect(drilled.buttons).toContain("Back to comparison");
      expect(drilled.text).toContain(`Cost comparison / ${PORTAL}`);
      // The chain stops here: a repository has no sessions to open.
      expect(drilled.tables).not.toContain("Top sessions by cost");

      await view.click("Back to comparison");
      await view.waitForTitle("2 repositories compared");
      await browser.waitUntil(async () => (await view.focusedControl()) === PORTAL, { timeout: 10_000, timeoutMsg: "focus did not return to the opened row" });

      // Keyboard only: Tab to a row, Enter, Tab to Back, Enter.
      await view.tabTo(BILLING);
      await view.pressEnter();
      await view.waitForTitle(BILLING);
      await view.tabTo("Back to comparison");
      await view.pressEnter();
      await view.waitForTitle("2 repositories compared");
      await browser.waitUntil(async () => (await view.focusedControl()) === BILLING, { timeout: 10_000, timeoutMsg: "focus did not return to the row opened by keyboard" });
      // A keyboard user sees the ring on the row (after a mouse click the browser draws none).
      expect(await view.focusRingVisible()).toBe(true);
    });
    await expectNoNewChatRequest();
  });

  // Copilot's debug logs have no cache-write count, so no Copilot turn is
  // priced (chat-history-seed.test.ts): U11 shows its "nothing priced" state.
  // Tiles, waterfall, model table and the Price changes button need priced
  // turns; the fake host covers them (G5, A24 2.7 and 2.8).
  test(copilotTestTitle("A24 1.5", "U11 cost change with nothing priced: kicker, the priced basis named, both periods, no figures, Not explained counted per period with the reason, never 0, documented price changes section"), async () => {
    const u11 = keep("u11", await views.inside(VIEW.u11, (view) => view.snapshot()));

    expect(u11.kicker).toBe("AI Credits Analyzer · Cost change");
    expect(u11.title).toBe(PORTAL);
    expect(u11.subtitle).toBe(`repository · ${history!.periods.change.periodA.since} – ${history!.periods.change.periodA.until} vs ${history!.periods.change.periodB.since} – ${history!.periods.change.periodB.until} · priced, prices as of use`);
    expect(u11.text).toContain("This view always uses the priced basis");
    expect(u11.text).toContain("No priced figures in either period.");
    expect(u11.text).toMatch(/Not explained\s+10 turns in all/);
    expect(u11.text).toContain("not counted as 0");
    expect(u11.text).toMatch(/4 turns without a priced figure are not explained/);
    expect(u11.text).toMatch(/6 turns without a priced figure are not explained/);
    expect(u11.text).toContain("Documented price changes between the periods");
  });

  test(copilotTestTitle("A24 1.6", "error state, unknown repository: the real server answers an empty series, so U9 shows Unknown tiles and no turns, never 0, and no bars"), async () => {
    const missing = keep("missing", await views.inside(VIEW.missing, (view) => view.snapshot()));

    expect(missing.title).toBe(MISSING_REPOSITORY);
    for (const tile of ["Total · preferred basis", "Billed", "Reported", "Priced"]) expect(group(missing, tile)).toMatch(/Unknown/);
    expect(missing.text).toContain("0 sessions, 0 turns.");
    expect(missing.text).toMatch(/No (weeks|months|days) in this period\./);
  });

  test(copilotTestTitle("A24 1.7", "themes: U9, U10, U11 and A16's U1-U3 follow Light Modern, Dark Modern, Dark and Light High Contrast mid-run; text reaches AA on the chat's ground; focus ring on Tab"), async () => {
    const themes = [
      { name: "Default Light Modern", bodyClass: "vscode-light", scheme: "light" },
      { name: "Default Dark Modern", bodyClass: "vscode-dark", scheme: "dark" },
      { name: "Default High Contrast", bodyClass: "vscode-high-contrast", scheme: "dark" },
      { name: "Default High Contrast Light", bodyClass: "vscode-high-contrast-light", scheme: "light" },
    ];
    const findings: string[] = [];
    for (const theme of themes) {
      await useTheme(theme.name);
      for (const [name, index] of Object.entries({ u9: VIEW.u9, u10: VIEW.u10, u11: VIEW.u11, u1: VIEW.u1, u2: VIEW.u2, u3: VIEW.u3 })) {
        await views.scrollTo(index);
        const ground = await views.ground();
        await views.inside(index, async (view) => {
          await browser.waitUntil(async () => (await view.theme()).bodyClasses.includes(theme.bodyClass), { timeout: 30_000, timeoutMsg: `${name} did not follow ${theme.name}` });
          expect((await view.theme()).scheme).toBe(theme.scheme);
          const judged = await view.contrastFindings(ground);
          // Guards against a vacuous pass: the view has real text to judge.
          expect(judged.texts).toBeGreaterThan(10);
          findings.push(...judged.findings.map((finding) => `${theme.name} ${name}: ${finding}`));
          // U11 with nothing priced has no control to focus.
          if ((await view.snapshot()).buttons.length > 0) {
            await view.tabToAButton();
            expect({ view: name, focusRing: await view.focusRingVisible() }).toEqual({ view: name, focusRing: true });
          }
        });
      }
      await saveScreenshot(`g4-theme-${theme.bodyClass}`);
    }
    await useTheme("Default Light Modern");
    expect(findings).toEqual([]);
  });

  // U11's by-model table (costs A and B dropping out, Price in view at 600 px)
  // needs priced turns, which Copilot's logs don't give (no cache-write
  // count): the fake host covers it (G5, A24 2.9). Here U11 is checked for fit.
  test(copilotTestTitle("A24 1.8", "narrow chat, about 360 px, and a normal one, about 600 px: U9, U10, U11 and A16's U1-U3 don't scroll sideways; at 360 px U10 moves its figures under the row name"), async () => {
    const all = { u9: VIEW.u9, u10: VIEW.u10, u11: VIEW.u11, u1: VIEW.u1, u2: VIEW.u2, u3: VIEW.u3 };
    const narrow = await views.setViewWidth(NARROW_WIDTH);
    try {
      expect(isWithinTolerance(narrow, NARROW_WIDTH)).toBe(true);
      for (const [name, index] of Object.entries(all)) {
        await views.inside(index, async (view) => {
          expect(await view.width()).toBeLessThanOrEqual(narrow);
          expect({ view: name, scrollsSideways: await view.scrollsSideways() }).toEqual({ view: name, scrollsSideways: false });
        });
      }
      const u10 = keep("u10-narrow", await views.inside(VIEW.u10, (view) => view.snapshot()));
      expect(u10.text).toMatch(/per session.*per active day.*per turn.*cache hit/s);
      await saveScreenshot("g4-narrow");
    } finally {
      normalWidth = await views.setViewWidth(NORMAL_WIDTH);
    }
    // The suite's window lets the chat give its views about 576 px at most.
    expect(normalWidth).toBeGreaterThanOrEqual(NORMAL_WIDTH - 40);
    for (const [name, index] of Object.entries(all)) {
      await views.inside(index, async (view) => {
        expect({ view: name, scrollsSideways: await view.scrollsSideways() }).toEqual({ view: name, scrollsSideways: false });
      });
    }
  });

  test(copilotTestTitle("A24 1.9", "footer: every view ends with Read-only · local logs · v<extension version>, and its text can be selected"), async () => {
    for (const index of Object.values(VIEW)) {
      await views.inside(index, async (view) => {
        expect((await view.snapshot()).footer).toBe(`Read-only · local logs · v${VERSION}`);
        expect(await view.textSelectable()).toBe(true);
      });
    }
  });

  test(copilotTestTitle("A16 U1", "session cost: tiles, per-turn chart, top turns; a turn opens in place and hides; Copy title names Open Session; unknown figures read Unknown, never 0"), async () => {
    await views.inside(VIEW.u1, async (view) => {
      const u1 = keep("u1", await view.snapshot());
      expect(u1.kicker).toBe("AI Credits Analyzer · Session cost");
      expect(u1.images.some((name) => /per turn/.test(name))).toBe(true);
      expect(u1.tables.some((name) => /^Top turns by/.test(name))).toBe(true);
      expect(u1.text).not.toMatch(/\b0 AI Credits\b/);
      const turn = u1.buttons.find((name) => /^Turn \d+$/.test(name));
      expect(turn).toBeDefined();
      await view.click(turn!);
      await browser.waitUntil(async () => (await view.snapshot()).buttons.includes("Hide turn"), { timeout: 15_000, timeoutMsg: "the turn did not open" });
      await view.click("Hide turn");
      await browser.waitUntil(async () => !(await view.snapshot()).buttons.includes("Hide turn"), { timeout: 15_000, timeoutMsg: "the turn did not close" });
      await view.click("Copy title to open in panel");
      await browser.waitUntil(async () => (await view.snapshot()).text.includes("AI Credits Analyzer: Open Session"), { timeout: 15_000, timeoutMsg: "no hint names Open Session" });
    });
    await expectNoNewChatRequest();
  });

  test(copilotTestTitle("A16 U2", "spend rollup: daily chart, by model, by provider, top sessions; a session drills into U1 in place and Back returns with no new chat request"), async () => {
    await views.inside(VIEW.u2, async (view) => {
      const u2 = keep("u2", await view.snapshot());
      expect(u2.kicker).toBe("AI Credits Analyzer · Cost rollup");
      expect(u2.images.some((name) => /^Daily /.test(name))).toBe(true);
      expect(u2.text).toMatch(/by model/i);
      expect(u2.text).toMatch(/by provider/i);
      const top = u2.tables.find((name) => /^Top sessions by/.test(name));
      expect(top).toBeDefined();
      const session = u2.buttons.find((name) => /^Placeholder portal-web session/.test(name));
      expect(session).toBeDefined();
      await view.click(session!);
      await view.waitForTitle(session!);
      expect((await view.snapshot()).buttons).toContain("Back to cost rollup");
      await view.click("Back to cost rollup");
      await view.waitForTitle(u2.title);
      await browser.waitUntil(async () => (await view.focusedControl()) === session, { timeout: 10_000, timeoutMsg: "focus did not return to the session row" });
    });
    await expectNoNewChatRequest();
  });

  test(copilotTestTitle("A16 U3", "findings: severity tiles and the findings summary; the kind filter reloads in place with no new chat request"), async () => {
    await views.inside(VIEW.u3, async (view) => {
      const u3 = keep("u3", await view.snapshot());
      expect(u3.kicker).toBe("AI Credits Analyzer · Findings");
      for (const tile of ["Critical", "High", "Medium", "Low", "Info"]) expect(u3.groups.map((candidate) => candidate.name)).toContain(tile);
      await view.chooseOption("Security");
      await browser.waitUntil(async () => (await view.snapshot()).text !== u3.text, { timeout: 15_000, timeoutMsg: "the findings did not reload for the Security filter" });
    });
    await expectNoNewChatRequest();
  });

  test(copilotTestTitle("A16 keyboard", "U1: Tab to a top turn and Enter opens it; U2: Enter on a session drills in and Back returns focus to it"), async () => {
    await views.inside(VIEW.u1, async (view) => {
      const turn = (await view.snapshot()).buttons.find((name) => /^Turn \d+$/.test(name))!;
      await view.tabTo(turn);
      await view.pressEnter();
      await browser.waitUntil(async () => (await view.snapshot()).buttons.includes("Hide turn"), { timeout: 15_000, timeoutMsg: "Enter did not open the turn" });
      await view.click("Hide turn");
    });
    await views.inside(VIEW.u2, async (view: ChatView) => {
      const before = await view.snapshot();
      const session = before.buttons.find((name) => /^Placeholder portal-web session/.test(name))!;
      await view.tabTo(session);
      await view.pressEnter();
      await view.waitForTitle(session);
      await view.tabTo("Back to cost rollup");
      await view.pressEnter();
      await view.waitForTitle(before.title);
      await browser.waitUntil(async () => (await view.focusedControl()) === session, { timeout: 10_000, timeoutMsg: "focus did not return to the session row" });
    });
    await expectNoNewChatRequest();
    // The analyzer agrees: the chat is still one model turn.
    expect((await analyzer!.session(chatSessionId!)).turnCount).toBe(1);
  });
});
