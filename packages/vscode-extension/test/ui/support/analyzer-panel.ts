// Page object for the AI Credits Analyzer panel (step 10.16): opens it, and
// gives specs domain verbs for what is inside its webview. Specs never write
// selectors; the web app is reached through accessible names (`aria/`) and
// the few data-testids it has.
import { browser } from "@wdio/globals";
import { COMMAND_IDS } from "../../../src/commands/command-ids.js";
import { INTERNAL_COMMAND_IDS } from "../../../src/diagnostics/test-hooks.js";
import type { VscodeHost } from "./vscode-host.js";

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

  width(): Promise<number> {
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
    await webview.open();
    try {
      return await body(new PanelView());
    } finally {
      await webview.close();
    }
  }
}
