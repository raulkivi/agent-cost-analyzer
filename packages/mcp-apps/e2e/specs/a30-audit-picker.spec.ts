// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { messagesOffTemplate, modelTurnsIn, toolCallsIn } from "../support/call-log.js";
import type { McpHost } from "../support/mcp-host.js";
import { APP_VERSION, expect, inEachClaudeSet, test, VSCODE_SETS } from "../support/host-fixture.js";

// A30 (docs/plans/mcp-apps.md §4.5, §8.3; owner answers Q6 to Q10 in §9.2):
// U4 (tool-call audit) and U5 (session picker) in Claude Desktop, light and
// dark. The fixture's Claude Code sessions record no tool calls, so U4 shows
// 0 calls with a failure rate that reads Unknown, never 0 %. The per-day chart
// and the categories need failed calls, which the fixture has none of; the view
// model and component tests cover them. U5 lists the October sessions
// and sends exactly one fixed message.

const CLAUDE_CODE = { provider: "claude-code" };
const OCTOBER = { since: "2026-10-01", until: "2026-10-31" };
// The fixture's Claude Code session ids are 16 hex digits: "Analyse session <id>" and nothing else.
const FIXTURE_ID_MESSAGE = /^Analyse session [0-9a-f]{16}$/;
const FIXTURE_ID_FALLBACK = /^Ask in the chat: Analyse session [0-9a-f]{16}$/;

// The fixture's Claude Code session ids are hashes that change with each fixture home, so the model finds one first.
async function portalWebSession(host: McpHost): Promise<{ sessionId: string; provider: string }> {
  const list = await host.callAsModel("list_sessions", { ...CLAUDE_CODE, ...OCTOBER });
  const sessions = (list.structuredContent as { sessions: { id: string; title: string }[] }).sessions;
  return { sessionId: sessions.find((session) => session.title === "portal-web")!.id, provider: "claude-code" };
}

inEachClaudeSet(() => {
  test("A30 U5 list: rows with title, short id, turns and model, no cost, Analyse on every row, the hint; axe clean", async ({ host }) => {
    const view = await host.show("list_sessions", { ...CLAUDE_CODE, ...OCTOBER });

    await expect(view.title()).toHaveText("Sessions");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Sessions");
    const rows = view.picker.rows();
    expect(await rows.count()).toBeGreaterThanOrEqual(3);
    const count = await rows.count();
    await expect(view.picker.buttons()).toHaveCount(count);
    await expect(rows.first()).toContainText(/\d+ turns?/);
    // list_sessions returns no cost, so a row shows none (Q8).
    for (const text of await rows.allTextContents()) expect(text).not.toMatch(/credit|\$|cost/i);
    await expect(view.picker.hint()).toHaveText("A click sends only Analyse session <id> to the chat. Titles and other session text are never sent.");
    await expect(view.footer()).toHaveText(`Read-only · local logs · v${APP_VERSION}`);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A30 U5 Analyse: exactly one message, the fixed template with the row's id, no title; the button turns into a disabled Sent; nothing else is sent; axe clean", async ({ host }) => {
    const view = await host.show("list_sessions", { ...CLAUDE_CODE, ...OCTOBER });
    const first = view.picker.rows().first();
    const title = (await first.locator(".sp-title").textContent()) ?? "";
    const shortId = ((await first.locator(".sp-id").textContent()) ?? "").trim();
    expect(title).not.toBe("");

    await view.picker.analyseButton(shortId).click();
    await expect.poll(() => modelTurnsIn(host.calls)).toHaveLength(1);

    const messages = host.calls.flatMap((call) => (call.method === "ui/message" ? call.texts : []));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(FIXTURE_ID_MESSAGE);
    expect(messages[0]!.startsWith(`Analyse session ${shortId}`)).toBe(true);
    expect(messages[0]!.endsWith(title) || messages[0]!.includes(title)).toBe(false);
    expect(messagesOffTemplate(host.calls)).toEqual([]);
    // The click is the only thing the view asked the host for.
    expect(host.calls).toHaveLength(1);
    expect(toolCallsIn(host.calls)).toEqual([]);

    await expect(view.picker.sentButton(shortId)).toBeDisabled();
    await expect(view.picker.sentButton(shortId)).toHaveText("Sent");
    // The other rows still offer Analyse, and pressing Sent again sends nothing.
    await expect(view.picker.buttons().filter({ hasText: "Analyse" })).toHaveCount((await view.picker.rows().count()) - 1);
    await view.picker.sentButton(shortId).click({ force: true });
    expect(modelTurnsIn(host.calls)).toHaveLength(1);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A30 U5 by keyboard: Tab reaches Analyse, Enter sends once", async ({ host }) => {
    const view = await host.show("list_sessions", { ...CLAUDE_CODE, ...OCTOBER });
    const shortId = ((await view.picker.rows().first().locator(".sp-id").textContent()) ?? "").trim();
    await view.tabTo(`Analyse session ${shortId}`);
    await expect.poll(() => view.focusRingVisible()).toBe(true);
    await view.pressEnter();
    await expect.poll(() => modelTurnsIn(host.calls)).toHaveLength(1);
    expect(messagesOffTemplate(host.calls)).toEqual([]);
  });

  test("A30 U5 the host declines (owner, 2026-11-11: try, then fall back): that row reads the text to type and loses its button, the others still offer Analyse; axe clean", async ({ host }) => {
    host.declineMessages = true;
    const view = await host.show("list_sessions", { ...CLAUDE_CODE, ...OCTOBER });
    const count = await view.picker.rows().count();
    const shortId = ((await view.picker.rows().first().locator(".sp-id").textContent()) ?? "").trim();

    await view.picker.analyseButton(shortId).click();

    await expect(view.picker.askInChat(shortId)).toHaveText(FIXTURE_ID_FALLBACK);
    await expect(view.picker.rowButtons(shortId)).toHaveCount(0);
    await expect(view.picker.buttons().filter({ hasText: "Analyse" })).toHaveCount(count - 1);
    // One attempt, the fixed template, nothing else.
    expect(modelTurnsIn(host.calls)).toHaveLength(1);
    expect(messagesOffTemplate(host.calls)).toEqual([]);
    expect(toolCallsIn(host.calls)).toEqual([]);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A30 U5 at 360 px after the host declines: the text to type wraps in the row, nothing scrolls sideways", async ({ host }) => {
    host.declineMessages = true;
    const view = await host.show("list_sessions", { ...CLAUDE_CODE, ...OCTOBER }, { width: 360 });
    const shortId = ((await view.picker.rows().first().locator(".sp-id").textContent()) ?? "").trim();

    await view.picker.analyseButton(shortId).click();

    await expect(view.picker.askInChat(shortId)).toHaveText(FIXTURE_ID_FALLBACK);
    expect(await view.scrollsSideways()).toBe(false);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A30 U5 no match: says what to try and offers no button", async ({ host }) => {
    const view = await host.show("list_sessions", { ...CLAUDE_CODE, query: "no-session-has-this-text" });

    await expect(view.picker.noMatch()).toBeVisible();
    await expect(view.content.getByText("Try a shorter search, a wider date range or another repository.")).toBeVisible();
    await expect(view.picker.buttons()).toHaveCount(0);
    expect(await view.axeViolations()).toEqual([]);
    expect(host.calls).toEqual([]);
  });

  test("A30 U5 at 360 px: rows and Analyse fit, nothing scrolls sideways", async ({ host }) => {
    const view = await host.show("list_sessions", { ...CLAUDE_CODE, ...OCTOBER }, { width: 360 });

    await expect(view.picker.rows().first()).toBeVisible();
    expect(await view.width()).toBeLessThanOrEqual(360);
    expect(await view.scrollsSideways()).toBe(false);
    await expect(view.picker.buttons().first()).toBeVisible();
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A30 U4 session: tiles with Unknown (never 0 %) for a session with no tool calls, the sections, no host call; axe clean", async ({ host }) => {
    const view = await host.show("get_session_audit", await portalWebSession(host));

    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Tool-call audit");
    await expect(view.title()).toBeVisible();
    const u4 = view.audit;
    for (const tile of ["Tool calls", "Failed", "Failure rate", "Outcome unknown"]) await expect(u4.tile(tile)).toBeVisible();
    // No call has a recorded outcome: the rate is Unknown, not 0 %.
    await expect(u4.tile("Failure rate")).toContainText("Unknown");
    await expect(u4.tile("Failure rate")).not.toContainText("0 %");
    await expect(u4.tile("Failed")).toContainText("Unknown");
    await expect(u4.recovery()).toBeVisible();
    await expect(u4.recovery()).toContainText("tokens, not AI Credits");
    await expect(view.footer()).toHaveText(`Read-only · local logs · v${APP_VERSION}`);
    expect(await view.axeViolations()).toEqual([]);
    expect(host.calls).toEqual([]);
  });

  test("A30 U4 rollup: tiles, no chart without days, the sessions table (display only); axe clean", async ({ host }) => {
    const view = await host.show("get_audit_rollup", { ...CLAUDE_CODE, ...OCTOBER });

    await expect(view.title()).toHaveText("Tool-call failures");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Tool-call audit");
    const u4 = view.audit;
    for (const tile of ["Tool calls", "Failed", "Failure rate"]) await expect(u4.tile(tile)).toBeVisible();
    await expect(u4.tile("Failure rate")).toContainText("Unknown");
    await expect(u4.tile("Failure rate")).not.toContainText("0 %");
    // No day has a call, so there is no chart to draw (and no zero column).
    await expect(u4.failedPerDay()).toHaveCount(0);
    await expect(u4.table("Most failures by session")).toContainText("portal-web");
    // Nothing to press, and nothing sent: the sessions table has no drill-down (Q10).
    await expect(view.content.getByRole("button")).toHaveCount(0);
    expect(await view.axeViolations()).toEqual([]);
    expect(host.calls).toEqual([]);
  });

  test("A30 U4 at 360 px: both modes fit, nothing scrolls sideways", async ({ host }) => {
    const session = await host.show("get_session_audit", await portalWebSession(host), { width: 360 });
    await expect(session.audit.tile("Failure rate")).toBeVisible();
    expect(await session.width()).toBeLessThanOrEqual(360);
    expect(await session.scrollsSideways()).toBe(false);

    const rollup = await host.show("get_audit_rollup", { ...CLAUDE_CODE, ...OCTOBER }, { width: 360 });
    await expect(rollup.audit.tile("Failure rate")).toBeVisible();
    expect(await rollup.scrollsSideways()).toBe(false);
    expect(await rollup.axeViolations()).toEqual([]);
  });
});

// Owner, 2026-11-11 (§9.2 Q7): try, then fall back. VS Code's recorded host
// capabilities list no `message`, yet U2's message was sent there in A16, so
// U5 offers Analyse. G4 (A33) confirms it in real Copilot Chat.
test.describe("in VS Code", () => {
  test.use({ hostKind: "vscode", hostSet: VSCODE_SETS[1] });

  test("A30 U5 in a host that advertises no `message` capability: Analyse on every row, the click sends the fixed template, then Sent; axe clean", async ({ host }) => {
    const view = await host.show("list_sessions", { ...CLAUDE_CODE, ...OCTOBER });
    const count = await view.picker.rows().count();
    await expect(view.picker.buttons()).toHaveCount(count);
    await expect(view.picker.hint()).toHaveText("A click sends only Analyse session <id> to the chat. Titles and other session text are never sent.");
    const shortId = ((await view.picker.rows().first().locator(".sp-id").textContent()) ?? "").trim();

    await view.picker.analyseButton(shortId).click();

    await expect(view.picker.sentButton(shortId)).toBeDisabled();
    expect(modelTurnsIn(host.calls)).toHaveLength(1);
    expect(host.calls.flatMap((call) => (call.method === "ui/message" ? call.texts : []))).toEqual([expect.stringMatching(FIXTURE_ID_MESSAGE)]);
    expect(messagesOffTemplate(host.calls)).toEqual([]);
    expect(await view.axeViolations()).toEqual([]);
  });
});
