import type { SettingsSource, SettingsSourceDescription } from "@agent-cost-analyzer/server/src/services/config-check/settings-source";

// The slice of `vscode.workspace` the source needs; extension.ts passes the
// real one, tests a fake.
export interface ConfigurationReader {
  getConfiguration(): { get(section: string): unknown };
}

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
  ) {}

  get(settingId: string): unknown {
    return this.workspace.getConfiguration().get(settingId);
  }

  describe(): SettingsSourceDescription {
    return { located: true, userSettingsPath: this.userSettingsPath };
  }
}
