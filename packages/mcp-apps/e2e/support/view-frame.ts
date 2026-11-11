// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Frame, FrameLocator, Locator, Page } from "@playwright/test";
import { axeViolations } from "../../../web/e2e/support/axe.js";

// Page objects for one view in the fake host's iframe (step 10.17 G5), so
// specs read as the checklists do and hold no selectors. ViewFrame is the
// branded shell every view shares (kicker, title, Back, footer, focus, axe);
// the view objects below add what U1, U9, U10 and U11 show. A drill-down
// swaps the view inside the same frame, so each view object is a lens on
// the same frame, not a frame of its own.

const VIEW_FRAME = 'iframe[title="MCP App view"]';

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

  // The accessible name of the focused control, to check focus returns to the row a drill-down left.
  async focusedControl(): Promise<string> {
    return (await this.frame()).evaluate(() => {
      const active = document.activeElement;
      return active?.getAttribute("aria-label") ?? active?.textContent?.trim() ?? "";
    });
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

  topSessions(): Locator {
    return this.content.getByRole("table", { name: "Top sessions by cost" });
  }

  async openSession(title: string): Promise<void> {
    await this.topSessions().getByRole("button", { name: title, exact: true }).click();
  }

  // The top sessions' titles, most expensive first.
  async sessionTitles(): Promise<string[]> {
    return this.topSessions().getByRole("button").allTextContents();
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
}

// U1: one session's cost, opened from U9's top sessions.
export class SessionCostView {
  constructor(private readonly content: FrameLocator) {}

  tile(name: string): Locator {
    return this.content.getByRole("group", { name, exact: true });
  }

  turnChart(): Locator {
    return this.content.getByRole("img", { name: /per turn/ });
  }

  // Sends "Analyse session <id>" to the chat (mcp-apps.md §4.3).
  async askAboutSession(): Promise<void> {
    await this.content.getByRole("button", { name: "Ask about this session", exact: true }).click();
  }
}
