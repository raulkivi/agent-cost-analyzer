import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { extensionBundleOptions } from "../scripts/esbuild-options.mts";

const learnFixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../server/fixtures/learn-scenarios",
);

// A stand-in `vscode` module, resolved by the bundle from the temp install's
// node_modules: just what activation and the panel touch.
const VSCODE_STUB = `
const commands = new Map();
const panels = [];
class Uri { constructor(fsPath) { this.fsPath = fsPath; } static file(p) { return new Uri(p); } }
const settings = {};
const configListeners = new Set();
const executed = [];
const clipboard = [];
const documents = [];
const shown = [];
module.exports = {
  __commands: commands, __panels: panels, __settings: settings, Uri, ViewColumn: { Active: -1 },
  __executed: executed, __clipboard: clipboard, __documents: documents, __shown: shown,
  __changeConfiguration(ids) {
    const event = { affectsConfiguration: (section) => ids.some((id) => id === section || id.startsWith(section + ".")) };
    for (const listener of [...configListeners]) listener(event);
  },
  env: { clipboard: { writeText(text) { clipboard.push(text); return Promise.resolve(); } } },
  workspace: {
    getConfiguration: () => ({ get: (id) => settings[id] }),
    openTextDocument(options) { const document = { ...options }; documents.push(document); return Promise.resolve(document); },
    onDidChangeConfiguration(listener) { configListeners.add(listener); return { dispose() { configListeners.delete(listener); } }; },
  },
  commands: {
    registerCommand(id, fn) { commands.set(id, fn); return { dispose() { commands.delete(id); } }; },
    executeCommand(id, ...args) { executed.push([id, ...args]); return Promise.resolve(); },
  },
  window: {
    showTextDocument(document) { shown.push(document); return Promise.resolve({}); },
    createWebviewPanel(viewType, title, column, options) {
      let onMessage;
      const panel = {
        options, posted: [],
        webview: {
          cspSource: "vscode-webview://stub", html: "",
          asWebviewUri(uri) { return { toString: () => "vscode-webview://stub" + uri.fsPath }; },
          postMessage(message) { panel.posted.push(message); return Promise.resolve(true); },
          onDidReceiveMessage(listener) { onMessage = listener; return { dispose() {} }; },
        },
        reveal() {}, onDidDispose() { return { dispose() {} }; }, dispose() {},
        send(message) { onMessage(message); },
      };
      panels.push(panel);
      return panel;
    },
  },
};
`;

interface Posted {
  kind: string;
  id?: string;
  name?: string;
  ok?: boolean;
  result?: unknown;
  error?: { status: number };
}

interface StubPanel {
  options: unknown;
  posted: Posted[];
  webview: { html: string };
  send(message: unknown): void;
}

interface VscodeStub {
  __commands: Map<string, () => void>;
  __panels: StubPanel[];
  __settings: Record<string, unknown>;
  __executed: unknown[][];
  __clipboard: string[];
  __documents: { content: string; language: string }[];
  __shown: unknown[];
  __changeConfiguration(ids: string[]): void;
}

// Loads the real bundle as VS Code would (CommonJS require, `vscode` from
// the host), from a temp install laid out like the .vsix: dist/, media/
// with a manifest and the learn fixtures. Catches what the type checker
// can't, e.g. a dependency whose dynamic require() esbuild can't follow.
describe("the built extension bundle", () => {
  let installDir: string;
  let userDataDir: string;
  let vscode: VscodeStub;
  let subscriptions: { dispose(): void }[];
  let globalState: Map<string, unknown>;

  beforeAll(async () => {
    installDir = mkdtempSync(path.join(tmpdir(), "ai-credits-analyzer-install-"));
    await build({ ...extensionBundleOptions(path.join(installDir, "dist")), logLevel: "silent" });
    mkdirSync(path.join(installDir, "node_modules", "vscode"), { recursive: true });
    writeFileSync(path.join(installDir, "node_modules", "vscode", "index.js"), VSCODE_STUB);
    mkdirSync(path.join(installDir, "media"));
    writeFileSync(
      path.join(installDir, "media", "manifest.json"),
      JSON.stringify({ "index.html": { file: "assets/index.js", isEntry: true, css: ["assets/index.css"] } }),
    );
    // VS Code's user-data dir with a Copilot Chat session store, laid out as
    // <userData>/User/globalStorage/<extension-id>; only globalStorageUri
    // tells the extension where it is.
    userDataDir = path.join(installDir, "user-data");
    const copilotStorage = path.join(userDataDir, "User", "globalStorage", "github.copilot-chat");
    mkdirSync(copilotStorage, { recursive: true });
    writeFileSync(path.join(copilotStorage, "session-store.db"), "");
    cpSync(learnFixturesDir, path.join(installDir, "media", "learn-scenarios"), { recursive: true });

    const requireFromInstall = createRequire(path.join(installDir, "package.json"));
    vscode = requireFromInstall("vscode") as VscodeStub;
    const extension = requireFromInstall("./dist/extension.js") as {
      activate(context: unknown): void;
    };
    subscriptions = [];
    globalState = new Map();
    extension.activate({
      extensionPath: installDir,
      globalStorageUri: { fsPath: path.join(userDataDir, "User", "globalStorage", "raulkivi.ai-credits-analyzer") },
      globalState: {
        get: (key: string) => globalState.get(key),
        update: async (key: string, value: unknown) => void globalState.set(key, value),
      },
      subscriptions,
      extension: { packageJSON: { version: "0.1.0" } },
    });
  }, 60_000);

  afterAll(() => {
    for (const subscription of subscriptions ?? []) subscription.dispose();
    rmSync(installDir, { recursive: true, force: true });
  });

  it("activates and opens one panel with the CSP page", () => {
    vscode.__commands.get("aiCreditsAnalyzer.open")?.();

    expect(vscode.__panels).toHaveLength(1);
    expect(vscode.__panels[0]?.webview.html).toContain("connect-src 'none'");
  });

  it("serves Learn mode over the message bridge", async () => {
    const panel = vscode.__panels[0]!;

    panel.send({ kind: "request", id: "learn", method: "listLearnScenarios" });
    await expect.poll(() => panel.posted.find((reply) => reply.id === "learn")).toBeDefined();

    const reply = panel.posted.find((r) => r.id === "learn");
    expect(reply?.ok).toBe(true);
    expect((reply?.result as unknown[]).length).toBeGreaterThan(0);
  });

  async function send(message: { kind: string; id: string; [key: string]: unknown }): Promise<Posted> {
    const panel = vscode.__panels[0]!;
    panel.send(message);
    await expect.poll(() => panel.posted.find((reply) => reply.id === message.id)).toBeDefined();
    return panel.posted.find((reply) => reply.id === message.id)!;
  }

  async function call(method: string, params?: unknown): Promise<Posted> {
    const panel = vscode.__panels[0]!;
    const id = `${method}-${panel.posted.length}`;
    panel.send({ kind: "request", id, method, params });
    await expect.poll(() => panel.posted.find((reply) => reply.id === id)).toBeDefined();
    return panel.posted.find((reply) => reply.id === id)!;
  }

  it("answers invalid params with 400", async () => {
    const reply = await call("getSession", { id: 7 });

    expect(reply).toMatchObject({ ok: false, error: { status: 400 } });
  });

  it("finds the Copilot session store under the user-data dir derived from globalStorageUri (D4)", async () => {
    const reply = await call("getLogProviderStatus");

    const status = reply.result as { providers: { id: string; available: boolean }[] };
    expect(status.providers).toEqual([expect.objectContaining({ id: "vscode", available: true })]);
  });

  it("judges the effective VS Code settings, including later changes (G6)", async () => {
    vscode.__settings["github.copilot.chat.agentDebugLog.fileLogging.enabled"] = true;
    vscode.__settings["github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs"] = 200;
    vscode.__settings["github.copilot.chat.otel.dbSpanExporter.enabled"] = true;
    expect((await call("getConfigStatus")).result).toMatchObject({ warnings: [], loggingEnabled: true });

    vscode.__settings["github.copilot.chat.agentDebugLog.fileLogging.enabled"] = false;

    expect((await call("getConfigStatus")).result).toMatchObject({ loggingEnabled: false });
  });

  it("keeps the retention threshold in globalState (D5)", async () => {
    await call("setRetentionThreshold", { value: 300 });

    expect(globalState.get("aiCreditsAnalyzer.minRetainedSessionLogsThreshold")).toBe(300);
  });

  it("posts a configChanged event to the open panel when a watched Copilot setting changes", () => {
    const panel = vscode.__panels[0]!;
    panel.posted.length = 0;

    vscode.__changeConfiguration(["editor.fontSize"]);
    expect(panel.posted).toEqual([]);

    vscode.__changeConfiguration(["github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs"]);
    expect(panel.posted).toEqual([{ kind: "event", name: "configChanged" }]);
  });

  describe("host commands (G8)", () => {
    it("opens the Settings editor on a logging-disabled warning's setting (the Fix button)", async () => {
      vscode.__settings["github.copilot.chat.agentDebugLog.fileLogging.enabled"] = false;

      const reply = await send({
        kind: "command",
        id: "fix-logging",
        command: "openSetting",
        args: { settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled" },
      });

      expect(reply).toEqual({ kind: "response", id: "fix-logging", ok: true });
      expect(vscode.__executed).toContainEqual([
        "workbench.action.openSettings",
        "github.copilot.chat.agentDebugLog.fileLogging.enabled",
      ]);
    });

    it("rejects a setting id that no warning names with 400, and runs nothing", async () => {
      const before = vscode.__executed.length;

      const reply = await send({
        kind: "command",
        id: "fix-other",
        command: "openSetting",
        args: { settingId: "terminal.integrated.shellArgs.linux" },
      });

      expect(reply).toMatchObject({ ok: false, error: { status: 400 } });
      expect(vscode.__executed).toHaveLength(before);
    });

    it("opens a setting only a current warning names, and only while it does", async () => {
      const openAgentTraces = (id: string) =>
        send({ kind: "command", id, command: "openSetting", args: { settingId: "github.copilot.chat.otel.dbSpanExporter.enabled" } });

      vscode.__settings["github.copilot.chat.otel.dbSpanExporter.enabled"] = false;
      expect(await openAgentTraces("traces-warned")).toMatchObject({ ok: true });

      vscode.__settings["github.copilot.chat.otel.dbSpanExporter.enabled"] = true;
      expect(await openAgentTraces("traces-fixed")).toMatchObject({ ok: false, error: { status: 400 } });
    });

    it("copies to VS Code's clipboard and opens text in an untitled editor", async () => {
      expect(await send({ kind: "command", id: "copy", command: "copyToClipboard", args: { text: "bundle" } })).toMatchObject({
        ok: true,
      });
      expect(
        await send({ kind: "command", id: "doc", command: "openTextDocument", args: { content: "prompt", language: "plaintext" } }),
      ).toMatchObject({ ok: true });

      expect(vscode.__clipboard).toEqual(["bundle"]);
      expect(vscode.__documents).toEqual([{ content: "prompt", language: "plaintext" }]);
      expect(vscode.__shown).toEqual(vscode.__documents);
    });

    it("rejects a command that isn't on the allow-list with 400", async () => {
      const reply = await send({ kind: "command", id: "shell", command: "executeCommand", args: { id: "workbench.action.terminal.new" } });

      expect(reply).toMatchObject({ ok: false, error: { status: 400 } });
    });
  });
});
