import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Session, TurnInspectorDetail } from "@agent-cost-analyzer/domain";
import { LogProviderRegistry, UnknownLogProviderIdError } from "./registry.js";
import type { LogProvider, LogProviderAvailability } from "./log-provider.js";
import { FileAppSettingsStore, type AppSettingsStore } from "./app-settings.js";
import { InMemoryAppSettingsStore } from "../../test-support/in-memory-app-settings-store.js";

class StubProvider implements LogProvider {
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly availability: LogProviderAvailability,
  ) {}

  async checkAvailability(): Promise<LogProviderAvailability> {
    return this.availability;
  }

  async listSessions(): Promise<Session[]> {
    return [];
  }

  async readSession(): Promise<Session | null> {
    return null;
  }

  async readTurnDetail(): Promise<TurnInspectorDetail | null> {
    return null;
  }
}

describe("LogProviderRegistry", () => {
  let dir: string;
  let settings: AppSettingsStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "log-provider-registry-"));
    settings = new FileAppSettingsStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults the active provider to 'vscode' on first run", () => {
    const registry = new LogProviderRegistry(
      [new StubProvider("vscode", "VS Code", { available: true })],
      settings,
    );

    expect(registry.getActiveProviderId()).toBe("vscode");
  });

  it("lists descriptors reflecting each provider's availability", async () => {
    const registry = new LogProviderRegistry(
      [
        new StubProvider("vscode", "VS Code", { available: true }),
        new StubProvider("mitmproxy", "mitmproxy", {
          available: false,
          unavailableReason: "no captures configured",
        }),
      ],
      settings,
    );

    const status = await registry.getStatus();

    expect(status.activeProviderId).toBe("vscode");
    expect(status.providers).toEqual([
      { id: "vscode", label: "VS Code", available: true },
      {
        id: "mitmproxy",
        label: "mitmproxy",
        available: false,
        unavailableReason: "no captures configured",
      },
    ]);
  });

  it("setActive persists across a new registry instance reading the same settings dir", () => {
    const providers = () => [
      new StubProvider("vscode", "VS Code", { available: true }),
      new StubProvider("mitmproxy", "mitmproxy", { available: true }),
    ];
    const first = new LogProviderRegistry(providers(), settings);
    first.setActive("mitmproxy");

    const second = new LogProviderRegistry(providers(), new FileAppSettingsStore(dir));

    expect(second.getActiveProviderId()).toBe("mitmproxy");
  });

  it("reads and persists the active id through whatever AppSettingsStore it was given (D5)", () => {
    const store = new InMemoryAppSettingsStore({ activeProviderId: "mitmproxy" });
    const providers = () => [
      new StubProvider("vscode", "VS Code", { available: true }),
      new StubProvider("mitmproxy", "mitmproxy", { available: true }),
    ];
    const registry = new LogProviderRegistry(providers(), store);

    expect(registry.getActiveProviderId()).toBe("mitmproxy");

    registry.setActive("vscode");

    expect(store.readActiveProviderId()).toBe("vscode");
  });

  it("throws UnknownLogProviderIdError when setting an unregistered id", () => {
    const registry = new LogProviderRegistry(
      [new StubProvider("vscode", "VS Code", { available: true })],
      settings,
    );

    expect(() => registry.setActive("does-not-exist")).toThrow(UnknownLogProviderIdError);
  });

  it("falls back to the default active id when the persisted id is no longer registered", () => {
    const stale = new LogProviderRegistry(
      [
        new StubProvider("vscode", "VS Code", { available: true }),
        new StubProvider("mitmproxy", "mitmproxy", { available: true }),
      ],
      settings,
    );
    stale.setActive("mitmproxy");

    const registry = new LogProviderRegistry(
      [new StubProvider("vscode", "VS Code", { available: true })],
      settings,
    );

    expect(registry.getActiveProviderId()).toBe("vscode");
  });

  // OCP proof: a third, test-only provider needs nothing beyond
  // constructing it and passing it into this same constructor alongside
  // vscode/mitmproxy — no change to
  // LogProviderRegistry, the LogProvider interface, or any other file in
  // data-sources/log-providers/ is required to add a provider.
  it("registers and serves a third, test-only provider with no other file changes", async () => {
    const thirdProvider = new StubProvider("test-only", "Test-only provider", { available: true });
    const registry = new LogProviderRegistry(
      [
        new StubProvider("vscode", "VS Code", { available: true }),
        new StubProvider("mitmproxy", "mitmproxy", { available: true }),
        thirdProvider,
      ],
      settings,
    );

    registry.setActive("test-only");

    expect(registry.getActiveProvider()).toBe(thirdProvider);
    const status = await registry.getStatus();
    expect(status.providers.map((p) => p.id)).toEqual(["vscode", "mitmproxy", "test-only"]);
    expect(status.activeProviderId).toBe("test-only");
  });

  it("getProvider looks a provider up by id without changing the active one", () => {
    const vscode = new StubProvider("vscode", "VS Code", { available: true });
    const other = new StubProvider("other", "Other", { available: true });
    const registry = new LogProviderRegistry([vscode, other], settings);

    expect(registry.getProvider("other")).toBe(other);
    expect(registry.getActiveProviderId()).toBe("vscode");
    expect(() => registry.getProvider("nope")).toThrow(UnknownLogProviderIdError);
  });

  it("listProviders returns every registered provider in registration order", () => {
    const vscode = new StubProvider("vscode", "VS Code", { available: true });
    const other = new StubProvider("other", "Other", { available: false });
    const registry = new LogProviderRegistry([vscode, other], settings);

    expect(registry.listProviders()).toEqual([vscode, other]);
  });
});
