import {
  selectSessionPayloadSchema,
  type ConfigStatus,
  type HostEvent,
  type SelectSessionPayload,
} from "@copilot-cost-analyzer/domain";
import { WATCHED_SETTING_IDS } from "../config/config-change-watcher.js";
import { identityTranslate, type Translate } from "../l10n/localize.js";
import { MCP_ENABLED_SETTING_ID } from "../mcp/mcp-server-definitions.js";
import type { WalkthroughLauncher } from "../onboarding/walkthrough-offer.js";
import { allowedSettingIds } from "../rpc/host-command-handler.js";
import { COMMAND_IDS } from "./command-ids.js";

export interface CommandPanel {
  open(): void;
  // Delivers a host event once the webview is listening (AnalyzerPanel).
  postWhenReady(message: unknown): void;
}

export interface ExtensionCommandsDeps {
  panel: CommandPanel;
  sidebar: { refresh(): Promise<void> };
  hostCommands: { openSetting(settingId: string): Promise<void> };
  // Opens the Get Started walkthrough (vscode/vscode-walkthrough.ts).
  walkthrough: WalkthroughLauncher;
  readConfigStatus(): Promise<ConfigStatus>;
  // Translates the messages VS Code shows when a command is refused.
  t?: Translate;
}

type Handler = (...args: unknown[]) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The string field a command argument carries: the argument itself, or the
// field of the tree node VS Code passes to a view-item menu command.
function stringArg(arg: unknown, field: string): unknown {
  return isRecord(arg) ? arg[field] : arg;
}

// The extension's contributed commands (package.json), free of `vscode`;
// extension.ts registers each of handlers(). Arguments come from tree
// nodes, menus and other extensions, so every one is validated like the
// webview's messages are.
export class ExtensionCommands {
  private readonly t: Translate;

  constructor(private readonly deps: ExtensionCommandsDeps) {
    this.t = deps.t ?? identityTranslate;
  }

  open(): void {
    this.deps.panel.open();
  }

  // The web app starts in Learn mode, so opening the panel is enough.
  openLearnMode(): void {
    this.deps.panel.open();
  }

  openWalkthrough(): Promise<void> {
    return this.deps.walkthrough.open();
  }

  refreshSessions(): Promise<void> {
    return this.deps.sidebar.refresh();
  }

  // Opens the panel if it's closed, then has the web app select the session
  // as a click in its own list would. `options.tab` is the right column's
  // tab and `options.view` the center view.
  async openSession(target?: unknown, options?: unknown): Promise<void> {
    const { tab, view } = isRecord(options) ? options : ({} as Record<string, unknown>);
    this.select({ sessionId: stringArg(target, "sessionId"), tab, view });
  }

  // A click in the Learn view (step 10.12): the scenario, in Learn mode.
  async openScenario(target?: unknown): Promise<void> {
    this.select({ sessionId: stringArg(target, "scenarioId"), mode: "learn" });
  }

  async showToolAudit(target?: unknown): Promise<void> {
    this.select({ sessionId: stringArg(target, "sessionId"), view: "session-audit" });
  }

  // The advice bundle is built by the web app (it needs the fetched
  // session), so this opens the session with the export dialog, where the
  // bundle is previewed and copied.
  async copyAdviceBundle(target?: unknown): Promise<void> {
    this.select({ sessionId: stringArg(target, "sessionId"), adviceDialog: true });
  }

  // Opens the setting a Setup node (or a welcome link, with no argument)
  // names: the debug-logging setting by default. Only the settings a
  // current warning names, or the two Copilot logging settings, may be
  // opened (the webview's openSetting rule), plus the extension's own MCP
  // switch, which the walkthrough's MCP step links to. Opening a setting
  // never changes it: turning the MCP server on stays the user's call.
  async fixSetting(target?: unknown): Promise<void> {
    const arg = stringArg(target, "settingId");
    const settingId = typeof arg === "string" && arg !== "" ? arg : WATCHED_SETTING_IDS[0];
    if (settingId !== MCP_ENABLED_SETTING_ID && !(await allowedSettingIds(this.deps.readConfigStatus)).has(settingId)) {
      throw new Error(this.t('Setting "{0}" can\'t be opened from the analyzer', settingId));
    }
    await this.deps.hostCommands.openSetting(settingId);
  }

  // Every handler by contributed command id, bound to this instance.
  handlers(): Record<string, Handler> {
    return {
      [COMMAND_IDS.open]: () => this.open(),
      [COMMAND_IDS.openLearnMode]: () => this.openLearnMode(),
      [COMMAND_IDS.openWalkthrough]: () => this.openWalkthrough(),
      [COMMAND_IDS.refreshSessions]: () => this.refreshSessions(),
      [COMMAND_IDS.openSession]: (target, options) => this.openSession(target, options),
      [COMMAND_IDS.openScenario]: (target) => this.openScenario(target),
      [COMMAND_IDS.showToolAudit]: (target) => this.showToolAudit(target),
      [COMMAND_IDS.copyAdviceBundle]: (target) => this.copyAdviceBundle(target),
      [COMMAND_IDS.fixSetting]: (target) => this.fixSetting(target),
    };
  }

  private select(candidate: unknown): void {
    const payload = selectSessionPayloadSchema.safeParse(candidate);
    if (!payload.success) {
      throw new Error(this.t("A session id is needed to open a session, with an optional tab or view"));
    }
    this.deps.panel.open();
    this.deps.panel.postWhenReady(selectSessionEvent(payload.data));
  }
}

function selectSessionEvent(payload: SelectSessionPayload): HostEvent {
  return { kind: "event", name: "selectSession", payload };
}
