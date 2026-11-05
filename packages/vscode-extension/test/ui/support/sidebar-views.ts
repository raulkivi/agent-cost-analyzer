// Page object for the extension's side bar (step 10.16): the Sessions, Learn
// and Setup views, reached through wdio-vscode-service's workbench page
// objects (the activity bar's view control, the side bar's sections).
import { browser } from "@wdio/globals";
import type { ViewSection } from "wdio-vscode-service";

// The tree rows are TreeItems, whose getLabel the service types only on a subclass.
type ExtendedViewItem = { getLabel(): Promise<string> };

export const VIEW_CONTAINER_TITLE = "AI Credits Analyzer";
// The views' order in package.json.
const SECTION_INDEX = { sessions: 0, learn: 1, setup: 2 } as const;

export class SidebarViews {
  private async section(name: keyof typeof SECTION_INDEX): Promise<ViewSection> {
    const workbench = await browser.getWorkbench();
    const control = await workbench.getActivityBar().getViewControl(VIEW_CONTAINER_TITLE);
    if (!control) throw new Error(`No "${VIEW_CONTAINER_TITLE}" icon in the activity bar`);
    const sidebar = await control.openView();
    const sections = await sidebar.getContent().getSections();
    const section = sections[SECTION_INDEX[name]];
    if (!section) throw new Error(`The ${name} view is missing from the side bar`);
    return section;
  }

  async labels(name: keyof typeof SECTION_INDEX): Promise<string[]> {
    const items = await (await this.section(name)).getVisibleItems();
    return Promise.all(items.map((item) => (item as unknown as ExtendedViewItem).getLabel()));
  }

  // The view's rows as drawn (label and description), the welcome text of an
  // empty view as one entry, from the DOM: tree rows are virtualised, so
  // collapse the other views first when a view's every row must show.
  async rowTexts(name: keyof typeof SECTION_INDEX): Promise<string[]> {
    await this.section(name);
    return browser.execute((title: string) => {
      const pane = Array.from(document.querySelectorAll<HTMLElement>(".pane")).find((element) => (element.querySelector(".pane-header")?.textContent ?? "").trim().toLowerCase() === title);
      if (!pane) return [];
      const rows = Array.from(pane.querySelectorAll<HTMLElement>(".monaco-list-row")).map((row) => row.innerText.replace(/\s+/g, " ").trim());
      return rows.length > 0 ? rows : [(pane.querySelector<HTMLElement>(".welcome-view-content")?.innerText ?? "").trim()];
    }, name);
  }

  // Every row of the view, however short the window: tree rows are virtualised,
  // so only the ones that fit are in the DOM. Walks the tree with the keyboard
  // (Home, then PageDown until the focused row stops changing, which is the
  // end), forcing a frame at each step because an xvfb workbench paints only
  // when asked, and collects the distinct rows seen on the way, in order.
  // Moves focus only, never selects, so no scenario or session opens.
  async allRowTexts(name: keyof typeof SECTION_INDEX): Promise<string[]> {
    await this.section(name);
    await browser.executeWorkbench((vscode, id: string) => vscode.commands.executeCommand(id), `aiCreditsAnalyzer.${name}.focus`);
    const seen: string[] = [];
    const collect = async (): Promise<void> => {
      await browser.takeScreenshot();
      for (const row of await this.rowTexts(name)) if (!seen.includes(row)) seen.push(row);
    };
    const focusedRow = (): Promise<string> => browser.execute(() => (document.querySelector(".monaco-list-row.focused") as HTMLElement | null)?.innerText ?? "");
    await browser.keys(["Home"]);
    await collect();
    let previous = await focusedRow();
    for (let presses = 0; presses < 100; presses++) {
      await browser.keys(["PageDown"]);
      await collect();
      const current = await focusedRow();
      if (current === previous) return seen;
      previous = current;
    }
    throw new Error(`The ${name} view did not reach its end in 100 PageDowns`);
  }

  // Gives the view the side bar's room by collapsing the other two.
  async showAlone(name: keyof typeof SECTION_INDEX): Promise<void> {
    await this.section(name);
    await browser.execute((title: string) => {
      for (const header of Array.from(document.querySelectorAll<HTMLElement>(".pane-header"))) {
        const isTarget = (header.textContent ?? "").trim().toLowerCase() === title;
        if (header.classList.contains("expanded") !== isTarget && header.closest(".pane")?.closest(".monaco-pane-view")) header.click();
      }
    }, name);
  }

  // Clicks an inline action (its title, e.g. "Fix Setting") on the row whose text contains `rowText`.
  async clickRowAction(name: keyof typeof SECTION_INDEX, rowText: string, actionTitle: string): Promise<void> {
    await this.section(name);
    const clicked = await browser.execute(
      (title: string, needle: string, action: string) => {
        const pane = Array.from(document.querySelectorAll<HTMLElement>(".pane")).find((element) => (element.querySelector(".pane-header")?.textContent ?? "").trim().toLowerCase() === title);
        const row = Array.from(pane?.querySelectorAll<HTMLElement>(".monaco-list-row") ?? []).find((element) => element.innerText.includes(needle));
        const button = Array.from(row?.querySelectorAll<HTMLElement>(".action-label") ?? []).find((element) => (element.getAttribute("aria-label") ?? element.title) === action);
        button?.click();
        return button !== undefined;
      },
      name,
      rowText,
      actionTitle,
    );
    if (!clicked) throw new Error(`No "${actionTitle}" action on a "${rowText}" row in the ${name} view`);
  }

  // Clicks the row with this exact label.
  async select(name: keyof typeof SECTION_INDEX, label: string): Promise<void> {
    const items = await (await this.section(name)).getVisibleItems();
    for (const item of items) {
      if ((await (item as unknown as ExtendedViewItem).getLabel()) === label) {
        await item.select();
        return;
      }
    }
    throw new Error(`No "${label}" row in the ${name} view`);
  }
}
