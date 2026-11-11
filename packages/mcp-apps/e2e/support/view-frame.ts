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
      if ((await this.focusedControl()) === name) return;
    }
    throw new Error(`Tab did not reach "${name}" in ${limit} presses`);
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

  noMatch(): Locator {
    return this.content.getByText("No sessions match", { exact: true });
  }
}
