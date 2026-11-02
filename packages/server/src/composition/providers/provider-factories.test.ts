import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClaudeCodeProvider } from "./create-claude-code-provider.js";
import { createMitmproxyProvider } from "./create-mitmproxy-provider.js";
import { createPiAgentProvider } from "./create-pi-agent-provider.js";
import { createVscodeProvider, resolveVscodeSettingsPathOption } from "./create-vscode-provider.js";
import { AGENT_HOST_FIXTURE_SESSION_IDS, writeAgentHostCatalog, writeAgentSessionDb } from "../../test-support/agent-host-user-data-dir.js";
import {
  COPILOT_CLI_FIXTURE_HOME,
  COPILOT_CLI_FIXTURE_SESSION_IDS,
  writeCopilotCliAgentHostStores,
} from "../../test-support/copilot-cli-fixtures.js";

// One factory per provider (G11): each lives in its own module, so a
// composition root that imports one pulls in none of the others.
describe("per-provider factories", () => {
  it("builds each provider from injected paths", async () => {
    const vscode = createVscodeProvider({
      sessionStoreDbPath: "/nonexistent/state.vscdb",
      debugLogsDirPaths: [],
      agentTracesDbPath: null,
      agentHostUserDataDir: null,
    });
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

      expect(
        (await createVscodeProvider({ debugLogsDirPaths: [], agentTracesDbPath: null, agentHostUserDataDir: null }).checkAvailability())
          .available,
      ).toBe(true);
    });

    it("keeps an explicit null session store path (the extension's 'none') rather than resolving the default", async () => {
      installDefaultSessionStore();

      expect(
        (
          await createVscodeProvider({
            sessionStoreDbPath: null,
            debugLogsDirPaths: [],
            agentTracesDbPath: null,
            agentHostUserDataDir: null,
          }).checkAvailability()
        ).available,
      ).toBe(false);
    });
  });

  // Step 10.13: Agent Host sessions, all paths derived from the user-data dir (D4).
  describe("Agent Host sessions", () => {
    let fakeHome: string | undefined;
    const classicNone = { sessionStoreDbPath: null, debugLogsDirPaths: [], agentTracesDbPath: null };

    afterEach(() => {
      vi.unstubAllEnvs();
      if (fakeHome) rmSync(fakeHome, { recursive: true, force: true });
      fakeHome = undefined;
    });

    // An Agent Host catalog in this machine's default (Stable, Linux-style) user-data dir.
    function installDefaultAgentHostCatalog(): string {
      fakeHome = mkdtempSync(path.join(tmpdir(), "provider-factories-agent-host-home-"));
      const userDataDir = path.join(fakeHome, ".config", "Code");
      writeAgentHostCatalog(userDataDir);
      writeAgentSessionDb(userDataDir, AGENT_HOST_FIXTURE_SESSION_IDS.withTurns);
      vi.stubEnv("HOME", fakeHome);
      return userDataDir;
    }

    it("lists the Agent Host sessions under an injected user-data dir", async () => {
      fakeHome = mkdtempSync(path.join(tmpdir(), "provider-factories-agent-host-"));
      writeAgentHostCatalog(fakeHome);
      writeAgentSessionDb(fakeHome, AGENT_HOST_FIXTURE_SESSION_IDS.withTurns);

      const sessions = await createVscodeProvider({ ...classicNone, agentHostUserDataDir: fakeHome }).listSessions();

      expect(sessions.map((session) => session.id)).toContain(AGENT_HOST_FIXTURE_SESSION_IDS.withTurns);
    });

    it.runIf(process.platform === "linux")("resolves the default user-data dir when none is given", async () => {
      installDefaultAgentHostCatalog();

      const provider = createVscodeProvider(classicNone);

      expect((await provider.checkAvailability()).available).toBe(true);
      expect((await provider.listSessions()).length).toBeGreaterThan(0);
    });

    it("keeps an explicit null user-data dir (the extension's 'none') rather than resolving the default", async () => {
      installDefaultAgentHostCatalog();

      const provider = createVscodeProvider({ ...classicNone, agentHostUserDataDir: null });

      expect((await provider.checkAvailability()).available).toBe(false);
      await expect(provider.listSessions()).resolves.toEqual([]);
    });
  });

  // Step 10.14: the Copilot CLI event log, under the Copilot home.
  describe("Copilot CLI event log", () => {
    let userDataDir: string;
    const classicNone = { sessionStoreDbPath: null, debugLogsDirPaths: [], agentTracesDbPath: null };

    beforeEach(() => {
      userDataDir = mkdtempSync(path.join(tmpdir(), "provider-factories-copilot-home-"));
      writeCopilotCliAgentHostStores(userDataDir);
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      rmSync(userDataDir, { recursive: true, force: true });
    });

    it("reads a session's event log under an injected Copilot home", async () => {
      const provider = createVscodeProvider({ ...classicNone, agentHostUserDataDir: userDataDir, copilotHome: COPILOT_CLI_FIXTURE_HOME });

      expect((await provider.readSession(COPILOT_CLI_FIXTURE_SESSION_IDS.normal))?.copilotEventLog).toEqual({ status: "read" });
    });

    it("resolves the Copilot home the way the CLI does when none is given", async () => {
      vi.stubEnv("COPILOT_HOME", COPILOT_CLI_FIXTURE_HOME);

      const provider = createVscodeProvider({ ...classicNone, agentHostUserDataDir: userDataDir });

      expect((await provider.readSession(COPILOT_CLI_FIXTURE_SESSION_IDS.normal))?.copilotEventLog).toEqual({ status: "read" });
    });

    it("keeps an explicit null Copilot home rather than resolving the default", async () => {
      vi.stubEnv("COPILOT_HOME", COPILOT_CLI_FIXTURE_HOME);

      const provider = createVscodeProvider({ ...classicNone, agentHostUserDataDir: userDataDir, copilotHome: null });

      expect((await provider.readSession(COPILOT_CLI_FIXTURE_SESSION_IDS.normal))?.copilotEventLog?.status).toBe("missing");
    });
  });

  it("keeps an explicit null settings path rather than resolving the default", () => {
    expect(resolveVscodeSettingsPathOption(null)).toBeNull();
    expect(resolveVscodeSettingsPathOption(path.join("/x", "settings.json"))).toBe(path.join("/x", "settings.json"));
  });
});
