import type { ConfigStatus, Session } from "@agent-cost-analyzer/domain";
import { identityTranslate, type Translate } from "../l10n/localize.js";
import type { Disposable } from "../panel/analyzer-panel.js";
import { buildStatusBarState, type StatusBarState } from "../status-bar/status-bar-model.js";
import { buildLearnTree, learnLoadErrorTree, type LearnTreeNode } from "./learn-tree-model.js";
import { buildSessionsTree, sessionsLoadErrorTree, type SessionsTreeNode } from "./sessions-tree-model.js";
import { buildSetupTree, type SetupWarningNode } from "./setup-view-model.js";

// What the sidebar and the status bar read from (ApiService's listSessions,
// listLearnScenarios and getConfigStatus in the extension, via
// composition.ts).
export interface SidebarSources {
  listSessions(): Promise<Session[]>;
  // The bundled Learn scenarios (step 10.12): fixed, so read once.
  listLearnScenarios(): Promise<Session[]>;
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
  // Translates the strings the trees and the status bar show (vscode.l10n.t
  // in the extension); English as written by default.
  translate?: Translate;
  // Hears every failure of a source; the views only show a generic error.
  onInternalError?: (
    source: "listSessions" | "listLearnScenarios" | "getConfigStatus" | "relistLogSources",
    error: unknown,
  ) => void;
  // Times each full refresh that read the sessions, from its start to the
  // Sessions tree's nodes being built (§3.5 Performance: under 500 ms).
  // `now` is a monotonic clock in ms.
  timing?: { now(): number; sessionsTreeBuilt(durationMs: number): void };
}

// The data behind the Sessions tree, the Setup view and the status bar:
// read once per refresh, so the three can't disagree, and with no polling
// or watching (a refresh is the Refresh command, the Sessions view becoming
// visible, or a Copilot logging setting changing). Free of `vscode`: the
// views in vscode/ subscribe to onDidChange and read the trees back.
export class SidebarController {
  // undefined: not loaded yet; "error": the last read failed.
  private sessions: Session[] | "error" | undefined;
  private scenarios: Session[] | "error" | undefined;
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
      return sessionsLoadErrorTree(this.translate());
    }
    return buildSessionsTree(this.sessions, this.now(), this.options.timeZone, this.translate());
  }

  learnTree(): LearnTreeNode[] {
    if (this.scenarios === undefined) {
      return [];
    }
    if (this.scenarios === "error") {
      return learnLoadErrorTree(this.translate());
    }
    return buildLearnTree(this.scenarios, this.translate());
  }

  setupTree(): SetupWarningNode[] {
    return buildSetupTree(this.configStatus, this.translate());
  }

  statusBar(): StatusBarState | undefined {
    return buildStatusBarState({
      sessions: Array.isArray(this.sessions) ? this.sessions : [],
      now: this.now(),
      warnings: this.configStatus?.warnings ?? [],
      timeZone: this.options.timeZone,
      t: this.translate(),
    });
  }

  private translate(): Translate {
    return this.options.translate ?? identityTranslate;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async runFullRefresh(): Promise<void> {
    const startedAt = this.options.timing?.now();
    try {
      this.sources.relistLogSources();
    } catch (error) {
      this.options.onInternalError?.("relistLogSources", error);
    }
    await Promise.all([this.readSessions(), this.readConfigStatus(), this.readScenarios()]);
    this.reportSessionsTreeTime(startedAt);
    this.notify();
  }

  // Builds the tree once more just to time it: the views build their own
  // when they're told of the change, and the nodes depend on the time of
  // that read ("Today"), so they aren't cached.
  private reportSessionsTreeTime(startedAt: number | undefined): void {
    const { timing } = this.options;
    if (!timing || startedAt === undefined || !Array.isArray(this.sessions)) {
      return;
    }
    this.sessionsTree();
    timing.sessionsTreeBuilt(timing.now() - startedAt);
  }

  private async readSessions(): Promise<void> {
    try {
      this.sessions = await this.sources.listSessions();
    } catch (error) {
      this.sessions = "error";
      this.options.onInternalError?.("listSessions", error);
    }
  }

  // Once: the scenarios ship with the extension. A failed read is retried
  // on the next refresh.
  private async readScenarios(): Promise<void> {
    if (Array.isArray(this.scenarios)) {
      return;
    }
    try {
      this.scenarios = await this.sources.listLearnScenarios();
    } catch (error) {
      this.scenarios = "error";
      this.options.onInternalError?.("listLearnScenarios", error);
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
