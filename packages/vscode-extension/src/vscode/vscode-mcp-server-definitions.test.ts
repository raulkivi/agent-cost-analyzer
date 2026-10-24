import { describe, expect, it } from "vitest";
import type { McpStdioServerSpec } from "../mcp/mcp-server-definitions.js";
import { registerMcpServerDefinitions, type McpServerDefinitionProviderLike, type VscodeMcpApi } from "./vscode-mcp-server-definitions.js";

class FakeStdioDefinition {
  constructor(
    readonly label: string,
    readonly command: string,
    readonly args?: string[],
    readonly env?: Record<string, string | number | null>,
    readonly version?: string,
  ) {}
}

const SPEC: McpStdioServerSpec = {
  label: "AI Credits Analyzer",
  command: "/opt/code/code",
  args: ["/ext/dist/mcp-stdio.js", "--user-data-dir", "/u/Code"],
  env: { ELECTRON_RUN_AS_NODE: "1" },
  version: "0.1.0",
};

function setup(specs: McpStdioServerSpec[]) {
  const registered: { id: string; provider: McpServerDefinitionProviderLike<FakeStdioDefinition> }[] = [];
  let registrationDisposed = false;
  const api: VscodeMcpApi<FakeStdioDefinition> = {
    McpStdioServerDefinition: FakeStdioDefinition,
    lm: {
      registerMcpServerDefinitionProvider(id, provider) {
        registered.push({ id, provider });
        return { dispose: () => void (registrationDisposed = true) };
      },
    },
  };
  const listeners = new Set<() => void>();
  const source = {
    provide: () => specs,
    onDidChange(listener: () => void) {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
  };
  const registration = registerMcpServerDefinitions(api, source);
  return {
    registered,
    registration,
    fireChange: () => [...listeners].forEach((listener) => listener()),
    listenerCount: () => listeners.size,
    registrationDisposed: () => registrationDisposed,
  };
}

describe("registerMcpServerDefinitions (vscode-extension.md D7)", () => {
  it("registers one provider under the contributed id", () => {
    const { registered } = setup([]);

    expect(registered.map((entry) => entry.id)).toEqual(["aiCreditsAnalyzer.mcp"]);
  });

  it("offers each definition as a McpStdioServerDefinition", async () => {
    const { registered } = setup([SPEC]);

    const definitions = await registered[0]!.provider.provideMcpServerDefinitions();

    expect(definitions).toEqual([new FakeStdioDefinition(SPEC.label, SPEC.command, SPEC.args, SPEC.env, SPEC.version)]);
    expect(definitions[0]).toBeInstanceOf(FakeStdioDefinition);
  });

  it("offers nothing when the source has nothing", async () => {
    const { registered } = setup([]);

    expect(await registered[0]!.provider.provideMcpServerDefinitions()).toEqual([]);
  });

  it("tells VS Code the definitions changed when the source does", () => {
    const { registered, fireChange } = setup([]);
    let changes = 0;
    registered[0]!.provider.onDidChangeMcpServerDefinitions?.(() => changes++);

    fireChange();

    expect(changes).toBe(1);
  });

  it("unregisters and stops listening when disposed", () => {
    const { registered, registration, listenerCount, registrationDisposed } = setup([]);
    registered[0]!.provider.onDidChangeMcpServerDefinitions?.(() => undefined);

    registration.dispose();

    expect(registrationDisposed()).toBe(true);
    expect(listenerCount()).toBe(0);
  });
});
