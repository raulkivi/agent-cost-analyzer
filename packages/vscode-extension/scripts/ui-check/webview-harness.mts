// The extension's real webview build (media/) in headless Chromium, answered
// by the real MessageDispatcher and ApiService over a seeded Copilot Chat
// fixture, with a VS Code theme's variables and default webview styles
// (step 10.11). Run through tsx: it imports TypeScript sources.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import type { ConfigWarning } from "@agent-cost-analyzer/domain";
import { chromium, type Browser, type Page } from "playwright";
import { createExtensionApiService } from "../../../server/src/composition/create-extension-api-service.ts";
import { JsoncFileSettingsSource } from "../../../server/src/data-sources/vscode-settings/jsonc-file-settings-source.ts";
import { copilotLogPathsFromUserDataDir } from "../../src/platform/copilot-log-paths.ts";
import { MessageDispatcher } from "../../src/rpc/message-dispatcher.ts";
import {
  COPILOT_CLI_FIXTURE_HOME,
  COPILOT_CLI_FIXTURE_SESSION_IDS,
  writeCopilotCliAgentHostStores,
} from "../../../server/src/test-support/copilot-cli-fixtures.ts";
import { sampleCostComparison, sampleCostSeries, sampleCostVariance, sampleProjectCost, THREE_PROJECTS } from "../../../web/src/test-support/cost-fixture.ts";
import { sampleStatement } from "../../../web/src/test-support/statement-sample.ts";
import { diffStatements } from "@agent-cost-analyzer/domain";
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
  // VS Code Agent Host sessions (steps 10.13, 10.14), when the seed has them:
  // one whose Copilot CLI event log is read, one whose log is missing.
  agentHostSessionId?: string;
  agentHostMissingLogSessionId?: string;
  // Step 10.15: one whose log's per-call usage records fill Cache write and Reasoning.
  agentHostUsageRecordsSessionId?: string;
  open(theme: VscodeTheme, width: number, height?: number, options?: OpenOptions): Promise<Page>;
  postHostEvent(page: Page, name: string, payload?: unknown): Promise<void>;
  // Resolves once no webview request has been in flight for a moment, and
  // React has painted what they returned.
  settle(page: Page): Promise<void>;
  close(): Promise<void>;
}

export interface OpenOptions {
  // Replaces the config check's warnings, to show the banner (the seeded
  // fixture has none).
  configWarnings?: ConfigWarning[];
  // Step 15.9: the Dashboard's cost tabs, which the extension hides until
  // step 15.14 (no cost routes yet). For the layout and contrast check the
  // page gets a profile with costAnalysis on, the cost methods answer the
  // web package's sample series and comparison, and the Copilot turns are
  // spread over the sample's three projects so the tabs have something to
  // compare. Sample data only.
  costTabs?: boolean;
}

export interface SeededUserData {
  userDataDir: string;
  // The session the scenarios open.
  usageSessionId: string;
  agentHostSessionId?: string;
  agentHostMissingLogSessionId?: string;
  agentHostUsageRecordsSessionId?: string;
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
  // The Copilot CLI fixtures' Agent Host sessions; COPILOT_CLI_FIXTURE_HOME
  // (passed as the Copilot home below) holds their event logs.
  writeCopilotCliAgentHostStores(fixture.userDataDir);
  return {
    ...fixture,
    agentHostSessionId: COPILOT_CLI_FIXTURE_SESSION_IDS.normal,
    agentHostMissingLogSessionId: COPILOT_CLI_FIXTURE_SESSION_IDS.missingLog,
    agentHostUsageRecordsSessionId: COPILOT_CLI_FIXTURE_SESSION_IDS.usageRecords,
  };
}

const COST_PROJECTS = THREE_PROJECTS.map((project) => ({ id: project.key!, name: project.label }));

function billingAnswer() {
  const issued = sampleStatement({ status: "issued", issuedAt: "2026-11-02T09:00:00.000Z" });
  const rerun = sampleStatement({ lines: [{ ...issued.lines[0]!, amount: 150 }], totals: [{ currency: "AI_CREDITS", lines: 150, markup: 12, fixed: 0, total: 162 }, issued.totals[1]!] });
  return { statement: issued, rerun, diff: diffStatements(issued, rerun), canIssue: { ok: false, reason: "Already issued." }, issuedPeriods: ["2026-09", "2026-10"] };
}

const PROJECTS_STATE = {
  status: "valid",
  file: {
    version: 1,
    projects: [
      { id: COST_PROJECTS[0]!.id, name: COST_PROJECTS[0]!.name, client: "ACME", members: [{ repository: "github.com/acme/portal-web" }, { repository: "github.com/acme/infra", branches: ["portal/*"] }], rates: { markupPercent: 10, fixedLines: [{ label: "Seats", amount: 39, currency: "USD" }], currency: { code: "EUR", perUsd: 0.92 } } },
      { id: COST_PROJECTS[1]!.id, name: COST_PROJECTS[1]!.name, members: [{ repository: "github.com/acme/billing" }, { repository: "github.com/acme/infra", branches: ["portal/*"] }] },
    ],
    aliases: {},
    captureRules: [],
  },
  problems: [],
  location: "/home/dev/.config/agent-cost-analyzer/projects.json",
};

const REPOSITORY_LIST = {
  repositories: ["github.com/acme/portal-web", "github.com/acme/billing", "github.com/acme/infra", "github.com/acme/mobile-app", "github.com/acme/data-platform-with-a-long-name"].map((key, index) => ({
    key,
    source: "git-remote",
    sessionCount: 10 - index,
    turnCount: 40,
    aiCredits: { value: 100, knownSessions: 1, sessions: 1 },
    providerIds: ["vscode"],
    projectIds: [],
    lastUsedAt: "2026-10-20T10:00:00.000Z",
  })),
  unattributed: [{ reason: "mitmproxy captures record no working folder.", sessionCount: 41, turnCount: 90, aiCredits: { value: null, knownSessions: 0, sessions: 41 }, providerIds: ["mitmproxy"] }],
  providers: [],
};

function withCostTabs(reply: unknown, request: unknown, enabled: boolean | undefined): unknown {
  const method = (request as { method?: string } | null)?.method;
  const id = (request as { id?: string } | null)?.id;
  if (!enabled || !method) return reply;
  if (method === "getCostTimeSeries") return { kind: "response", id, ok: true, result: sampleCostSeries() };
  if (method === "getCostComparison") return { kind: "response", id, ok: true, result: sampleCostComparison() };
  // Step 15.10: the Project tab.
  if (method === "getProjectCost") return { kind: "response", id, ok: true, result: sampleProjectCost() };
  if (method === "getCostVariance") return { kind: "response", id, ok: true, result: sampleCostVariance() };
  // Step 15.11: the Billing tab (an issued statement whose re-run differs) and the Projects editor.
  if (method === "getStatement") return { kind: "response", id, ok: true, result: billingAnswer() };
  if (method === "getProjects") return { kind: "response", id, ok: true, result: PROJECTS_STATE };
  if (method === "getRepositoryList") return { kind: "response", id, ok: true, result: REPOSITORY_LIST };
  const answer = reply as { ok?: boolean; result?: Record<string, unknown> } | undefined;
  if (!answer?.ok || !answer.result) return reply;
  if (method === "getProductProfile") {
    const profile = answer.result as { features: Record<string, boolean> };
    return { ...answer, result: { ...profile, features: { ...profile.features, costAnalysis: true } } };
  }
  if (method === "getInsights") {
    const dataset = answer.result as { turns: { projectId?: string | null }[] };
    return {
      ...answer,
      result: {
        ...dataset,
        projects: COST_PROJECTS,
        turns: dataset.turns.map((turn, index) => ({ ...turn, projectId: COST_PROJECTS[index % COST_PROJECTS.length]!.id })),
      },
    };
  }
  return reply;
}

function withConfigWarnings(reply: unknown, request: unknown, warnings: ConfigWarning[] | undefined): unknown {
  const asksConfigStatus = (request as { method?: string } | null)?.method === "getConfigStatus";
  const answer = reply as { ok?: boolean; result?: object } | undefined;
  if (!warnings || !asksConfigStatus || !answer?.ok) return reply;
  return { ...answer, result: { ...answer.result, warnings } };
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
    copilotHome: COPILOT_CLI_FIXTURE_HOME,
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
    learnScriptsDir: path.join(mediaDir, "learn-scripts"),
    vendorProfilesDir: path.join(mediaDir, "vendor-profiles"),
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
  // PLAYWRIGHT_CHROMIUM_EXECUTABLE: a pre-installed Chromium other than the
  // build this Playwright downloads (CI installs that one).
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser: Browser = await chromium.launch(executablePath ? { executablePath } : {});
  let inFlight = 0;
  async function settle(page: Page): Promise<void> {
    for (let quietFor = 0, waited = 0; quietFor < 300 && waited < 15_000; waited += 50) {
      await page.waitForTimeout(50);
      quietFor = inFlight === 0 ? quietFor + 50 : 0;
    }
  }

  return {
    usageSessionId: fixture.usageSessionId,
    agentHostSessionId: fixture.agentHostSessionId,
    agentHostMissingLogSessionId: fixture.agentHostMissingLogSessionId,
    agentHostUsageRecordsSessionId: fixture.agentHostUsageRecordsSessionId,
    async open(theme, width, height = 900, openOptions = {}) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: options.deviceScaleFactor ?? 1 });
      page.on("pageerror", (error) => console.error(`page error: ${error.message}`));
      await page.exposeFunction("__toHost", async (message: unknown) => {
        inFlight += 1;
        try {
          const answered = openOptions.costTabs && /getCost|getProjectCost|getStatement|getProjects|getRepositoryList/.test(String((message as { method?: string }).method)) ? undefined : await dispatcher.dispatch(message);
          const reply = withCostTabs(withConfigWarnings(answered, message, openOptions.configWarnings), message, openOptions.costTabs);
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
