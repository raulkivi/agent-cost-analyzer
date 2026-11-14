// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { boardComparison, boardReplay, entry, lost, mea } from "../../src/views/replay/fixtures.js";
import { messagesOffTemplate, modelTurnsIn, toolCallsIn } from "../support/call-log.js";
import { APP_VERSION, expect, inEachClaudeSet, test } from "../support/host-fixture.js";
import type { McpHost } from "../support/mcp-host.js";

// A27, U12 (docs/plans/mcp-apps.md §4.5, §8.3, board Replay.dc.html and
// Increment3States.dc.html boards 8-10; the owner's answers are §9.2 Q1-Q5),
// in Claude Desktop, light and dark. Two kinds of spec:
//   - "real server": the fixture home's two-turn Claude Code session of
//     2026-10-05 on Claude Sonnet 5.5, replayed by the real compare_models_for_session
//     and replay_session, so the tool's own answers drive the built view;
//   - "board state": the figures of the board (a failed self-check, a floor,
//     an unpriced model, turns not replayed), which the fixture home's session
//     can't produce, answered by the fake host in place of the server.

const PROVIDER = "claude-code";
const OWN = "claude-sonnet-5.5";
const MODELS = ["gpt-6.1-sol", "claude-opus-5.5"];

// The session's id is the provider's (a log file name is not it): find the 2026-10-05 portal-web session by its start.
async function realSession(host: McpHost): Promise<{ sessionId: string; provider: string }> {
  const { sessions } = (await host.lookup("list_sessions", { provider: PROVIDER })) as { sessions: { id: string; startedAt?: string; turnCount: number }[] };
  const found = sessions.find((session) => session.startedAt === "2026-10-05T09:00:00.000Z");
  expect(found, "the fixture home's 2026-10-05 session").toBeDefined();
  expect(found!.turnCount).toBe(2);
  return { sessionId: found!.id, provider: PROVIDER };
}

// The board's session and provider, as boardComparison() and boardReplay() name them.
const BOARD = { sessionId: "7f3a9c2e", provider: "copilot" };

// Unknown on a model no price lists: every turn replayed, none priced (board 8).
function unpricedReplay() {
  const unknown = { cacheRead: 1, cacheWrite: 1, outcome: "hit" as const, cost: { known: false as const, reason: "no price" } };
  return boardReplay({
    model: "local-llama-4",
    vendorId: "local",
    pricing: { channel: null, reason: "no price for local-llama-4 on the Copilot channel", asOf: "2026-10-14", requested: "session-channel" },
    turns: [
      { turnIndex: 0, measured: mea(2.09), simulated: unknown },
      { turnIndex: 1, measured: mea(2.3), simulated: unknown },
      { turnIndex: 2, measured: lost, simulated: unknown },
    ],
    totals: { measured: { value: 4.39, knownTurns: 2, turns: 3 }, simulated: { value: null, knownTurns: 0, turns: 3 }, difference: null },
    coverage: { turns: 3, replayedTurns: 3, requests: 3, replayedRequests: 3, notReplayed: [] },
    selfCheck: { model: OWN, models: [OWN], requests: 44, matching: 44, readTolerancePercent: 5, passed: true },
  });
}

inEachClaudeSet(() => {
  test("A27 U12 compare (real server): title, Simulated tag, own-model check, measured row first, then the models in the tool's order; axe clean", async ({ host }) => {
    const session = await realSession(host);
    const view = await host.show("compare_models_for_session", { ...session, models: MODELS });
    const u12 = view.replay;

    await expect(view.title()).toContainText("Replay on other models");
    await expect(u12.titleTag()).toBeVisible();
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Replay on other models");
    await expect(view.content.getByText(`Session ${session.sessionId} · 2 turns · measured on ${OWN}`)).toBeVisible();
    // §9.2 Q1: the own-model check, from the entry flagged isMeasuredModel; a pass is a quiet note, not an alert.
    await expect(u12.checkBox()).toContainText("Own-model check:");
    await expect(u12.checkBox()).toContainText(`replayed on its own model, ${OWN}, the session comes to`);
    await expect(view.alert()).toHaveCount(0);
    // §9.2 Q4: the measured row first, then the session's own model, then the rest in the order asked.
    expect(await u12.rowOrder()).toEqual(["measured", OWN, "gpt-6.1-sol", "claude-opus-5.5"]);
    await expect(u12.measuredRow()).toContainText("known for 2 of 2 turns");
    await expect(u12.row(OWN)).toContainText("session's own model");
    await expect(view.footer()).toHaveText(`Read-only · local logs · v${APP_VERSION}`);

    expect(await view.axeViolations()).toEqual([]);
    expect(toolCallsIn(host.calls)).toEqual([]);
  });

  test("A27 U12 click a model (real server): replay_session in place, Back and focus return, no model turn", async ({ host }) => {
    const session = await realSession(host);
    const view = await host.show("compare_models_for_session", { ...session, models: MODELS });
    const u12 = view.replay;

    await u12.modelButton("gpt-6.1-sol").click();
    await expect(view.backButton("Back to model comparison")).toBeVisible();
    await expect(view.title()).toContainText("Replay on gpt-6.1-sol");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Replay on other models › Session replay");
    await expect(view.trail()).toHaveText("Replay comparison / gpt-6.1-sol");
    await expect(u12.titleTag()).toBeVisible();
    // The real tool's answer: tiles, the chart with both series, a passed self-check (no alert), the assumptions.
    await expect(u12.tile("Difference")).toBeVisible();
    await expect(u12.tile(/^Simulated on gpt-6.1-sol/)).toContainText("would have cost about");
    await expect(u12.chart()).toBeVisible();
    await expect(u12.marks("measured")).toHaveCount(2);
    await expect(u12.marks("simulated")).toHaveCount(2);
    await expect(u12.checkBox()).toContainText("Self-check passed");
    await expect(view.alert()).toHaveCount(0);
    await expect(u12.assumptions()).toBeVisible();
    expect(await view.focusedControl()).toBe("Back to model comparison");
    expect(await view.axeViolations()).toEqual([]);

    await view.back("Back to model comparison");
    await expect(view.title()).toContainText("Replay on other models");
    expect(await view.focusedControl()).toBe("gpt-6.1-sol");

    // One plain tools/call with the ids, never a message to the model; Back fetched nothing.
    expect(toolCallsIn(host.calls)).toEqual([{ name: "replay_session", arguments: { sessionId: session.sessionId, model: "gpt-6.1-sol", provider: PROVIDER } }]);
    expect(modelTurnsIn(host.calls)).toEqual([]);
    expect(messagesOffTemplate(host.calls)).toEqual([]);
  });

  test("A27 U12 replay (real server): replay_session opened directly has no Back, the Session replay kicker and the Simulated tag", async ({ host }) => {
    const view = await host.show("replay_session", { ...(await realSession(host)), model: "claude-opus-5.5" });
    const u12 = view.replay;

    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Session replay");
    await expect(view.title()).toContainText("Replay on claude-opus-5.5");
    await expect(u12.titleTag()).toBeVisible();
    await expect(view.content.getByRole("button", { name: /^Back/ })).toHaveCount(0);
    await expect(u12.chart()).toBeVisible();
    expect(await view.axeViolations()).toEqual([]);
  });

  test("§9.2 Q3 U12 compare: a partly replayed model is a floor, 'known for 40 of 42 turns', 'partial', no percent; a fully replayed one has its percent with a sign", async ({ host }) => {
    const view = await host.showResult("compare_models_for_session", boardComparison(), { args: BOARD });
    const u12 = view.replay;

    const floor = u12.row("gpt-6.1-sol");
    await expect(floor).toContainText("≥ 132.75 AI Credits");
    await expect(floor).toContainText("known for 40 of 42 turns");
    await expect(floor).toContainText("partial");
    await expect(floor).not.toContainText("%");
    await expect(u12.bar("gpt-6.1-sol")).toHaveAttribute("data-floor", "");
    await expect(u12.row("claude-haiku-5.5")).toContainText("−79.5 %");
    await expect(u12.row("claude-opus-5.5")).toContainText("+67.8 %");
    await expect(u12.bar("claude-haiku-5.5")).not.toHaveAttribute("data-floor", "");
    // Every simulated figure says Simulated (to a screen reader too); the measured one does not.
    await expect(u12.row("claude-haiku-5.5")).toContainText("Simulated");
    await expect(u12.measuredRow()).not.toContainText("Simulated");
    await expect(u12.checkBox()).toContainText("(−1.3 %)");
    expect(await view.axeViolations()).toEqual([]);
  });

  test("§9.2 Q4 U12 compare: the tool's order, not sorted by cost; a model with no price is Unknown with no bar and no 0", async ({ host }) => {
    const view = await host.showResult("compare_models_for_session", boardComparison(), { args: BOARD });
    const u12 = view.replay;

    expect(await u12.rowOrder()).toEqual(["measured", "claude-sonnet-5.5", "claude-haiku-5.5", "gpt-6.1-sol", "local-llama-4", "claude-opus-5.5"]);
    const unknown = u12.row("local-llama-4");
    await expect(unknown).toContainText("Unknown");
    await expect(unknown).toContainText("replayed 42 of 42 turns, none priced");
    await expect(u12.bar("local-llama-4")).toHaveCount(0);
    await expect(unknown).not.toContainText(/\b0(\.00)?\b/);
    // The measured bar is solid and a simulated one hatched, told apart without colour (Q5).
    await expect(u12.bar("measured")).toHaveClass(/rp-bar--measured/);
    await expect(u12.bar("claude-haiku-5.5")).toHaveClass(/rp-bar--simulated/);
  });

  test("§9.2 Q1 U12 compare: no own-model check is called out as an alert, never hidden", async ({ host }) => {
    const board = boardComparison();
    const view = await host.showResult("compare_models_for_session", boardComparison({ entries: board.entries.filter((model) => !model.isMeasuredModel) }), { args: BOARD });

    await expect(view.alert()).toContainText("No own-model check");
    expect(await view.axeViolations()).toEqual([]);
  });

  test("§9.2 Q2 U12 replay: a failed self-check is a danger alert with the counts, and the simulated figures stay, tagged Simulated", async ({ host }) => {
    const view = await host.showResult("replay_session", boardReplay(), { args: { ...BOARD, model: "gpt-6.1-sol" } });
    const u12 = view.replay;

    await expect(view.alert()).toContainText("Self-check failed.");
    await expect(view.alert()).toContainText("matched 37 of 44 requests within 5 % cache read");
    await expect(view.alert()).toContainText("Treat them as rough, not as a quote.");
    // The box is the host's danger colour: not the neutral surface of a passed check.
    expect(await view.alert().evaluate((box) => getComputedStyle(box).borderTopColor)).not.toBe(await u12.tile("Difference").evaluate((tile) => getComputedStyle(tile).borderTopColor));
    await expect(u12.tile(/^Simulated on gpt-6.1-sol/)).toContainText("8.32 AI Credits");
    await expect(u12.tile(/^Simulated on gpt-6.1-sol/).getByText("Simulated", { exact: true })).toBeVisible();
    await expect(u12.titleTag()).toBeVisible();
    expect(await view.axeViolations()).toEqual([]);
  });

  test("§9.2 Q3 U12 replay: the difference tile gives the percent and says the turns not replayed are in neither total; the reasons are listed, Unknown not 0", async ({ host }) => {
    const view = await host.showResult("replay_session", boardReplay(), { args: { ...BOARD, model: "gpt-6.1-sol" } });
    const u12 = view.replay;

    await expect(u12.tile("Difference")).toContainText("−3.78 AI Credits");
    await expect(u12.tile("Difference")).toContainText("−31.2 %");
    await expect(u12.tile("Difference")).toContainText("2 turns not replayed (7.61 AI Credits measured) are in neither total");
    await expect(u12.tile("Measured · billed")).toContainText("12.10 AI Credits");
    await expect(u12.notReplayed()).toContainText("2 turns: no request trace for the turn (turns 2 and 3)");
    await expect(u12.notReplayed()).toContainText("Their simulated cost is Unknown, not 0.");
    await expect(u12.assumptions()).not.toHaveAttribute("open", "");
  });

  test("§9.2 Q5 U12 replay chart: measured solid with filled dots, simulated dashed with open diamonds, both labelled in the chart, a hatched gap for the turns not replayed", async ({ host }) => {
    const view = await host.showResult("replay_session", boardReplay(), { args: { ...BOARD, model: "gpt-6.1-sol" } });
    const u12 = view.replay;

    expect(await u12.lineDash("measured")).toBeNull();
    expect(await u12.lineDash("simulated")).not.toBeNull();
    await expect(u12.marks("measured")).toHaveCount(5);
    await expect(u12.marks("simulated")).toHaveCount(4);
    // Open diamonds: filled with the page's ground, not the series colour; the dots are filled with the series colour.
    const fill = (series: "measured" | "simulated") => u12.marks(series).first().evaluate((mark) => getComputedStyle(mark).fill);
    expect(await fill("simulated")).not.toBe(await fill("measured"));
    await expect(u12.chartLabels().filter({ hasText: /^Measured$/ })).toHaveCount(1);
    await expect(u12.chartLabels().filter({ hasText: /^Simulated$/ })).toHaveCount(1);
    await expect(u12.gaps()).toHaveCount(1);
    await expect(u12.gaps().locator("title")).toHaveText("Turns 2 and 3: not replayed, no request trace for the turn");
    expect(await view.axeViolations()).toEqual([]);
  });

  test("§9.2 Q5 U12 replay: View as table lists every turn, with Unknown and the reason for the turns not replayed", async ({ host }) => {
    const view = await host.showResult("replay_session", boardReplay(), { args: { ...BOARD, model: "gpt-6.1-sol" } });
    const u12 = view.replay;

    await u12.tableToggle().click();
    await expect(u12.table().getByRole("row")).toHaveCount(7);
    await expect(u12.table().getByRole("row").nth(3)).toContainText("Unknown");
    await expect(u12.table().getByRole("row").nth(3)).toContainText("not replayed: no request trace for the turn");
    await u12.assumptions().locator("summary").click();
    await expect(u12.assumptions()).toContainText("Same conversation");
    expect(await view.axeViolations()).toEqual([]);
  });

  test("Increment3States board 8 U12 Unknown, not 0: no price means Unknown totals, an Unknown difference and no chart", async ({ host }) => {
    const view = await host.showResult("replay_session", unpricedReplay(), { args: { ...BOARD, model: "local-llama-4" } });
    const u12 = view.replay;

    await expect(u12.tile(/^Simulated on local-llama-4/)).toContainText("Unknown");
    await expect(u12.tile("Difference")).toContainText("Unknown");
    await expect(u12.tile("Difference")).not.toContainText(/\b0\b/);
    await expect(view.content.getByText("No simulated cost.")).toBeVisible();
    await expect(u12.chart()).toHaveCount(0);
    await expect(view.alert()).toHaveCount(0);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A27 U12 click a model (board state): replay_session through the host with the ids; a failed self-check shows in place; Back and focus return", async ({ host }) => {
    const view = await host.showResult("compare_models_for_session", boardComparison(), { args: BOARD, answers: { replay_session: boardReplay() } });
    const u12 = view.replay;

    await u12.modelButton("gpt-6.1-sol").click();
    await expect(view.alert()).toContainText("Self-check failed.");
    await expect(view.trail()).toHaveText("Replay comparison / gpt-6.1-sol");
    expect(await view.focusedControl()).toBe("Back to model comparison");
    expect(toolCallsIn(host.calls)).toEqual([{ name: "replay_session", arguments: { sessionId: BOARD.sessionId, model: "gpt-6.1-sol", provider: BOARD.provider } }]);
    await view.back("Back to model comparison");
    expect(await view.focusedControl()).toBe("gpt-6.1-sol");
    expect(toolCallsIn(host.calls)).toHaveLength(1);
    expect(modelTurnsIn(host.calls)).toEqual([]);
  });

  test("Increment3States board 9 U12 compare at 360 px: rows stack, no sideways scroll", async ({ host }) => {
    const view = await host.showResult("compare_models_for_session", boardComparison({ entries: [entry("claude-sonnet-5.5", 183.9, 42, { own: true }), entry("gpt-6.1-sol", 132.75, 40, { vendorId: "openai" }), entry("local-llama-4", null, 0, { vendorId: "local", replayedTurns: 42 })] }), { args: BOARD, width: 360 });
    const u12 = view.replay;

    expect(await view.width()).toBeLessThanOrEqual(360);
    await expect(u12.row("gpt-6.1-sol")).toContainText("≥ 132.75 AI Credits");
    expect(await view.scrollsSideways()).toBe(false);
    // Stacked: the bar sits under the name, not beside it.
    const box = async (selector: string) => u12.row("gpt-6.1-sol").locator(selector).boundingBox();
    const name = await box(".rp-name");
    const track = await box(".rp-track");
    expect(track!.y).toBeGreaterThan(name!.y + name!.height - 1);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("Increment3States board 10 U12 replay at 360 px: tiles stack, the chart and the table fit, no sideways scroll", async ({ host }) => {
    const view = await host.showResult("replay_session", boardReplay(), { args: { ...BOARD, model: "gpt-6.1-sol" }, width: 360 });
    const u12 = view.replay;

    expect(await view.width()).toBeLessThanOrEqual(360);
    await expect(u12.chart()).toBeVisible();
    expect(await view.scrollsSideways()).toBe(false);
    await u12.tableToggle().click();
    expect(await view.scrollsSideways()).toBe(false);
    expect(await view.axeViolations()).toEqual([]);
  });
});
