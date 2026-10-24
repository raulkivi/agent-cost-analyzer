import { COMMAND_IDS, VIEW_IDS } from "../commands/command-ids.js";
import { identityTranslate, type Translate } from "../l10n/localize.js";
import type { Disposable } from "../panel/analyzer-panel.js";
import type { SessionsTreeNode } from "../sidebar/sessions-tree-model.js";
import type { SetupWarningNode } from "../sidebar/setup-view-model.js";
import type { SidebarController } from "../sidebar/sidebar-controller.js";

// The slice of vscode.TreeItem the views set; loosely typed so the real
// class satisfies it. The views are generic over the concrete item type,
// so the real TreeItem is what VS Code gets back.
export interface TreeItemLike {
  label?: unknown;
  description?: unknown;
  tooltip?: unknown;
  contextValue?: string;
  iconPath?: unknown;
  id?: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  accessibilityInformation?: { label: string };
}

interface EventEmitterLike<T> {
  readonly event: (listener: (event: T) => void) => Disposable;
  fire(event: T): void;
  dispose(): void;
}

interface TreeDataProviderLike<T, Item extends TreeItemLike> {
  getTreeItem(element: T): Item;
  getChildren(element?: T): T[];
  onDidChangeTreeData: (listener: (event: void) => void) => Disposable;
}

interface TreeViewLike extends Disposable {
  onDidChangeVisibility(listener: (event: { visible: boolean }) => void): Disposable;
}

// The slices of the `vscode` namespace the tree views need; extension.ts
// passes the real module, tests a fake (as vscode-host-commands.ts does).
export interface VscodeTreeApi<Item extends TreeItemLike = TreeItemLike> {
  TreeItem: new (label: string, collapsibleState: number) => Item;
  TreeItemCollapsibleState: { None: number; Collapsed: number; Expanded: number };
  ThemeIcon: new (id: string) => unknown;
  EventEmitter: new <T>() => EventEmitterLike<T>;
  window: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createTreeView(viewId: string, options: { treeDataProvider: TreeDataProviderLike<any, Item> }): TreeViewLike;
  };
}

export const SESSION_CONTEXT_VALUE = "aiCreditsAnalyzer.session";
export const SETUP_WARNING_CONTEXT_VALUE = "aiCreditsAnalyzer.setupWarning";

// Registers one tree view over a controller's data: `roots` and `childrenOf`
// read it, `toItem` renders a node, and the tree is re-read whenever the
// controller announces a change. A view becoming visible calls
// `onVisible` (the refresh); hiding it does nothing.
function registerView<T, Item extends TreeItemLike>(
  vscode: VscodeTreeApi<Item>,
  controller: SidebarController,
  viewId: string,
  view: {
    roots(): T[];
    childrenOf(node: T): T[];
    toItem(node: T): Item;
    onVisible(): void;
  },
): Disposable {
  const changed = new vscode.EventEmitter<void>();
  const provider: TreeDataProviderLike<T, Item> = {
    getTreeItem: (node) => view.toItem(node),
    getChildren: (node) => (node === undefined ? view.roots() : view.childrenOf(node)),
    onDidChangeTreeData: changed.event,
  };
  const treeView = vscode.window.createTreeView(viewId, { treeDataProvider: provider });
  const subscriptions = [
    controller.onDidChange(() => changed.fire()),
    treeView.onDidChangeVisibility((event) => {
      if (event.visible) {
        view.onVisible();
      }
    }),
    treeView,
    changed,
  ];
  return { dispose: () => subscriptions.forEach((subscription) => subscription.dispose()) };
}

// The Sessions view: day groups of sessions; a click opens the session in
// the panel. Refreshes (all of it) when it becomes visible.
export function registerSessionsView<Item extends TreeItemLike>(
  vscode: VscodeTreeApi<Item>,
  controller: SidebarController,
  t: Translate = identityTranslate,
): Disposable {
  const { None, Collapsed, Expanded } = vscode.TreeItemCollapsibleState;
  return registerView<SessionsTreeNode, Item>(vscode, controller, VIEW_IDS.sessions, {
    roots: () => controller.sessionsTree(),
    childrenOf: (node) => (node.kind === "group" ? node.children : []),
    toItem: (node) => {
      switch (node.kind) {
        case "group": {
          const item = new vscode.TreeItem(node.label, node.expanded ? Expanded : Collapsed);
          item.id = `group:${node.id}`;
          item.description = node.description;
          return item;
        }
        case "session": {
          const item = new vscode.TreeItem(node.label, None);
          item.id = `session:${node.sessionId}`;
          item.description = node.description;
          item.tooltip = node.tooltip;
          item.contextValue = SESSION_CONTEXT_VALUE;
          item.iconPath = new vscode.ThemeIcon("comment-discussion");
          item.accessibilityInformation = { label: node.ariaLabel };
          item.command = { command: COMMAND_IDS.openSession, title: t("Open"), arguments: [node.sessionId] };
          return item;
        }
        case "message": {
          const item = new vscode.TreeItem(node.label, None);
          item.description = node.description;
          item.iconPath = new vscode.ThemeIcon(node.icon);
          return item;
        }
      }
    },
    onVisible: () => void controller.refresh(),
  });
}

// The Setup view: one row per config warning, with the severity as icon and
// text and an inline Fix action (a menu contribution on the context value).
// An empty tree shows the view's welcome content.
export function registerSetupView<Item extends TreeItemLike>(vscode: VscodeTreeApi<Item>, controller: SidebarController): Disposable {
  return registerView<SetupWarningNode, Item>(vscode, controller, VIEW_IDS.setup, {
    roots: () => controller.setupTree(),
    childrenOf: () => [],
    toItem: (node) => {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.id = `setup:${node.id}`;
      item.description = node.description;
      item.tooltip = node.tooltip;
      item.contextValue = SETUP_WARNING_CONTEXT_VALUE;
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.accessibilityInformation = { label: node.ariaLabel };
      return item;
    },
    onVisible: () => void controller.refreshConfig(),
  });
}
