// Page object for the AI Credits Analyzer panel (step 10.16): opens it, and
// gives specs domain verbs for what is inside its webview. Specs never write
// selectors; the web app is reached through accessible names (`aria/`) and
// the few data-testids it has.
import { browser } from "@wdio/globals";
import { COMMAND_IDS } from "../../../src/commands/command-ids.js";
import { INTERNAL_COMMAND_IDS } from "../../../src/diagnostics/test-hooks.js";
import { layoutFor } from "../../../../web/src/lib/layout.js";
import type { VscodeHost } from "./vscode-host.js";
import { enterWebview, leaveWebview } from "./webview-frame.js";

export const PANEL_TITLE = "AI Credits Analyzer";
const WAIT_MS = 30_000;

// What a spec can do inside the webview. Only valid within `AnalyzerPanel.inside`.
export class PanelView {
  turnRowCount(): Promise<number> {
    return browser.execute(() => document.querySelectorAll("table tbody tr").length);
  }

  async waitForTurnRows(count: number): Promise<void> {
    await browser.waitUntil(async () => (await this.turnRowCount()) >= count, { timeout: WAIT_MS, timeoutMsg: `${count} turn rows did not render` });
  }

  // Clicks the nth (0-based) turn row.
  async selectTurn(index: number): Promise<void> {
    await browser.execute((position) => (document.querySelectorAll("table tbody tr")[position] as HTMLElement).click(), index);
  }

  // One option of a segmented control: the right column's tabs (Explanation,
  // System prompt, Tools) and the centre views (Turns, Tool audit, All
  // sessions, Dashboard). Radios are visually hidden, so the label is clicked.
  async chooseOption(label: string): Promise<void> {
    const clicked = await browser.execute((text) => {
      const option = Array.from(document.querySelectorAll<HTMLElement>("label.seg-opt")).find((element) => (element.textContent ?? "").trim() === text);
      option?.click();
      return option !== undefined;
    }, label);
    if (!clicked) throw new Error(`No option "${label}" in the panel`);
  }

  showTab(label: string): Promise<void> {
    return this.chooseOption(label);
  }

  explanationText(): Promise<string> {
    return browser.execute(() => document.body.innerText);
  }

  async clickButton(name: string): Promise<void> {
    const button = await browser.$(`button=${name}`);
    await button.waitForClickable({ timeout: WAIT_MS });
    await button.click();
  }

  // Learn mode (step 13.7): picks a model in the "Simulate on" select. The
  // select is React-controlled, so the value goes through the native setter
  // and a bubbling change event, as a person's pick would.
  async chooseSimulationModel(modelId: string): Promise<void> {
    const chosen = await browser.execute((id) => {
      const select = document.querySelector<HTMLSelectElement>(".vendor-picker select");
      if (select === null) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, id);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return select.value === id;
    }, modelId);
    if (!chosen) throw new Error(`No simulated model "${modelId}" in the picker`);
  }

  // The turns table's Cache column as the words a screen reader hears, one
  // per row ("Cache hit", "Cache outcome unknown", ...).
  cacheOutcomes(): Promise<string[]> {
    return browser.execute(() => {
      const headers = Array.from(document.querySelectorAll("table thead th"));
      const column = headers.findIndex((header) => (header.textContent ?? "").trim() === "Cache");
      if (column < 0) return [];
      return Array.from(document.querySelectorAll("table tbody tr")).map(
        (row) => row.children[column]?.querySelector(".sr-only")?.textContent?.trim() ?? "",
      );
    });
  }

  hasText(text: string): Promise<boolean> {
    return browser.execute((needle) => document.body.innerText.includes(needle), text);
  }

  async waitForText(text: string): Promise<void> {
    await browser.waitUntil(() => this.hasText(text), { timeout: WAIT_MS, timeoutMsg: `"${text}" did not appear in the panel` });
  }

  bodyClass(): Promise<string> {
    return browser.execute(() => document.body.className);
  }

  layout(): Promise<string | null> {
    return browser.execute(() => document.querySelector("main")?.getAttribute("data-layout") ?? null);
  }

  cssVariable(name: string): Promise<string> {
    return browser.execute((variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim(), name);
  }

  // Under xvfb the workbench window produces no frames of its own accord, so
  // a resized panel's ResizeObserver callbacks (the responsive layout) never
  // run. Capturing a screenshot forces one; poll after calling this.
  async requestFrame(): Promise<void> {
    await browser.takeScreenshot();
  }

  async dismissConfigBanner(): Promise<void> {
    if (await this.hasText("Dismiss")) await this.clickButton("Dismiss");
  }

  hasFocus(): Promise<boolean> {
    return browser.execute(() => document.hasFocus());
  }

  // Puts the page's focus on its body, so the next Tab starts from the top.
  async focusPanel(): Promise<void> {
    await browser.execute(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
  }

  // After a frame: before one, a just-resized webview still reports its old size.
  async width(): Promise<number> {
    await this.requestFrame();
    return browser.execute(() => window.innerWidth);
  }

  horizontalOverflow(): Promise<{ scrollWidth: number; clientWidth: number }> {
    return browser.execute(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  }
}

export class AnalyzerPanel {
  constructor(private readonly host: VscodeHost) {}

  // A clean start: no panel from before, no marks or trace.
  async reset(): Promise<void> {
    await this.host.command("workbench.action.closeAllEditors");
    await this.host.hook(INTERNAL_COMMAND_IDS.resetDiagnostics);
  }

  async openSession(sessionId: string): Promise<void> {
    await this.host.waitForExtension();
    await this.run(COMMAND_IDS.openSession, sessionId);
    await this.settleLayout();
  }

  // The responsive layout follows the panel's width through a ResizeObserver,
  // which runs only in a painted frame, and a runner with no GPU or window
  // manager paints none by itself: a panel measured while it was still small
  // stays in the narrow layout (no Columns button, no right-column tabs) after
  // it has grown. Force frames until the layout matches the width.
  async settleLayout(): Promise<void> {
    await this.inside(async (view) => {
      await browser.waitUntil(
        async () => {
          await view.requestFrame();
          return (await view.layout()) === layoutFor(await view.width(), { listColumn: false });
        },
        { timeout: 30_000, interval: 500, timeoutMsg: "the panel's layout did not follow its width" },
      );
    });
  }

  // Moves keyboard focus into the open panel with the workbench command (the
  // way a keyboard user would: the editor group takes focus, and a webview
  // editor passes it on). The focus arrives a moment later, so ask again until
  // a Tab moves the page's focus off its body. (document.hasFocus() stays
  // false under xvfb, which has no window manager to focus the window, even
  // though key events reach the page.)
  async focusIntoPanel(): Promise<void> {
    await browser.waitUntil(
      async () => {
        await this.host.command("workbench.action.focusActiveEditorGroup");
        await browser.pause(300);
        return this.inside(async (view) => {
          await view.focusPanel();
          await browser.keys(["Tab"]);
          const moved = await browser.execute(() => document.activeElement !== document.body);
          await view.focusPanel();
          return moved;
        });
      },
      { timeout: 30_000, interval: 300, timeoutMsg: "keyboard focus did not move into the panel" },
    );
  }

  async openDashboard(): Promise<void> {
    await this.host.waitForExtension();
    await this.run(COMMAND_IDS.open);
  }

  // Runs a command that should open the panel, once more if the panel has not
  // shown after a while (the first command can land before the extension has
  // finished starting).
  private async run(command: string, ...args: unknown[]): Promise<void> {
    await this.host.command(command, ...args);
    try {
      await this.waitForWebview(10_000);
    } catch {
      await this.host.command(command, ...args);
      await this.waitForWebview(WAIT_MS);
    }
  }

  private async waitForWebview(timeout: number): Promise<void> {
    const workbench = await browser.getWorkbench();
    await browser.waitUntil(async () => (await workbench.getAllWebviews()).length > 0, { timeout, timeoutMsg: "the panel's webview did not open" });
  }

  // Runs `body` inside the panel's webview, then returns to the workbench.
  async inside<T>(body: (view: PanelView) => Promise<T>): Promise<T> {
    const workbench = await browser.getWorkbench();
    const [webview] = await workbench.getAllWebviews();
    if (!webview) throw new Error(`No ${PANEL_TITLE} webview is open`);
    await enterWebview(browser, webview);
    try {
      return await body(new PanelView());
    } finally {
      await leaveWebview(browser);
    }
  }
}
