import {
  hostCommandArgsSchemas,
  hostCommandSchema,
  type ConfigStatus,
  type HostCommand,
  type HostCommandArgs,
  type RpcCommandResponse,
} from "@agent-cost-analyzer/domain";
import { WATCHED_SETTING_IDS } from "../config/config-change-watcher.js";
import { describeIssues } from "./describe-issues.js";

export type DocumentLanguage = HostCommandArgs["openTextDocument"]["language"];

// What the editor does for each host command (vscode-extension.md G8);
// vscode/vscode-host-commands.ts implements it over the real VS Code API.
export interface HostCommands {
  openSetting(settingId: string): Promise<void>;
  copyToClipboard(text: string): Promise<void>;
  openTextDocument(content: string, language: DocumentLanguage): Promise<void>;
}

export interface HostCommandHandlerOptions {
  // Hears every failure of the editor call itself; the webview only ever
  // gets a generic 500 for those.
  onInternalError?: (command: HostCommand, error: unknown) => void;
}

const INTERNAL_ERROR_MESSAGE = "Internal error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The settings a Fix button may open: those the current config status
// warns about, plus the two Copilot logging settings the check always
// judges (so a fix still works if the status can't be read right now).
// Anything else is refused: the webview is untrusted content, and an open
// setting id would let it steer the user to any setting at all. The
// sidebar's fixSetting command applies the same rule.
export async function allowedSettingIds(readConfigStatus: () => Promise<ConfigStatus>): Promise<Set<string>> {
  const allowed = new Set<string>(WATCHED_SETTING_IDS);
  try {
    for (const warning of (await readConfigStatus()).warnings) {
      allowed.add(warning.settingId);
    }
  } catch {
    // Only the known settings, then.
  }
  return allowed;
}

// The host's end of the webview's host commands (domain rpc.ts): validates
// the command against the allow-list and its args against the command's
// schema, applies the openSetting policy above, and only then calls the
// editor. Every rejection is a 400, every editor failure a generic 500.
export class HostCommandHandler {
  constructor(
    private readonly commands: HostCommands,
    private readonly readConfigStatus: () => Promise<ConfigStatus>,
    private readonly options: HostCommandHandlerOptions = {},
  ) {}

  // `message` is a { kind: "command" } message whose id is already a string.
  async handle(message: { id: string; command?: unknown; args?: unknown }): Promise<RpcCommandResponse> {
    const { id } = message;
    const command = hostCommandSchema.safeParse(message.command);
    if (!command.success) {
      return failure(id, 400, `Unknown command "${String(message.command)}"`);
    }
    // Only absent args mean "none"; null, arrays and scalars are malformed.
    const args = message.args === undefined ? {} : message.args;
    if (!isRecord(args)) {
      return failure(id, 400, "args must be an object");
    }
    const parsed = hostCommandArgsSchemas[command.data].safeParse(args);
    if (!parsed.success) {
      return failure(id, 400, `Invalid args for ${command.data}: ${describeIssues(parsed.error.issues)}`);
    }
    if (command.data === "openSetting") {
      const { settingId } = parsed.data as HostCommandArgs["openSetting"];
      if (!(await allowedSettingIds(this.readConfigStatus)).has(settingId)) {
        return failure(id, 400, `Setting "${settingId}" can't be opened from the analyzer`);
      }
    }
    try {
      await this.run(command.data, parsed.data);
      return { kind: "response", id, ok: true };
    } catch (error) {
      this.options.onInternalError?.(command.data, error);
      return failure(id, 500, INTERNAL_ERROR_MESSAGE);
    }
  }

  private run(command: HostCommand, args: unknown): Promise<void> {
    switch (command) {
      case "openSetting":
        return this.commands.openSetting((args as HostCommandArgs["openSetting"]).settingId);
      case "copyToClipboard":
        return this.commands.copyToClipboard((args as HostCommandArgs["copyToClipboard"]).text);
      case "openTextDocument": {
        const { content, language } = args as HostCommandArgs["openTextDocument"];
        return this.commands.openTextDocument(content, language);
      }
    }
  }
}

function failure(id: string, status: 400 | 500, message: string): RpcCommandResponse {
  return { kind: "response", id, ok: false, error: { status, message } };
}
