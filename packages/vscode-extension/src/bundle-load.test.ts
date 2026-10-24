import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { extensionBundleOptions } from "../scripts/esbuild-options.mts";
import { COMMAND_IDS, VIEW_IDS } from "./commands/command-ids.js";

const serverFixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/fixtures");
const learnFixturesDir = path.join(serverFixturesDir, "learn-scenarios");
// A real main.jsonl with AI Credits numbers; its session id seeds the store.
const USAGE_SESSION_ID = "1c7604a0-1488-4b5d-880a-f80fd693475e";
const usageMainJsonl = path.join(serverFixturesDir, "jsonl", "real-session-with-usage.jsonl");

// The session store's tables, as Copilot Chat creates them (enough for the
// provider's queries).
const SESSION_STORE_SCHEMA = `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, branch TEXT, host_type TEXT,
    summary TEXT, agent_name TEXT, agent_description TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, turn_index INTEGER NOT NULL,
    user_message TEXT, assistant_response TEXT, timestamp TEXT
  );
  CREATE TABLE checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, checkpoint_number INTEGER NOT NULL,
    title TEXT, overview TEXT, history TEXT, work_done TEXT, technical_details TEXT,
    important_files TEXT, next_steps TEXT, created_at TEXT
  );
  CREATE TABLE session_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, file_path TEXT NOT NULL,
    tool_name TEXT, turn_index INTEGER, first_seen_at TEXT
  );
`;

function seedSessionStore(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec(SESSION_STORE_SCHEMA);
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO sessions (id, cwd, repository, branch, host_type, summary, agent_name, agent_description, created_at, updated_at) VALUES (?, '/repo', 'org/repo', 'main', 'desktop', 'Fix the bug', 'GitHub Copilot Chat', 'chat', ?, ?)",
  ).run(USAGE_SESSION_ID, now, now);
  db.prepare("INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, 0, 'hi', 'hello', ?)").run(
    USAGE_SESSION_ID,
    now,
  );
  db.close();
}

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
const treeViews = new Map();
const statusBarItems = [];
const progress = [];
class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } }
class ThemeIcon { constructor(id) { this.id = id; } }
class ThemeColor { constructor(id) { this.id = id; } }
class EventEmitter {
  constructor() { this.listeners = new Set(); this.event = (fn) => { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; }; }
  fire(event) { for (const fn of [...this.listeners]) fn(event); }
  dispose() { this.listeners.clear(); }
}
module.exports = {
  TreeItem, ThemeIcon, ThemeColor, EventEmitter,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  __treeViews: treeViews, __statusBarItems: statusBarItems, __progress: progress,
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
    createTreeView(viewId, options) {
      const visibility = new EventEmitter();
      treeViews.set(viewId, { provider: options.treeDataProvider, setVisible: (visible) => visibility.fire({ visible }) });
      return { onDidChangeVisibility: visibility.event, dispose() { treeViews.delete(viewId); } };
    },
    createStatusBarItem(alignment, priority) {
      const item = {
        alignment, priority, text: "", visible: false,
        show() { item.visible = true; }, hide() { item.visible = false; },
        dispose() { statusBarItems.splice(statusBarItems.indexOf(item), 1); },
      };
      statusBarItems.push(item);
      return item;
    },
    withProgress(options, task) { progress.push(options); return Promise.resolve(task()); },
    createWebviewPanel(viewType, title, column, options) {
      let onMessage;
      let onViewState;
      let onDispose;
      const panel = {
        options, posted: [],
        webview: {
          cspSource: "vscode-webview://stub", html: "",
          asWebviewUri(uri) { return { toString: () => "vscode-webview://stub" + uri.fsPath }; },
          postMessage(message) { panel.posted.push(message); return Promise.resolve(true); },
          onDidReceiveMessage(listener) { onMessage = listener; return { dispose() {} }; },
        },
        reveal() {},
        onDidChangeViewState(listener) { onViewState = listener; return { dispose() {} }; },
        onDidDispose(listener) { onDispose = listener; return { dispose() {} }; },
        dispose() { if (onDispose) onDispose(); },
        setVisible(visible) { onViewState({ webviewPanel: { visible } }); },
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
  dispose(): void;
}

interface StubTreeNode {
  kind: string;
  [key: string]: unknown;
}

interface StubTreeView {
  provider: {
    getChildren(element?: unknown): StubTreeNode[];
    getTreeItem(element: unknown): { label: string; description?: string; collapsibleState: number };
  };
  setVisible(visible: boolean): void;
}

interface StubStatusBarItem {
  text: string;
  visible: boolean;
  command?: string;
  backgroundColor?: { id: string };
}

interface VscodeStub {
  __commands: Map<string, (...args: unknown[]) => unknown>;
  __treeViews: Map<string, StubTreeView>;
  __statusBarItems: StubStatusBarItem[];
  __progress: { location: { viewId: string } }[];
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
    seedSessionStore(path.join(copilotStorage, "session-store.db"));
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

  describe("sidebar, status bar and selection sync (D10)", () => {
    const LOGGING = "github.copilot.chat.agentDebugLog.fileLogging.enabled";
    const RETENTION = "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs";

    const view = (id: string) => vscode.__treeViews.get(id)!;
    // Every session row under every group of the Sessions view.
    const sessionRows = () =>
      view(VIEW_IDS.sessions)
        .provider.getChildren()
        .flatMap((group) => view(VIEW_IDS.sessions).provider.getChildren(group))
        .map((node) => view(VIEW_IDS.sessions).provider.getTreeItem(node));

    it("registers every contributed command, both views and the status bar item", () => {
      expect([...vscode.__commands.keys()].sort()).toEqual(Object.values(COMMAND_IDS).sort());
      expect([...vscode.__treeViews.keys()].sort()).toEqual(Object.values(VIEW_IDS).sort());
      expect(vscode.__statusBarItems).toHaveLength(1);
    });

    it("lists the session store's sessions in the Sessions view from the first read, with its cost unknown", async () => {
      await expect.poll(() => sessionRows().length).toBe(1);

      expect(sessionRows()[0]).toMatchObject({ label: "Fix the bug", description: "AI Credits unknown" });
    });

    it("shows a Setup row and 'setup needed' in the status bar while a required setting is off, and clears both when fixed", async () => {
      vscode.__settings[LOGGING] = false;
      vscode.__settings[RETENTION] = 300; // the threshold an earlier test saved
      vscode.__settings["github.copilot.chat.otel.dbSpanExporter.enabled"] = true;
      vscode.__changeConfiguration([LOGGING]);

      await expect.poll(() => view(VIEW_IDS.setup).provider.getChildren().length).toBe(1);
      const [node] = view(VIEW_IDS.setup).provider.getChildren();
      expect(view(VIEW_IDS.setup).provider.getTreeItem(node)).toMatchObject({ description: "Required" });
      const item = vscode.__statusBarItems[0]!;
      expect(item).toMatchObject({ visible: true, text: "$(warning) AI Credits: setup needed", command: "aiCreditsAnalyzer.setup.focus" });

      vscode.__settings[LOGGING] = true;
      vscode.__changeConfiguration([LOGGING]);

      await expect.poll(() => view(VIEW_IDS.setup).provider.getChildren().length).toBe(0);
      expect(item.text).toBe("$(graph) AI Credits: unknown"); // today has a session, but no known cost
      expect(item.command).toBe("aiCreditsAnalyzer.open");
    });

    it("refreshing re-lists the debug-logs folders, so a workspace first opened after activation is found", async () => {
      // The folder holding this session's main.jsonl didn't exist at activation.
      const sessionDir = path.join(
        userDataDir, "User", "workspaceStorage", "late-workspace", "GitHub.copilot-chat", "debug-logs", USAGE_SESSION_ID,
      );
      mkdirSync(sessionDir, { recursive: true });
      copyFileSync(usageMainJsonl, path.join(sessionDir, "main.jsonl"));
      expect(sessionRows()[0]?.description).toBe("AI Credits unknown");

      await vscode.__commands.get(COMMAND_IDS.refreshSessions)!();

      expect(sessionRows()[0]?.description).toMatch(/^\d+\.\d\d$/);
      expect(vscode.__statusBarItems[0]?.text).toMatch(/^\$\(graph\) \d+\.\d\d AI Credits today$/);
    });

    it("shows progress on the Sessions view while the Refresh command reads", () => {
      expect(vscode.__progress).toContainEqual(expect.objectContaining({ location: { viewId: VIEW_IDS.sessions } }));
    });

    it("refreshes when the Sessions view becomes visible", async () => {
      // The session's log goes away; the view only notices when shown again.
      rmSync(path.join(userDataDir, "User", "workspaceStorage", "late-workspace", "GitHub.copilot-chat", "debug-logs", USAGE_SESSION_ID), {
        recursive: true,
      });
      expect(sessionRows()[0]?.description).toMatch(/^\d+\.\d\d$/);

      view(VIEW_IDS.sessions).setVisible(true);

      await expect.poll(() => sessionRows()[0]?.description).toBe("AI Credits unknown");
    });

    it("selects a session in the already-open panel with a selectSession event", async () => {
      const panel = vscode.__panels[0]!;
      panel.posted.length = 0;

      await vscode.__commands.get(COMMAND_IDS.openSession)!("s1", { tab: "tools" });

      expect(vscode.__panels).toHaveLength(1);
      expect(panel.posted).toEqual([{ kind: "event", name: "selectSession", payload: { sessionId: "s1", tab: "tools" } }]);
    });

    it("holds selectSession for a panel opened by the command until its webview first talks to the host", async () => {
      vscode.__panels[0]!.dispose();

      await vscode.__commands.get(COMMAND_IDS.showToolAudit)!({ kind: "session", sessionId: "s2" });

      expect(vscode.__panels).toHaveLength(2);
      const panel = vscode.__panels[1]!;
      expect(panel.posted).toEqual([]);

      panel.send({ kind: "request", id: "first", method: "getHealth" });

      await expect.poll(() => panel.posted.some((message) => message.name === "selectSession")).toBe(true);
      expect(panel.posted.filter((message) => message.name === "selectSession")).toEqual([
        { kind: "event", name: "selectSession", payload: { sessionId: "s2", view: "session-audit" } },
      ]);
    });

    it("opens the debug-logging setting by default, and rejects a setting no warning names", async () => {
      const before = vscode.__executed.length;
      vscode.__settings[LOGGING] = false;

      await vscode.__commands.get(COMMAND_IDS.fixSetting)!();
      expect(vscode.__executed.slice(before)).toEqual([["workbench.action.openSettings", LOGGING]]);

      await expect(vscode.__commands.get(COMMAND_IDS.fixSetting)!("terminal.integrated.shellArgs.linux")).rejects.toThrow(
        /can't be opened/,
      );
      expect(vscode.__executed).toHaveLength(before + 1);
    });
  });
});
