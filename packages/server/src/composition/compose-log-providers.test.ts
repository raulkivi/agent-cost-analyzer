import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LogProvider } from "../data-sources/log-providers/log-provider.js";
import { FileAppSettingsStore } from "../data-sources/log-providers/app-settings.js";
import { composeLogProviders } from "./compose-log-providers.js";

// Every path is injected so the test never reads this machine's real logs.
function isolatedOptions(dir: string) {
  return {
    sessionStoreDbPath: path.join(dir, "missing.db"),
    debugLogsDirPaths: [],
    vscodeSettingsPath: path.join(dir, "settings.json"),
    agentTracesDbPath: null,
    appSettingsDir: dir,
    mitmproxyCapturesDirPath: null,
    piAgentSessionsDirPath: null,
    systemPromptLogPath: null,
    claudeCodeProjectsDirPath: null,
  };
}

describe("composeLogProviders (standalone composition root)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "compose-log-providers-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("registers every provider, in the order the provider select lists them", () => {
    const { registry } = composeLogProviders(isolatedOptions(dir));

    expect(registry.listProviders().map((provider) => provider.id)).toEqual([
      "vscode",
      "mitmproxy",
      "pi-agent",
      "claude-code",
    ]);
  });

  it("appends additional providers after the built-in ones", () => {
    const extra = { id: "extra", label: "Extra" } as LogProvider;
    const { registry } = composeLogProviders({ ...isolatedOptions(dir), additionalLogProviders: [extra] });

    expect(registry.listProviders().map((provider) => provider.id)).toEqual([
      "vscode",
      "mitmproxy",
      "pi-agent",
      "claude-code",
      "extra",
    ]);
  });

  it("keeps the app settings in the injected directory and passes the settings path through", () => {
    const { appSettings, resolvedAppSettingsDir, resolvedVscodeSettingsPath } = composeLogProviders(
      isolatedOptions(dir),
    );

    expect(appSettings).toBeInstanceOf(FileAppSettingsStore);
    expect((appSettings as FileAppSettingsStore).settingsDir).toBe(dir);
    expect(resolvedAppSettingsDir).toBe(dir);
    expect(resolvedVscodeSettingsPath).toBe(path.join(dir, "settings.json"));
  });
});
