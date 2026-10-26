// The extension's real webview build (media/) in headless Chromium, answered
// by the real MessageDispatcher and ApiService over a seeded Copilot Chat
// fixture, with a VS Code theme's variables and default webview styles
// (step 10.11). Run through tsx: it imports TypeScript sources.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createExtensionApiService } from "../../../server/src/composition/create-extension-api-service.ts";
import { JsoncFileSettingsSource } from "../../../server/src/data-sources/vscode-settings/jsonc-file-settings-source.ts";
import { copilotLogPathsFromUserDataDir } from "../../src/platform/copilot-log-paths.ts";
import { MessageDispatcher } from "../../src/rpc/message-dispatcher.ts";
import { createIntegrationFixture } from "../integration-fixture.mts";
import { webviewDefaultCss, type VscodeTheme } from "./vscode-themes.mts";

const extensionDir = path.resolve(import.meta.dirname, "../..");
const mediaDir = path.join(extensionDir, "media");

// A system prompt shaped like Copilot Chat's: tagged sections the inspector
// colours, long wrapped lines and one unbreakable token.
const SYSTEM_PROMPT = [
  "You are an expert AI programming assistant, working with a user in the VS Code editor.",
  "When asked for your name, you must respond with \"GitHub Copilot\". Follow the user's requirements carefully & to the letter.",
  "<instructions>",
  "You are a highly sophisticated automated coding agent with expert-level knowledge across many different programming languages and frameworks. The user will ask a question, or ask you to perform a task, and it may require lots of research to answer correctly.",
  "<context>If you can infer the project type (languages, frameworks, and libraries) from the user's query or the context that you have, keep them in mind when making changes.</context>",
  "</instructions>",
  "<toolUseInstructions>",
  "When using a tool, follow the json schema very carefully and make sure to include ALL required properties. NEVER say the name of a tool to a user.",
  "</toolUseInstructions>",
  "<editFileInstructions>",
  "Don't try to edit an existing file without reading it first, so you can make changes properly. Group your changes by file.",
  "</editFileInstructions>",
  "<outputFormatting>",
  "Use proper Markdown formatting in your answers. When referring to a filename or symbol in the user's workspace, wrap it in backticks.",
  "</outputFormatting>",
  "<reminderInstructions>Keep going until the user's query is completely resolved.</reminderInstructions>",
  "<custom_instructions>",
  "Follow the repository's CLAUDE.md. A_very_long_unbroken_identifier_to_check_wrapping_in_narrow_panels_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "</custom_instructions>",
  "<skills><skill><name>troubleshoot</name></skill></skills>",
  "<memories>Prefer small PRs.</memories>",
].join("\n");

export interface Harness {
  usageSessionId: string;
  open(theme: VscodeTheme, width: number, height?: number): Promise<Page>;
  postHostEvent(page: Page, name: string, payload?: unknown): Promise<void>;
  // Resolves once no webview request has been in flight for a moment, and
  // React has painted what they returned.
  settle(page: Page): Promise<void>;
  close(): Promise<void>;
}

export interface SeededUserData {
  userDataDir: string;
  // The session the scenarios open.
  usageSessionId: string;
}

export interface HarnessOptions {
  // Seeds a VS Code user-data dir under rootDir; the UI check's fixture by default.
  seed?: (rootDir: string) => SeededUserData;
  // 2 for sharp screenshots; 1 by default.
  deviceScaleFactor?: number;
}

// The integration fixture, plus a system prompt for the inspector scenarios.
function seedUiCheckFixture(rootDir: string): SeededUserData {
  const fixture = createIntegrationFixture(rootDir, { sessionCount: 40 });
  const debugDir = path.join(
    fixture.userDataDir,
    "User/workspaceStorage/integration-workspace/GitHub.copilot-chat/debug-logs",
    fixture.usageSessionId,
  );
  writeFileSync(
    path.join(debugDir, "system_prompt_0.json"),
    JSON.stringify({ content: JSON.stringify([{ type: "text", content: SYSTEM_PROMPT }]) }),
  );
  return fixture;
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  if (!existsSync(path.join(mediaDir, "index.html"))) {
    throw new Error("media/ is not built: run `npm run build --workspace=packages/vscode-extension` first");
  }
  const root = mkdtempSync(path.join(os.tmpdir(), "ui-check-"));
  const fixture = (options.seed ?? seedUiCheckFixture)(root);

  const logPaths = copilotLogPathsFromUserDataDir(fixture.userDataDir);
  let activeProviderId: string | undefined;
  let threshold: number | undefined;
  const api = createExtensionApiService({
    ...logPaths,
    debugLogsDirPaths: () => logPaths.debugLogsDirPaths,
    appSettings: {
      readActiveProviderId: () => activeProviderId,
      writeActiveProviderId: (value: string) => {
        activeProviderId = value;
      },
      readMinRetainedSessionLogsThreshold: () => threshold,
      writeMinRetainedSessionLogsThreshold: (value: number) => {
        threshold = value;
      },
    },
    settingsSource: new JsoncFileSettingsSource(logPaths.vscodeSettingsPath),
    learnScenariosFixturesDir: path.join(mediaDir, "learn-scenarios"),
    appVersion: "0.0.0-ui-check",
  });
  // Host commands (open a setting, the clipboard, an editor tab) only act on
  // VS Code, so here they simply succeed.
  const dispatcher = new MessageDispatcher(api, {
    hostCommands: { handle: async ({ id }) => ({ kind: "response", id, ok: true, result: null }) },
  });

  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const file = path.join(mediaDir, pathname === "/" ? "index.html" : pathname);
    if (!file.startsWith(mediaDir) || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    const type = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json" }[
      path.extname(file)
    ];
    response.writeHead(200, { "content-type": type ?? "application/octet-stream" }).end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const browser: Browser = await chromium.launch();
  let inFlight = 0;
  async function settle(page: Page): Promise<void> {
    for (let quietFor = 0, waited = 0; quietFor < 300 && waited < 15_000; waited += 50) {
      await page.waitForTimeout(50);
      quietFor = inFlight === 0 ? quietFor + 50 : 0;
    }
  }

  return {
    usageSessionId: fixture.usageSessionId,
    async open(theme, width, height = 900) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: options.deviceScaleFactor ?? 1 });
      page.on("pageerror", (error) => console.error(`page error: ${error.message}`));
      await page.exposeFunction("__toHost", async (message: unknown) => {
        inFlight += 1;
        try {
          const reply = await dispatcher.dispatch(message);
          if (reply) await page.evaluate(`window.postMessage(${JSON.stringify(reply)}, "*")`);
        } finally {
          inFlight -= 1;
        }
      });
      // A string, not a function: the transpiler's helpers don't exist in the page.
      await page.addInitScript(`
        window.acquireVsCodeApi = () => ({
          postMessage: (message) => window.__toHost(message),
          getState: () => undefined,
          setState: () => undefined,
        });
        document.addEventListener("DOMContentLoaded", () => {
          document.body.classList.add(${JSON.stringify(theme.bodyClass)});
          const style = document.createElement("style");
          style.textContent = ${JSON.stringify(webviewDefaultCss(theme))};
          document.head.prepend(style);
        });`);
      await page.goto(`http://127.0.0.1:${port}/`);
      await settle(page);
      return page;
    },
    async postHostEvent(page, name, payload) {
      await page.evaluate(`window.postMessage(${JSON.stringify({ kind: "event", name, payload })}, "*")`);
      await settle(page);
    },
    settle,
    async close() {
      await browser.close();
      server.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
