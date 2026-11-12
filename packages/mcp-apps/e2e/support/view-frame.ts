// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Frame, FrameLocator, Locator, Page } from "@playwright/test";
import { axeViolations } from "../../../web/e2e/support/axe.js";

// Page objects for one view in the fake host's iframe (step 10.17 G5), so
// specs read as the checklists do and hold no selectors. ViewFrame is the
// branded shell every view shares (kicker, title, Back, footer, focus, axe,
// layout); the view objects below add what U1, U2, U3, U9, U10 and U11
// show. A drill-down swaps the view inside the same frame, so each view
// object is a lens on the same frame, not a frame of its own.

const VIEW_FRAME = 'iframe[title="MCP App view"]';

export type Hue = "red" | "green" | "blue" | "other";

export class ViewFrame {
  readonly content: FrameLocator;

  constructor(
    private readonly page: Page,
    private readonly index: number,
  ) {
    this.content = page.locator(VIEW_FRAME).nth(index).contentFrame();
  }

  get costOverTime(): CostOverTimeView {
    return new CostOverTimeView(this.content);
  }

  get comparison(): CostComparisonView {
    return new CostComparisonView(this.content);
  }

  get costChange(): CostChangeView {
    return new CostChangeView(this.content);
  }

  get priceChanges(): PriceChangesView {
    return new PriceChangesView(this.content);
  }

  get statement(): StatementView {
    return new StatementView(this.content);
  }

  get estimate(): EstimateView {
    return new EstimateView(this.content);
  }

  get replay(): ReplayView {
    return new ReplayView(this.content);
  }

  get sessionCost(): SessionCostView {
    return new SessionCostView(this.content);
  }

  get rollup(): CostRollupView {
    return new CostRollupView(this.content);
  }

  get findings(): FindingsView {
    return new FindingsView(this.content);
  }

  get audit(): AuditView {
    return new AuditView(this.content);
  }

  get picker(): SessionPickerView {
    return new SessionPickerView(this.content);
  }

  title(): Locator {
    return this.content.getByRole("heading", { level: 1 });
  }

  // "<product> · <view> › <view>": the product name and the drill-down path.
  kicker(): Locator {
    return this.content.locator(".view-kicker .card-kicker");
  }

  // "Cost comparison / Customer portal": beside Back after a drill-down.
  trail(): Locator {
    return this.content.locator(".rv-trail");
  }

  backButton(name: string): Locator {
    return this.content.getByRole("button", { name, exact: true });
  }

  async back(name: string): Promise<void> {
    await this.backButton(name).click();
  }

  footer(): Locator {
    return this.content.locator(".view-footer-note");
  }

  // An error or empty state the view shows instead of a chart.
  alert(): Locator {
    return this.content.getByRole("alert");
  }

  // The accessible name of the focused control, to check focus returns to the row a drill-down left.
  async focusedControl(): Promise<string> {
    return (await this.frame()).evaluate(() => {
      const active = document.activeElement;
      return active?.getAttribute("aria-label") ?? active?.textContent?.trim() ?? "";
    });
  }

  // Whether the focused control draws a ring (an outline or a shadow).
  async focusRingVisible(): Promise<boolean> {
    return (await this.frame()).evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return false;
      const style = getComputedStyle(active);
      return (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none";
    });
  }

  // Tab through the view, as a keyboard user does, until the control named `name` has focus.
  async tabTo(name: string, limit = 80): Promise<void> {
    for (let presses = 0; presses < limit; presses++) {
      await this.page.keyboard.press("Tab");
      if ((await this.focusedControl()) === name && (await this.focusSettled(name))) return;
    }
    throw new Error(`Tab did not reach "${name}" in ${limit} presses`);
  }

  // Focus can land on a control a view is about to replace (a loading shell giving way to its
  // result), and a key pressed then goes to the detached node. Two frames later the swap has
  // committed; the control must still hold focus.
  private async focusSettled(name: string): Promise<boolean> {
    await (await this.frame()).evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    return (await this.focusedControl()) === name;
  }

  async pressEnter(): Promise<void> {
    await this.page.keyboard.press("Enter");
  }

  // True when the view is wider than its frame, so the user would scroll sideways.
  async scrollsSideways(): Promise<boolean> {
    return (await this.frame()).evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  }

  // The frame's own width in CSS pixels, to prove a narrow spec really was narrow.
  async width(): Promise<number> {
    return (await this.frame()).evaluate(() => document.documentElement.clientWidth);
  }

  // The view's card width in CSS pixels: capped inline, wider in fullscreen (A31).
  async shellWidth(): Promise<number> {
    return (await this.frame()).evaluate(() => document.querySelector("main.view-shell")?.getBoundingClientRect().width ?? 0);
  }

  // WCAG 2.2 A/AA in the view's own document. The view's card is
  // transparent and the host paints its ground behind the iframe, which axe
  // inside the frame cannot see, so the host's ground variable is painted
  // on the view's root first (a stand-in for the host's compositing).
  async axeViolations(): Promise<string[]> {
    const frame = await this.frame();
    await frame.evaluate(() => {
      document.documentElement.style.backgroundColor = "var(--color-background-primary, Canvas)";
    });
    return axeViolations(frame);
  }

  private async frame(): Promise<Frame> {
    const frame = await (await this.page.locator(VIEW_FRAME).nth(this.index).elementHandle())?.contentFrame();
    if (!frame) throw new Error(`View ${this.index + 1} has no frame`);
    return frame;
  }
}

// U9: a repository's or a project's cost over time.
export class CostOverTimeView {
  constructor(private readonly content: FrameLocator) {}

  basisTile(name: "Total · preferred basis" | "Billed" | "Reported" | "Priced"): Locator {
    return this.content.getByRole("group", { name, exact: true });
  }

  chart(): Locator {
    return this.content.getByRole("img", { name: /^Cost per (day|week|month)/ });
  }

  // "AI Credits" or "USD": the unit the chart is drawn in.
  chartUnit(): Locator {
    return this.content.getByRole("region", { name: /^Cost per (day|week|month)/ }).getByText(/^preferred basis · /);
  }

  currencyControl(): Locator {
    return this.content.getByRole("group", { name: "Currency", exact: true });
  }

  // The control's options in the order shown.
  async currencyOptions(): Promise<string[]> {
    return this.currencyControl().getByRole("radio").evaluateAll((radios) => radios.map((radio) => (radio as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? ""));
  }

  async selectedCurrency(): Promise<string> {
    return this.currencyControl().getByRole("radio", { checked: true }).evaluate((radio) => (radio as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? "");
  }

  async chooseCurrency(name: "AI Credits" | "USD"): Promise<void> {
    await this.currencyControl().getByText(name, { exact: true }).click();
  }

  // "Currencies are never added together." under the tiles.
  neverAddedNote(): Locator {
    return this.content.getByText(/Currencies are never added together\./);
  }

  vendorTable(): Locator {
    return this.content.getByRole("table", { name: "Cost by vendor, then model" });
  }

  tokensByType(): Locator {
    return this.content.getByRole("table", { name: "Tokens by type, per model" });
  }

  topSessions(): Locator {
    return this.content.getByRole("table", { name: "Top sessions by cost" });
  }

  async openSession(title: string): Promise<void> {
    await this.topSessions().getByRole("button", { name: title, exact: true }).first().click();
  }

  // The top sessions' titles, most expensive first.
  async sessionTitles(): Promise<string[]> {
    return this.topSessions().getByRole("button").allTextContents();
  }

  // The cost cell of the session row opened by `title`.
  sessionRow(title: string): Locator {
    return this.topSessions().getByRole("row").filter({ has: this.content.getByRole("button", { name: title, exact: true }) }).first();
  }

  priceChangesList(): Locator {
    return this.content.getByRole("list", { name: "Price changes in this range" });
  }
}

// U10: repositories or projects side by side.
export class CostComparisonView {
  constructor(private readonly content: FrameLocator) {}

  table(groupBy: "repository" | "project"): Locator {
    return this.content.getByRole("table", { name: `Cost by ${groupBy}` });
  }

  async openRow(name: string): Promise<void> {
    await this.content.getByRole("button", { name, exact: true }).click();
  }

  row(name: string): Locator {
    return this.content.getByRole("row").filter({ has: this.content.getByRole("button", { name, exact: true }) });
  }

  // The Total cell of a row: the figure per currency, AI Credits first.
  totalCell(name: string): Locator {
    return this.row(name).getByRole("cell").first();
  }

  // The footer row, with one total per currency.
  together(): Locator {
    return this.content.getByRole("row").filter({ has: this.content.getByRole("rowheader", { name: "Together", exact: true }) });
  }

  // The sentence above the table that names the units.
  unitsNote(): Locator {
    return this.content.getByText(/^(All money in |These (projects|repositories) have costs in two currencies|No cost is known)/);
  }
}

// U13: when prices changed. Documented and inferred changes share one list;
// each entry says which it is.
export class PriceChangesView {
  constructor(private readonly content: FrameLocator) {}

  timeline(): Locator {
    return this.content.getByRole("img", { name: /^Price changes on a timeline/ });
  }

  // The marks on the timeline: "documented" or "observed" (drawn dashed, tagged inferred).
  marks(kind: "documented" | "observed"): Locator {
    return this.timeline().locator(`[data-mark="${kind}"]`);
  }

  entries(kind: "documented" | "observed"): Locator {
    return this.content.locator(`.pc-entry[data-kind="${kind}"]`);
  }

  entry(model: string): Locator {
    return this.content.locator(".pc-entry").filter({ has: this.content.getByRole("heading", { level: 3, name: new RegExp(model) }) });
  }

  // The filter sentence U11 adds: "Showing …, the model with the largest price effect … 1 of 2 changes in the range."
  filterNote(): Locator {
    return this.content.locator(".pc-note");
  }

  emptyState(): Locator {
    return this.content.locator(".pc-state");
  }

  // An observed (inferred) entry's billed-against-priced percentage, as written ("+12.0 %").
  observedPercent(model: string): Locator {
    return this.entry(model).locator(".pc-observed b");
  }

  // An observed entry's weekly billed-against-priced table.
  weeklyTable(model: string): Locator {
    return this.content.getByRole("table", { name: `${model} weekly billed against priced`, exact: true });
  }

  // Whether the first timeline mark of a kind has a dashed outline: inferred differs from documented without colour.
  async markDashed(kind: "documented" | "observed"): Promise<boolean> {
    const dash = await this.marks(kind).first().locator("polygon").evaluate((element) => getComputedStyle(element).strokeDasharray);
    return dash !== "" && dash !== "none";
  }

  // The colour family of a percentage written in an entry ("+25.00 %" red, "−20.00 %" green).
  async percentHue(percent: Locator): Promise<Hue> {
    const colour = await percent.evaluate((element) => getComputedStyle(element).color);
    const [red, green, blue] = (colour.match(/[\d.]+/g) ?? []).map(Number);
    if (red === undefined || green === undefined || blue === undefined) return "other";
    if (red > green * 1.3 && red > blue * 1.3) return "red";
    if (green > red * 1.15 && green > blue * 1.15) return "green";
    return "other";
  }
}

// U11: why a cost changed between two periods.
export class CostChangeView {
  constructor(private readonly content: FrameLocator) {}

  // "Change", "Not explained", or a period's tile, named "<period> (A)" / "<period> (B)".
  tile(name: string): Locator {
    return this.content.getByRole("group", { name, exact: true });
  }

  periodTile(period: "A" | "B"): Locator {
    return this.content.getByRole("group", { name: new RegExp(`\\(${period}\\)$`) });
  }

  waterfall(): Locator {
    return this.content.getByRole("img", { name: /usage .*price .*mix /i });
  }

  modelTable(): Locator {
    return this.content.getByRole("table", { name: /^Change by model/ });
  }

  // The control that opens U13 in place, and the sentence beside it naming the models.
  priceChangesButton(): Locator {
    return this.content.getByRole("button", { name: "Price changes", exact: true });
  }

  async openPriceChanges(): Promise<void> {
    await this.priceChangesButton().click();
  }

  // A column of the by-model table, which the narrow layout drops.
  modelColumn(name: string | RegExp): Locator {
    return this.modelTable().first().getByRole("columnheader", { name });
  }

  // One block per currency, each under its own heading ("USD", "AI Credits").
  currencyBlocks(): Locator {
    return this.content.getByRole("region", { name: /^Cost change in / });
  }

  currencyHeadings(): Locator {
    return this.currencyBlocks().getByRole("heading", { level: 2 });
  }

  // The colour family a waterfall effect bar is drawn in ("usage", "price", "mix").
  async effectHue(effect: "usage" | "price" | "mix"): Promise<Hue> {
    const fill = await this.waterfall().first().locator(`[data-step="${effect}"]`).evaluate((bar) => getComputedStyle(bar).fill);
    const [red, green, blue] = (fill.match(/[\d.]+/g) ?? []).map(Number);
    if (red === undefined || green === undefined || blue === undefined) return "other";
    if (red > green * 1.3 && red > blue * 1.3) return "red";
    if (green > red * 1.15 && green > blue * 1.15) return "green";
    if (blue > red * 1.3 && blue > green * 1.15) return "blue";
    return "other";
  }

  // Which way an effect bar points: "increase" raises the cost, "decrease" lowers it.
  async effectDirection(effect: "usage" | "price" | "mix"): Promise<string | null> {
    return this.waterfall().first().locator(`[data-step="${effect}"]`).getAttribute("data-kind");
  }

  // The written sign of an effect ("+$0.011", "−$0.094"), never colour alone.
  effectValue(effect: "usage" | "price" | "mix"): Locator {
    return this.waterfall().first().locator(`[data-value="${effect}"]`);
  }
}

// U12: a session replayed on another model, in compare mode and in replay mode.
export class ReplayView {
  constructor(private readonly content: FrameLocator) {}

  // Compare mode. The rows in the order shown: "measured", then each model's id.
  async rowOrder(): Promise<(string | null)[]> {
    return this.content.getByRole("list", { name: "Simulated total per model" }).getByRole("listitem").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row")));
  }

  row(model: string): Locator {
    return this.content.locator(`li[data-row="${model}"]`);
  }

  measuredRow(): Locator {
    return this.row("measured");
  }

  modelButton(model: string): Locator {
    return this.content.getByRole("button", { name: model, exact: true });
  }

  // The box under the title: "Own-model check:" in compare mode, the self-check in replay mode
  // (a failed or missing one is an alert).
  checkBox(): Locator {
    return this.content.locator(".rp-callout").first();
  }

  // The simulated tag beside the title.
  titleTag(): Locator {
    return this.content.getByRole("heading", { level: 1 }).getByText("Simulated", { exact: true });
  }

  tile(name: string | RegExp): Locator {
    return this.content.getByRole("group", { name });
  }

  chart(): Locator {
    return this.content.getByRole("img", { name: /AI Credits per turn|USD per turn/ });
  }

  // The stroke dash of a series' line ("5 3" for the dashed simulated one), or null for a solid line.
  async lineDash(series: "measured" | "simulated"): Promise<string | null> {
    return this.chart().locator(`[data-series="${series}"] polyline`).first().getAttribute("stroke-dasharray");
  }

  // The marks of a series: filled dots (circles) for measured, open diamonds (paths) for simulated.
  marks(series: "measured" | "simulated"): Locator {
    return this.chart().locator(series === "measured" ? '[data-series="measured"] circle' : '[data-series="simulated"] path');
  }

  // The hatched bands over turns not replayed.
  gaps(): Locator {
    return this.chart().locator("[data-gap]");
  }

  // The words drawn in the chart itself: the direct labels.
  chartLabels(): Locator {
    return this.chart().locator("text");
  }

  tableToggle(): Locator {
    return this.content.getByRole("button", { name: /^(View as table|Hide table)$/ });
  }

  table(): Locator {
    return this.content.getByRole("table", { name: "Per-turn credits, measured and simulated" });
  }

  notReplayed(): Locator {
    return this.content.getByRole("region", { name: "Not replayed" });
  }

  assumptions(): Locator {
    return this.content.locator("details.rp-assumptions");
  }

  // The bar of a compare row, if it has one: an Unknown model has none.
  bar(model: string): Locator {
    return this.row(model).locator("[data-bar]");
  }
}

// U1: one session's cost, opened directly or from U2's or U9's top sessions.
export class SessionCostView {
  constructor(private readonly content: FrameLocator) {}

  tile(name: string): Locator {
    return this.content.getByRole("group", { name, exact: true });
  }

  turnChart(): Locator {
    return this.content.getByRole("img", { name: /per turn/ });
  }

  topTurns(): Locator {
    return this.content.getByRole("table", { name: /^Top turns by/ });
  }

  async openTurn(turnIndex: number): Promise<void> {
    await this.content.getByRole("button", { name: `Turn ${turnIndex}`, exact: true }).click();
  }

  turnToggle(turnIndex: number): Locator {
    return this.content.getByRole("button", { name: `Turn ${turnIndex}`, exact: true });
  }

  // The opened turn's detail, in place under its row.
  turnDetail(turnIndex: number): Locator {
    return this.content.getByRole("row").filter({ hasText: new RegExp(`^Turn ${turnIndex} · `) });
  }

  async hideTurn(): Promise<void> {
    await this.content.getByRole("button", { name: "Hide turn", exact: true }).click();
  }

  // VS Code only: Claude Desktop has no panel to open, so no button.
  copyTitleButton(): Locator {
    return this.content.getByRole("button", { name: /Copy title/ });
  }

  // Sends "Analyse session <id>" to the chat (mcp-apps.md §4.3).
  async askAboutSession(): Promise<void> {
    await this.content.getByRole("button", { name: "Ask about this session", exact: true }).click();
  }
}

// U2: the spend rollup.
export class CostRollupView {
  constructor(private readonly content: FrameLocator) {}

  tile(name: string): Locator {
    return this.content.getByRole("group", { name, exact: true });
  }

  dailyChart(): Locator {
    return this.content.getByRole("img", { name: /^Daily / });
  }

  byModel(): Locator {
    return this.content.getByRole("list", { name: "Spend by model" });
  }

  byProvider(): Locator {
    return this.content.getByRole("list", { name: "Spend by provider" });
  }

  topSessions(): Locator {
    return this.content.getByRole("table", { name: /^Top sessions by/ });
  }

  async openSession(title: string): Promise<void> {
    await this.topSessions().getByRole("button", { name: title, exact: true }).first().click();
  }
}

// U3: findings.
export class FindingsView {
  constructor(private readonly content: FrameLocator) {}

  severityTile(label: "Critical" | "High" | "Medium" | "Low" | "Info"): Locator {
    return this.content.getByRole("group", { name: label, exact: true });
  }

  table(): Locator {
    return this.content.getByRole("table", { name: "Findings", exact: true });
  }

  // The table's body rows (a finding, or its opened evidence).
  rows(): Locator {
    return this.table().getByRole("row").filter({ hasNot: this.content.getByRole("columnheader") });
  }

  summary(): Locator {
    return this.content.getByText(/^\d+ findings?$/);
  }

  async chooseKind(label: "All" | "Security" | "Anomaly" | "Behaviour change" | "Price change"): Promise<void> {
    await this.content.getByRole("group", { name: "Kind", exact: true }).getByText(label, { exact: true }).click();
  }

  async chooseMinSeverity(label: string): Promise<void> {
    await this.content.getByRole("combobox", { name: "Severity" }).selectOption({ label });
  }

  whyFlagged(): Locator {
    return this.content.getByRole("button", { name: "Why flagged" });
  }

  async openEvidence(position = 0): Promise<void> {
    await this.whyFlagged().nth(position).click();
  }
}

// U14: a project's statement for a period (standalone only, read-only).
export class StatementView {
  constructor(private readonly content: FrameLocator) {}

  // "Draft" or "Issued <day>".
  status(): Locator {
    return this.content.locator(".stm-status");
  }

  totalTile(currency: "AI Credits" | "USD"): Locator {
    return this.content.getByRole("group", { name: `Total, ${currency}`, exact: true });
  }

  linesTable(currency: "AI Credits" | "USD"): Locator {
    return this.content.getByRole("table", { name: `Statement lines in ${currency}`, exact: true });
  }

  // The unit of each currency table, in the order shown.
  tableUnits(): Locator {
    return this.content.locator("section[aria-label^=\"Statement lines in\"] h2");
  }

  channelHeader(): Locator {
    return this.content.getByRole("columnheader", { name: "Channel", exact: true });
  }

  unknownGroup(): Locator {
    return this.content.getByRole("region", { name: "No known cost", exact: true });
  }

  // The draft's "Not issued" box.
  draftNote(): Locator {
    return this.content.getByRole("status").filter({ hasText: "Not issued." });
  }

  // Any control: U14 has none (no issue, re-issue or export).
  controls(): Locator {
    return this.content.getByRole("button");
  }

  // The amber box over an issued statement whose re-run differs, or the note that it matches.
  issuedDiffAlert(): Locator {
    return this.content.getByRole("status").filter({ hasText: "A re-run today differs from the issued copy." });
  }

  issuedMatchesNote(): Locator {
    return this.content.getByRole("status").filter({ hasText: "A re-run today matches the issued copy." });
  }

  diffTable(): Locator {
    return this.content.getByRole("table", { name: "Issued against re-run, per line", exact: true });
  }

  // One row of the diff, by its line label ("billed, github-copilot, gpt-5.5") or a total ("Total, USD").
  diffRow(label: string): Locator {
    return this.diffTable().getByRole("row").filter({ hasText: label });
  }

  whatElseChanged(): Locator {
    return this.content.getByRole("list", { name: "What else changed", exact: true });
  }

  // The scrollable table regions: the only things in U14 that take focus.
  scrollRegions(): Locator {
    return this.content.getByRole("region", { name: /, scrollable$/ });
  }
}

// U15: the cost of planned work (standalone only, read-only).
export class EstimateView {
  constructor(private readonly content: FrameLocator) {}

  tag(): Locator {
    return this.content.locator(".est-tag");
  }

  rangeBar(): Locator {
    return this.content.getByRole("img", { name: /^Estimated range/ });
  }

  // "About $95.00 to $210.00 USD": the range in words above the bar.
  rangeHeading(): Locator {
    return this.content.getByRole("region", { name: "Estimated range", exact: true }).getByRole("heading", { level: 2 });
  }

  tile(name: string | RegExp): Locator {
    return this.content.getByRole("group", { name });
  }

  simulated(): Locator {
    return this.content.getByRole("region", { name: "Simulated", exact: true });
  }

  refusal(): Locator {
    return this.content.getByRole("status").filter({ hasText: "Not enough history to give an estimate." });
  }
}

// U4: the tool-call audit of one session or of a date range.
export class AuditView {
  constructor(private readonly content: FrameLocator) {}

  tile(name: string): Locator {
    return this.content.getByRole("group", { name, exact: true });
  }

  categories(): Locator {
    return this.content.getByRole("list", { name: /failed calls? by category$/ });
  }

  recovery(): Locator {
    return this.content.getByRole("region", { name: "Recovery cost", exact: true });
  }

  failedPerDay(): Locator {
    return this.content.getByRole("img", { name: /^Failed calls per day/ });
  }

  // Each day's column as its tooltip reads ("Oct 19: 9 failed calls", "Oct 20: Unknown").
  failedPerDayTitles(): Locator {
    return this.failedPerDay().locator("title");
  }

  // Days with no known outcome: a hatched gap, not a zero column.
  unknownDays(): Locator {
    return this.failedPerDay().locator("[data-unknown]");
  }

  // The chart's text form (A32): View as table, then one row per day.
  viewPerDayAsTable(): Locator {
    return this.content.getByRole("button", { name: "View as table", exact: true });
  }

  perDayRows(): Locator {
    return this.table("Failed calls per day").getByRole("row");
  }

  table(name: string): Locator {
    return this.content.getByRole("table", { name, exact: true });
  }
}

// U5: the session picker. A row is not a control; its Analyse button is.
export class SessionPickerView {
  constructor(private readonly content: FrameLocator) {}

  list(): Locator {
    return this.content.getByRole("list", { name: "Sessions", exact: true });
  }

  rows(): Locator {
    return this.list().getByRole("listitem");
  }

  row(title: string): Locator {
    return this.rows().filter({ hasText: title });
  }

  // "Analyse session <short id>" until sent, then "Sent: session <short id>".
  analyseButton(shortId: string): Locator {
    return this.content.getByRole("button", { name: `Analyse session ${shortId}`, exact: true });
  }

  sentButton(shortId: string): Locator {
    return this.content.getByRole("button", { name: `Sent: session ${shortId}`, exact: true });
  }

  buttons(): Locator {
    return this.content.getByRole("button");
  }

  hint(): Locator {
    return this.content.locator(".sp-hint");
  }

  // After the host declines a send: the text to type, in that row's place of its button.
  askInChat(shortId: string): Locator {
    return this.rows().filter({ hasText: shortId }).getByRole("status");
  }

  rowButtons(shortId: string): Locator {
    return this.rows().filter({ hasText: shortId }).getByRole("button");
  }

  noMatch(): Locator {
    return this.content.getByText("No sessions match", { exact: true });
  }
}
