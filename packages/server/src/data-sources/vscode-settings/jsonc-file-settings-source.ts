import { readFileSync } from "node:fs";
import { parse as parseJsonc } from "jsonc-parser";
import type { SettingsSource, SettingsSourceDescription } from "../../services/config-check/settings-source.js";

// The standalone app's SettingsSource: the user's VS Code settings.json,
// read once at construction (checkConfig builds a fresh one per check, so
// each check sees the file as it is then). Workspace overrides aren't
// merged in (architecture.md §6.3); the extension's VscodeSettingsSource
// does get them. A missing or unreadable file, or one that isn't a JSON
// object, has no values but is still "located" when a path was given.
export class JsoncFileSettingsSource implements SettingsSource {
  private readonly values: Record<string, unknown>;

  constructor(private readonly settingsPath: string | null) {
    this.values = settingsPath ? readSettingsObject(settingsPath) : {};
  }

  get(settingId: string): unknown {
    return this.values[settingId];
  }

  describe(): SettingsSourceDescription {
    return { located: this.settingsPath !== null, userSettingsPath: this.settingsPath };
  }
}

function readSettingsObject(settingsPath: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(settingsPath, "utf8");
  } catch {
    return {};
  }
  const parsed: unknown = parseJsonc(raw);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}
