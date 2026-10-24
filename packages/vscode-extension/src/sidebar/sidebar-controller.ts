import type { ConfigStatus, Session } from "@copilot-cost-analyzer/domain";
import type { Disposable } from "../panel/analyzer-panel.js";
import { buildStatusBarState, type StatusBarState } from "../status-bar/status-bar-model.js";
import { buildSessionsTree, sessionsLoadErrorTree, type SessionsTreeNode } from "./sessions-tree-model.js";
import { buildSetupTree, type SetupWarningNode } from "./setup-view-model.js";

// What the sidebar and the status bar read from (ApiService's listSessions
// and getConfigStatus in the extension, via composition.ts).
export interface SidebarSources {
  listSessions(): Promise<Session[]>;
  getConfigStatus(): Promise<ConfigStatus>;
  // Lists the per-workspace debug-logs folders again, so a workspace first
  // opened after activation is read without a reload (10.4 lists them once
  // at activation). Called before every full refresh.
  relistLogSources(): void;
}

export interface SidebarControllerOptions {
  // The clock and the zone "today" is judged in; the machine's own by
  // default.
  now?: () => Date;
  timeZone?: string;
  // Hears every failure of a source; the views only show a generic error.
  onInternalError?: (source: "listSessions" | "getConfigStatus" | "relistLogSources", error: unknown) => void;
}

// The data behind the Sessions tree, the Setup view and the status bar:
// read once per refresh, so the three can't disagree, and with no polling
// or watching (a refresh is the Refresh command, the Sessions view becoming
// visible, or a Copilot logging setting changing). Free of `vscode`: the
// views in vscode/ subscribe to onDidChange and read the trees back.
export class SidebarController {
  // undefined: not loaded yet; "error": the last read failed.
  private sessions: Session[] | "error" | undefined;
  private configStatus: ConfigStatus | undefined;
  private fullRefresh: Promise<void> | undefined;
  private configRefresh: Promise<void> | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly sources: SidebarSources,
    private readonly options: SidebarControllerOptions = {},
  ) {}

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  }

  // Re-lists the log folders, then reads the sessions and the config status.
  // A refresh already running is joined, not repeated.
  refresh(): Promise<void> {
    this.fullRefresh ??= this.runFullRefresh().finally(() => (this.fullRefresh = undefined));
    return this.fullRefresh;
  }

  // Just the config status: when a Copilot logging setting changes there is
  // nothing new to read from the logs.
  refreshConfig(): Promise<void> {
    this.configRefresh ??= this.readConfigStatus()
      .then(() => this.notify())
      .finally(() => (this.configRefresh = undefined));
    return this.configRefresh;
  }

  sessionsTree(): SessionsTreeNode[] {
    if (this.sessions === undefined) {
      return [];
    }
    if (this.sessions === "error") {
      return sessionsLoadErrorTree();
    }
    return buildSessionsTree(this.sessions, this.now(), this.options.timeZone);
  }

  setupTree(): SetupWarningNode[] {
    return buildSetupTree(this.configStatus);
  }

  statusBar(): StatusBarState | undefined {
    return buildStatusBarState({
      sessions: Array.isArray(this.sessions) ? this.sessions : [],
      now: this.now(),
      warnings: this.configStatus?.warnings ?? [],
      timeZone: this.options.timeZone,
    });
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async runFullRefresh(): Promise<void> {
    try {
      this.sources.relistLogSources();
    } catch (error) {
      this.options.onInternalError?.("relistLogSources", error);
    }
    await Promise.all([this.readSessions(), this.readConfigStatus()]);
    this.notify();
  }

  private async readSessions(): Promise<void> {
    try {
      this.sessions = await this.sources.listSessions();
    } catch (error) {
      this.sessions = "error";
      this.options.onInternalError?.("listSessions", error);
    }
  }

  // A status that can't be read means no setup nodes rather than a stale
  // warning: the panel's own banner reports the failure.
  private async readConfigStatus(): Promise<void> {
    try {
      this.configStatus = await this.sources.getConfigStatus();
    } catch (error) {
      this.configStatus = undefined;
      this.options.onInternalError?.("getConfigStatus", error);
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
