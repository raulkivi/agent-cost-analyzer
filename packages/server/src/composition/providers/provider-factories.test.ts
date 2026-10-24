import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClaudeCodeProvider } from "./create-claude-code-provider.js";
import { createMitmproxyProvider } from "./create-mitmproxy-provider.js";
import { createPiAgentProvider } from "./create-pi-agent-provider.js";
import { createVscodeProvider, resolveVscodeSettingsPathOption } from "./create-vscode-provider.js";

// One factory per provider (G11): each lives in its own module, so a
// composition root that imports one pulls in none of the others.
describe("per-provider factories", () => {
  it("builds each provider from injected paths", async () => {
    const vscode = createVscodeProvider({ sessionStoreDbPath: "/nonexistent/state.vscdb", debugLogsDirPaths: [], agentTracesDbPath: null });
    const mitmproxy = createMitmproxyProvider({ mitmproxyCapturesDirPath: null, appSettingsDir: "/nonexistent" });
    const piAgent = createPiAgentProvider({ piAgentSessionsDirPath: null, systemPromptLogPath: null });
    const claudeCode = createClaudeCodeProvider({ claudeCodeProjectsDirPath: null });

    expect([vscode.id, mitmproxy.id, piAgent.id, claudeCode.id]).toEqual(["vscode", "mitmproxy", "pi-agent", "claude-code"]);
    expect((await vscode.checkAvailability()).available).toBe(false);
  });

  describe("with an installed session store on this machine's default path", () => {
    let fakeHome: string | undefined;

    afterEach(() => {
      vi.unstubAllEnvs();
      if (fakeHome) rmSync(fakeHome, { recursive: true, force: true });
    });

    function installDefaultSessionStore(): void {
      fakeHome = mkdtempSync(path.join(tmpdir(), "provider-factories-home-"));
      const dir = path.join(fakeHome, ".config", "Code", "User", "globalStorage", "github.copilot-chat");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "session-store.db"), "");
      vi.stubEnv("HOME", fakeHome);
    }

    it("resolves the default when no session store path is given", async () => {
      installDefaultSessionStore();

      expect((await createVscodeProvider({ debugLogsDirPaths: [], agentTracesDbPath: null }).checkAvailability()).available).toBe(true);
    });

    it("keeps an explicit null session store path (the extension's 'none') rather than resolving the default", async () => {
      installDefaultSessionStore();

      expect(
        (await createVscodeProvider({ sessionStoreDbPath: null, debugLogsDirPaths: [], agentTracesDbPath: null }).checkAvailability()).available,
      ).toBe(false);
    });
  });

  it("keeps an explicit null settings path rather than resolving the default", () => {
    expect(resolveVscodeSettingsPathOption(null)).toBeNull();
    expect(resolveVscodeSettingsPathOption(path.join("/x", "settings.json"))).toBe(path.join("/x", "settings.json"));
  });
});
