// Where checkConfig reads the editor's settings from (vscode-extension.md
// G6). The standalone app reads the user settings.json file
// (data-sources/vscode-settings/jsonc-file-settings-source.ts); the
// extension asks VS Code for the effective, merged values. Every
// implementation must pass describeSettingsSourceContract
// (settings-source-contract.ts).
export interface SettingsSourceDescription {
  // False when no settings could be located at all: checkConfig then
  // warns settings-not-found instead of judging values it never saw.
  located: boolean;
  // The user-level settings.json, for ConfigStatus.vscodeUserSettingsPath
  // and the warnings' help steps; null when it isn't known.
  userSettingsPath: string | null;
  // False when the GitHub Copilot Chat extension is disabled or not
  // installed: it then writes no logs whatever the settings say. Undefined
  // when the source can't tell (the standalone app's settings file).
  copilotChatAvailable?: boolean;
}

export interface SettingsSource {
  // The effective value of one setting id, or undefined when unset.
  get(settingId: string): unknown;
  describe(): SettingsSourceDescription;
}
