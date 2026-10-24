import type { Disposable } from "../panel/analyzer-panel.js";
import type { SidebarController } from "../sidebar/sidebar-controller.js";

// The slice of vscode.StatusBarItem the adapter sets.
export interface StatusBarItemLike extends Disposable {
  text: string;
  tooltip: string | undefined | unknown;
  command: string | undefined | unknown;
  backgroundColor: unknown;
  accessibilityInformation: { label: string; role?: string } | undefined;
  show(): void;
  hide(): void;
}

// The slices of the `vscode` namespace the status bar needs; extension.ts
// passes the real module, tests a fake.
export interface VscodeStatusBarApi {
  StatusBarAlignment: { Left: number; Right: number };
  ThemeColor: new (id: string) => unknown;
  window: { createStatusBarItem(alignment: number, priority?: number): StatusBarItemLike };
}

// Thin adapter: shows the controller's status-bar state (status-bar-model.ts
// decides it) and re-renders whenever the controller refreshes.
export function registerStatusBar(vscode: VscodeStatusBarApi, controller: SidebarController): Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const render = (): void => {
    const state = controller.statusBar();
    if (!state) {
      item.hide();
      return;
    }
    item.text = state.text;
    item.tooltip = state.tooltip;
    item.command = state.command;
    item.accessibilityInformation = { label: state.ariaLabel, role: "button" };
    // The warning colour only adds to the icon and the words.
    item.backgroundColor = state.warning ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
    item.show();
  };
  const subscription = controller.onDidChange(render);
  render();
  return {
    dispose: () => {
      subscription.dispose();
      item.dispose();
    },
  };
}
