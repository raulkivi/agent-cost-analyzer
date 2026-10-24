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
module.exports = {
  __commands: commands, __panels: panels, Uri, ViewColumn: { Active: -1 },
  commands: { registerCommand(id, fn) { commands.set(id, fn); return { dispose() { commands.delete(id); } }; } },
  window: {
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

interface StubPanel {
  options: unknown;
  posted: { id: string; ok: boolean; result?: unknown }[];
  webview: { html: string };
  send(message: unknown): void;
}

interface VscodeStub {
  __commands: Map<string, () => void>;
  __panels: StubPanel[];
}

// Loads the real bundle as VS Code would (CommonJS require, `vscode` from
// the host), from a temp install laid out like the .vsix: dist/, media/
// with a manifest and the learn fixtures. Catches what the type checker
// can't, e.g. a dependency whose dynamic require() esbuild can't follow.
describe("the built extension bundle", () => {
  let installDir: string;
  let vscode: VscodeStub;
  let subscriptions: { dispose(): void }[];

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
    cpSync(learnFixturesDir, path.join(installDir, "media", "learn-scenarios"), { recursive: true });

    const requireFromInstall = createRequire(path.join(installDir, "package.json"));
    vscode = requireFromInstall("vscode") as VscodeStub;
    const extension = requireFromInstall("./dist/extension.js") as {
      activate(context: unknown): void;
    };
    subscriptions = [];
    extension.activate({
      extensionPath: installDir,
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
});
