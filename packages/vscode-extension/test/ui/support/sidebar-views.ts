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
