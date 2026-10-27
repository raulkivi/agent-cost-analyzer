import type { SettingsSource, SettingsSourceDescription } from "@agent-cost-analyzer/server/src/services/config-check/settings-source";

// The slice of `vscode.workspace` the source needs; extension.ts passes the
// real one, tests a fake.
export interface ConfigurationReader {
  getConfiguration(): { get(section: string): unknown };
}

// The slice of `vscode.extensions` the source needs. getExtension returns
// undefined for an extension that is disabled or not installed.
export interface ExtensionsReader {
  getExtension(extensionId: string): unknown;
}

const COPILOT_CHAT_EXTENSION_ID = "GitHub.copilot-chat";

// SettingsSource over vscode.workspace.getConfiguration() (G6): the
// effective value VS Code itself uses, so user, remote and workspace
// overrides are all merged in. Reads through on every call, so each config
// check sees the current settings. (Without a resource scope, a multi-root
// workspace's per-folder overrides aren't included.) VS Code always has
// settings, so it's always "located"; `userSettingsPath` only feeds the
// help steps.
export class VscodeSettingsSource implements SettingsSource {
  constructor(
    private readonly workspace: ConfigurationReader,
    private readonly userSettingsPath: string | null,
    private readonly extensions: ExtensionsReader,
  ) {}

  get(settingId: string): unknown {
    return this.workspace.getConfiguration().get(settingId);
  }

  describe(): SettingsSourceDescription {
    // Settings still read back from settings.json with Copilot Chat disabled,
    // so the values alone can't show that no logs are being written.
    return {
      located: true,
      userSettingsPath: this.userSettingsPath,
      copilotChatAvailable: this.extensions.getExtension(COPILOT_CHAT_EXTENSION_ID) !== undefined,
    };
  }
}
