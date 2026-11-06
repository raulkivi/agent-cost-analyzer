// The extension's UI check (step 10.11): every main view of the real webview
// build, in Dark Modern, Light Modern and High Contrast, at panel widths from
// a narrow split to a wide editor, must fit the panel (nothing cut off on the
// right) and keep every text readable (WCAG AA against its real ground).
//   npm run test:ui --workspace=packages/vscode-extension [-- --screenshots <dir>]
// Needs the built media/ (npm run build) and Playwright's Chromium.
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { ConfigWarning } from "@agent-cost-analyzer/domain";
import type { Page } from "playwright";
import { judgeProbe } from "./judge.mts";
import { probePage } from "./probe.mts";
import { VSCODE_THEMES } from "./vscode-themes.mts";
import { startHarness, type Harness } from "./webview-harness.mts";

const WIDTHS = [600, 900, 1200, 1600];
// Narrow panels, for the scenarios that have to fit them (manual check 1.9).
const NARROW_WIDTHS = [320, 360];

interface Scenario {
  name: string;
  widths?: number[];
  configWarnings?: ConfigWarning[];
  costTabs?: boolean;
  run(page: Page, harness: Harness): Promise<void>;
}

async function clickFirstVisible(page: Page, harness: Harness, candidates: ReturnType<Page["getByRole"]>[]): Promise<boolean> {
  for (const candidate of candidates) {
    const first = candidate.first();
    if (await first.isVisible().catch(() => false)) {
      await first.click();
      await harness.settle(page);
      return true;
    }
  }
  return false;
}

// Below the wide layout the right column lives in a Details drawer.
async function openDetailsIfCollapsed(page: Page, harness: Harness): Promise<void> {
  const details = page.getByRole("button", { name: "Details" }).first();
  if ((await details.isVisible().catch(() => false)) && (await details.getAttribute("aria-expanded")) !== "true") {
    await details.click();
    await harness.settle(page);
  }
}

async function openVendorsTab(page: Page, harness: Harness): Promise<void> {
  await harness.postHostEvent(page, "selectSession", { sessionId: "image-attachment-invalidation", mode: "learn" });
  await openDetailsIfCollapsed(page, harness);
  // The tab control's radios are visually hidden, so click its label.
  await page.locator("label.seg-opt", { hasText: "Vendors" }).first().click();
  await page.getByRole("table", { name: /each vendor/ }).waitFor({ timeout: 10000 });
  await harness.settle(page);
}

async function openSystemPromptInspector(page: Page, harness: Harness): Promise<void> {
  await harness.postHostEvent(page, "selectSession", { sessionId: harness.usageSessionId, tab: "system-prompt" });
  const inspector = page.getByRole("button", { name: /system prompt inspector/i });
  if (!(await inspector.first().isVisible().catch(() => false))) {
    await clickFirstVisible(page, harness, [page.getByRole("button", { name: /^details$/i })]);
  }
  await inspector.first().click();
  await harness.settle(page);
}

async function openAgentHostInspector(page: Page, harness: Harness, sessionId: string | undefined): Promise<void> {
  await harness.postHostEvent(page, "selectSession", { sessionId });
  const inspect = page.getByRole("button", { name: /inspect request/i });
  if (!(await inspect.first().isVisible().catch(() => false))) {
    await clickFirstVisible(page, harness, [page.getByRole("button", { name: /^details$/i })]);
  }
  await inspect.first().click();
  await harness.settle(page);
}

// The right column sits behind "Details" in a narrow panel.
async function openAgentHostSystemPrompt(page: Page, harness: Harness, sessionId: string | undefined): Promise<void> {
  await harness.postHostEvent(page, "selectSession", { sessionId, tab: "system-prompt" });
  if (!(await page.getByText("System prompt breakdown", { exact: true }).first().isVisible().catch(() => false))) {
    await clickFirstVisible(page, harness, [page.getByRole("button", { name: /^details$/i })]);
  }
}

// Both severities, with the long unbreakable setting ids Copilot Chat's
// warnings really carry.
const BANNER_WARNINGS: ConfigWarning[] = [
  {
    code: "copilot-chat-unavailable",
    severity: "required",
    settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled",
    currentValue: false,
    recommendedValue: true,
    message: "GitHub Copilot Chat is disabled or not installed, so it writes no logs to analyze.",
    helpSteps: [
      "Open the Extensions view and enable GitHub Copilot Chat, or install it.",
      "Sign in to GitHub Copilot if asked, then reload the VS Code window.",
    ],
  },
  {
    code: "agent-traces-unavailable",
    severity: "optional",
    settingId: "github.copilot.chat.otel.dbSpanExporter.enabled",
    currentValue: false,
    recommendedValue: true,
    message: "Cache-write and reasoning-token counts aren't available yet.",
    helpSteps: ["Set github.copilot.chat.otel.dbSpanExporter.enabled to true", "Reload VS Code"],
  },
];

async function openDashboard(page: Page, harness: Harness): Promise<void> {
  await harness.postHostEvent(page, "selectSession", { sessionId: harness.usageSessionId });
  const view = page.getByRole("combobox", { name: /^view$/i });
  if (await view.first().isVisible().catch(() => false)) {
    await view.first().selectOption({ label: "Dashboard" });
  } else {
    await page.getByText("Dashboard", { exact: true }).first().click();
  }
  await harness.settle(page);
}

// Step 15.9: the Dashboard's view switch is radios, or a select below 700 px.
async function openDashboardView(page: Page, harness: Harness, label: "Cost over time" | "Compare" | "Project" | "Billing"): Promise<void> {
  await openDashboard(page, harness);
  const select = page.getByRole("combobox", { name: "Dashboard view" });
  if (await select.isVisible().catch(() => false)) {
    await select.selectOption({ label });
  } else {
    await page.getByRole("radiogroup", { name: "Dashboard view" }).locator("label.seg-opt", { hasText: label }).click();
  }
  await harness.settle(page);
}

const SCENARIOS: Scenario[] = [
  {
    name: "config-banner",
    widths: [...NARROW_WIDTHS, ...WIDTHS],
    configWarnings: BANNER_WARNINGS,
    run: async (page, harness) => {
      await page.getByRole("alert").first().waitFor({ timeout: 5000 });
      await harness.settle(page);
    },
  },
  { name: "learn", run: async () => undefined },
  {
    name: "learn-scenario",
    // As the sidebar's Learn view opens it (step 10.12): simulated on the
    // default model, with the picker, Cache column and sources footer (13.7).
    run: async (page, harness) =>
      harness.postHostEvent(page, "selectSession", { sessionId: "cache-basics", mode: "learn" }),
  },
  {
    name: "learn-scenario-narrow",
    widths: NARROW_WIDTHS,
    run: async (page, harness) =>
      harness.postHostEvent(page, "selectSession", { sessionId: "cache-basics", mode: "learn" }),
  },
  {
    name: "learn-vendors-tab",
    // The Vendors tab: each vendor's default model side by side (13.8).
    run: openVendorsTab,
  },
  {
    name: "learn-vendors-narrow",
    widths: NARROW_WIDTHS,
    run: openVendorsTab,
  },
  {
    name: "learn-vendor-differences",
    // A turn with a cache event shows the How vendors differ card (13.8).
    run: async (page, harness) => {
      await harness.postHostEvent(page, "selectSession", { sessionId: "image-attachment-invalidation", mode: "learn" });
      await page.getByRole("row").nth(3).click();
      await openDetailsIfCollapsed(page, harness);
      await page.getByRole("heading", { name: "How vendors differ" }).waitFor({ timeout: 10000 });
      await harness.settle(page);
    },
  },
  {
    name: "learn-scenario-assumptions",
    run: async (page, harness) => {
      await harness.postHostEvent(page, "selectSession", { sessionId: "cache-basics", mode: "learn" });
      await page.getByRole("button", { name: /assumption/i }).first().click();
      await harness.settle(page);
    },
  },
  {
    name: "session",
    run: async (page, harness) => harness.postHostEvent(page, "selectSession", { sessionId: harness.usageSessionId }),
  },
  { name: "system-prompt-inspector", run: openSystemPromptInspector },
  {
    name: "system-prompt-icicle",
    run: async (page, harness) => {
      await openSystemPromptInspector(page, harness);
      await page.getByText("Icicle", { exact: true }).first().click();
      await harness.settle(page);
    },
  },
  {
    name: "turn-inspector",
    run: async (page, harness) => {
      await harness.postHostEvent(page, "selectSession", { sessionId: harness.usageSessionId });
      const inspect = page.getByRole("button", { name: /inspect request/i });
      if (!(await inspect.first().isVisible().catch(() => false))) {
        await clickFirstVisible(page, harness, [page.getByRole("button", { name: /^details$/i })]);
      }
      await inspect.first().click();
      await harness.settle(page);
    },
  },
  // VS Code Agent Host sessions (step 10.14): one with a Copilot CLI event
  // log read, one without.
  {
    name: "agent-host-turn-inspector",
    run: async (page, harness) => {
      await openAgentHostInspector(page, harness, harness.agentHostSessionId);
      await page.getByText("Example prompt one: please list the source files.").first().waitFor({ timeout: 5000 });
    },
  },
  {
    name: "agent-host-system-prompt",
    run: async (page, harness) => {
      await openAgentHostSystemPrompt(page, harness, harness.agentHostSessionId);
      await page.getByText("System prompt breakdown", { exact: true }).first().waitFor({ timeout: 5000 });
      await page.getByRole("button", { name: /system prompt inspector/i }).first().waitFor({ timeout: 5000 });
    },
  },
  {
    name: "agent-host-tool-audit",
    run: async (page, harness) => {
      await harness.postHostEvent(page, "selectSession", { sessionId: harness.agentHostSessionId, view: "session-audit" });
      await page.getByRole("group", { name: "Tool calls" }).first().waitFor({ timeout: 5000 });
    },
  },
  // Step 10.15: the usageRecords fixture session's first turn reconciles with
  // its session.db, so its Cache write (300) and Reasoning (30) are known.
  {
    name: "agent-host-usage-records",
    run: async (page, harness) => {
      await harness.postHostEvent(page, "selectSession", { sessionId: harness.agentHostUsageRecordsSessionId });
      await page.getByRole("cell", { name: "300", exact: true }).first().waitFor({ timeout: 5000 });
      await page.getByRole("cell", { name: "30", exact: true }).first().waitFor({ timeout: 5000 });
    },
  },
  {
    name: "agent-host-no-log-turn-inspector",
    run: async (page, harness) => {
      await openAgentHostInspector(page, harness, harness.agentHostMissingLogSessionId);
      await page.getByText("Not available", { exact: true }).first().waitFor({ timeout: 5000 });
    },
  },
  {
    name: "agent-host-no-log-system-prompt",
    run: async (page, harness) => {
      await openAgentHostSystemPrompt(page, harness, harness.agentHostMissingLogSessionId);
      await page.getByText(/event log/i).first().waitFor({ timeout: 5000 });
    },
  },
  {
    name: "agent-host-no-log-tool-audit",
    run: async (page, harness) => {
      await harness.postHostEvent(page, "selectSession", { sessionId: harness.agentHostMissingLogSessionId, view: "session-audit" });
      await page.getByText("Tool calls not available", { exact: true }).first().waitFor({ timeout: 5000 });
    },
  },
  { name: "dashboard", run: openDashboard },
  // Step 15.9 (plan §11.6): the cost tabs at 600-1600 px in the three themes.
  {
    name: "dashboard-cost-over-time",
    costTabs: true,
    run: async (page, harness) => {
      await openDashboardView(page, harness, "Cost over time");
      await page.getByRole("group", { name: "Total cost" }).waitFor({ timeout: 10000 });
    },
  },
  {
    name: "dashboard-cost-over-time-marker",
    costTabs: true,
    run: async (page, harness) => {
      await openDashboardView(page, harness, "Cost over time");
      await page.getByRole("button", { name: /^Price · / }).first().focus();
      await page.getByRole("tooltip").first().waitFor({ timeout: 5000 });
    },
  },
  {
    name: "dashboard-cost-over-time-table",
    costTabs: true,
    run: async (page, harness) => {
      await openDashboardView(page, harness, "Cost over time");
      await page.getByRole("button", { name: "View as table" }).first().click();
      await harness.settle(page);
    },
  },
  {
    name: "dashboard-compare",
    costTabs: true,
    run: async (page, harness) => {
      await openDashboardView(page, harness, "Compare");
      await page.getByRole("table", { name: /^Compare/ }).waitFor({ timeout: 10000 });
    },
  },
  {
    name: "dashboard-compare-details",
    costTabs: true,
    widths: [600],
    run: async (page, harness) => {
      await openDashboardView(page, harness, "Compare");
      await page.getByRole("button", { name: /^Details for / }).first().click();
      await harness.settle(page);
    },
  },
  // Step 15.11 (plan §11.5, boards 4 and 5): Billing, its dialogs, and the Projects editor (with a tie).
  {
    name: "dashboard-billing",
    costTabs: true,
    run: async (page, harness) => {
      await openDashboardView(page, harness, "Billing");
      await page.getByText("Differs from issued").waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "View diff" }).click();
      await harness.settle(page);
    },
  },
  // Step 15.12 (plan §11.5, board 4): the estimate panel beside the statement.
  {
    name: "dashboard-billing-estimate",
    costTabs: true,
    run: async (page, harness) => {
      await openDashboardView(page, harness, "Billing");
      const figure = page.getByRole("img", { name: /^Estimate at today's prices/ });
      await figure.waitFor({ timeout: 10000 });
      await figure.scrollIntoViewIfNeeded();
      await harness.settle(page);
    },
  },
  {
    name: "dashboard-billing-export",
    costTabs: true,
    run: async (page, harness) => {
      await openDashboardView(page, harness, "Billing");
      await page.getByRole("button", { name: "Export…" }).click();
      await page.getByRole("dialog").waitFor({ timeout: 5000 });
      await harness.settle(page);
    },
  },
  {
    name: "dashboard-projects-editor",
    costTabs: true,
    run: async (page, harness) => {
      await openDashboardView(page, harness, "Billing");
      await page.getByRole("button", { name: "Edit projects" }).click();
      await page.getByRole("alert").waitFor({ timeout: 10000 });
      await harness.settle(page);
    },
  },
  // Step 15.10 (plan §11.4, board 3): the Project tab, inside one project.
  {
    name: "dashboard-project",
    costTabs: true,
    run: async (page, harness) => {
      await openDashboardView(page, harness, "Project");
      await page.getByRole("listbox", { name: "Project" }).getByRole("option").first().click();
      await harness.settle(page);
      await page.getByRole("img", { name: /^Why cost changed/ }).waitFor({ timeout: 10000 });
    },
  },
  {
    name: "dashboard-project-table",
    costTabs: true,
    run: async (page, harness) => {
      await openDashboardView(page, harness, "Project");
      await page.getByRole("listbox", { name: "Project" }).getByRole("option").first().click();
      await harness.settle(page);
      await page.getByRole("img", { name: /^Why cost changed/ }).waitFor({ timeout: 10000 });
      await page.getByRole("region", { name: /^Why cost changed/ }).getByRole("button", { name: "View as table" }).click();
      await harness.settle(page);
    },
  },
];

// --only <text>: run just the combinations whose "scenario · theme · width"
// contains it (for iterating on one view).
function onlyFilter(): string | undefined {
  const index = process.argv.indexOf("--only");
  return index === -1 ? undefined : process.argv[index + 1];
}

function screenshotsDir(): string | undefined {
  const index = process.argv.indexOf("--screenshots");
  return index === -1 ? undefined : path.resolve(process.argv[index + 1] ?? "ui-check-screenshots");
}

const harness = await startHarness();
const shots = screenshotsDir();
if (shots) mkdirSync(shots, { recursive: true });
let failures = 0;
try {
  for (const [themeName, theme] of Object.entries(VSCODE_THEMES)) {
    for (const width of [...NARROW_WIDTHS, ...WIDTHS]) {
      for (const scenario of SCENARIOS) {
        if (!(scenario.widths ?? WIDTHS).includes(width)) continue;
        const where = `${scenario.name} · ${themeName} · ${width}px`;
        const only = onlyFilter();
        if (only && !where.includes(only)) continue;
        const page = await harness.open(theme, width, undefined, { configWarnings: scenario.configWarnings, costTabs: scenario.costTabs });
        let findings: string[];
        try {
          await scenario.run(page, harness);
          findings = judgeProbe(await probePage(page));
        } catch (error) {
          findings = [`could not run: ${(error as Error).message.split("\n")[0]}`];
        }
        if (shots) await page.screenshot({ path: path.join(shots, `${scenario.name}-${themeName}-${width}.png`) });
        await page.close();
        if (findings.length > 0) {
          failures += findings.length;
          console.log(`✗ ${where}`);
          for (const finding of findings) console.log(`    ${finding}`);
        } else {
          console.log(`✓ ${where}`);
        }
      }
    }
  }
} finally {
  await harness.close();
}
if (failures > 0) {
  console.log(`\n${failures} UI finding(s).`);
  process.exitCode = 1;
}
