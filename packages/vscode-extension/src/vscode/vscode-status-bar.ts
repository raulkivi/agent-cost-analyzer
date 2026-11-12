// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { FOCUS_SESSIONS_VIEW_COMMAND } from "../commands/command-ids.js";
import type { Disposable } from "../panel/analyzer-panel.js";
import type { SidebarController } from "../sidebar/sidebar-controller.js";

// The slice of vscode.StatusBarItem the adapter sets.
export interface StatusBarItemLike extends Disposable {
  // The name in the status bar's context menu; needs an id to be stable.
  name?: string | undefined;
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
  window: {
    // With an id the item keeps its own hide-toggle entry (step 10.21).
    createStatusBarItem(id: string, alignment: number, priority?: number): StatusBarItemLike;
    createStatusBarItem(alignment: number, priority?: number): StatusBarItemLike;
  };
}

const GAUGE_ITEM_ID = "aiCreditsAnalyzer.monthlyAllowance";
const GAUGE_ITEM_NAME = "AI Credits Analyzer: Monthly Allowance";

// Only the two theme colours that exist for a status-bar item; the words, the
// icon and the label carry the level, the colour only adds to them.
const GAUGE_BACKGROUNDS = { near: "statusBarItem.warningBackground", over: "statusBarItem.errorBackground" } as const;

// Thin adapter: shows the controller's status-bar state (status-bar-model.ts
// decides it) and re-renders whenever the controller refreshes. A second item
// shows the monthly allowance gauge (monthly-allowance.ts decides it).
export function registerStatusBar(vscode: VscodeStatusBarApi, controller: SidebarController): Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const gauge = vscode.window.createStatusBarItem(GAUGE_ITEM_ID, vscode.StatusBarAlignment.Left, 99);
  gauge.name = GAUGE_ITEM_NAME;
  const renderGauge = (todayWarning: boolean): void => {
    const view = controller.monthlyAllowance();
    // A required-config warning is the one thing to read; the gauge returns
    // once it is fixed.
    if (view.level === "hidden" || todayWarning) {
      gauge.hide();
      return;
    }
    gauge.text = view.text;
    gauge.tooltip = view.tooltip;
    gauge.command = FOCUS_SESSIONS_VIEW_COMMAND;
    gauge.accessibilityInformation = { label: view.ariaLabel, role: "button" };
    gauge.backgroundColor = view.level === "normal" ? undefined : new vscode.ThemeColor(GAUGE_BACKGROUNDS[view.level]);
    gauge.show();
  };
  const render = (): void => {
    const state = controller.statusBar();
    renderGauge(state?.warning === true);
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
      gauge.dispose();
    },
  };
}
