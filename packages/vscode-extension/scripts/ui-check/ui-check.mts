// The extension's UI check (step 10.11): every main view of the real webview
// build, in Dark Modern, Light Modern and High Contrast, at panel widths from
// a narrow split to a wide editor, must fit the panel (nothing cut off on the
// right) and keep every text readable (WCAG AA against its real ground).
//   npm run test:ui --workspace=packages/vscode-extension [-- --screenshots <dir>]
// Needs the built media/ (npm run build) and Playwright's Chromium.
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { judgeProbe } from "./judge.mts";
import { probePage } from "./probe.mts";
import { VSCODE_THEMES } from "./vscode-themes.mts";
import { startHarness, type Harness } from "./webview-harness.mts";

const WIDTHS = [600, 900, 1200, 1600];

interface Scenario {
  name: string;
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

const SCENARIOS: Scenario[] = [
  { name: "learn", run: async () => undefined },
  {
    name: "learn-scenario",
    // As the sidebar's Learn view opens it (step 10.12).
    run: async (page, harness) =>
      harness.postHostEvent(page, "selectSession", { sessionId: "cache-basics", mode: "learn" }),
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
  {
    name: "dashboard",
    run: async (page, harness) => {
      await harness.postHostEvent(page, "selectSession", { sessionId: harness.usageSessionId });
      const view = page.getByRole("combobox", { name: /^view$/i });
      if (await view.first().isVisible().catch(() => false)) {
        await view.first().selectOption({ label: "Dashboard" });
      } else {
        await page.getByText("Dashboard", { exact: true }).first().click();
      }
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
    for (const width of WIDTHS) {
      for (const scenario of SCENARIOS) {
        const where = `${scenario.name} · ${themeName} · ${width}px`;
        const only = onlyFilter();
        if (only && !where.includes(only)) continue;
        const page = await harness.open(theme, width);
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
