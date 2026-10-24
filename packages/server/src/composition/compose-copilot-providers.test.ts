import path from "node:path";
import { describe, expect, it } from "vitest";
import { UnknownLogProviderIdError } from "../data-sources/log-providers/registry.js";
import { InMemoryAppSettingsStore } from "../test-support/in-memory-app-settings-store.js";
import { composeCopilotProviders } from "./compose-copilot-providers.js";

const isolatedPaths = {
  sessionStoreDbPath: path.join("/nonexistent", "state.vscdb"),
  debugLogsDirPaths: [],
  agentTracesDbPath: null,
  vscodeSettingsPath: path.join("/nonexistent", "settings.json"),
};

describe("composeCopilotProviders (extension composition root, vscode-extension.md §3.1)", () => {
  it("registers only the VS Code provider", () => {
    const { registry } = composeCopilotProviders({ ...isolatedPaths, appSettings: new InMemoryAppSettingsStore() });

    expect(registry.listProviders().map((provider) => provider.id)).toEqual(["vscode"]);
    expect(registry.getActiveProviderId()).toBe("vscode");
  });

  it("rejects switching to a provider the extension doesn't ship, from the registry itself (§4)", () => {
    const { registry } = composeCopilotProviders({ ...isolatedPaths, appSettings: new InMemoryAppSettingsStore() });

    expect(() => registry.setActive("claude-code")).toThrow(UnknownLogProviderIdError);
  });

  it("falls back to vscode when the injected store persisted a provider it doesn't register", () => {
    const appSettings = new InMemoryAppSettingsStore({ activeProviderId: "pi-agent" });
    const { registry } = composeCopilotProviders({ ...isolatedPaths, appSettings });

    expect(registry.getActiveProviderId()).toBe("vscode");
  });

  it("uses the injected app settings store and settings path (D4, D5)", () => {
    const appSettings = new InMemoryAppSettingsStore();
    const composed = composeCopilotProviders({ ...isolatedPaths, appSettings });

    expect(composed.appSettings).toBe(appSettings);
    expect(composed.resolvedVscodeSettingsPath).toBe(isolatedPaths.vscodeSettingsPath);
  });
});
