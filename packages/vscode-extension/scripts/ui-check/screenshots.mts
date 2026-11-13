// The panel screenshots for the extension README and user guide (step
// 10.10), from the real webview build over made-up data (showcase-fixture).
// The side bar, walkthrough and Copilot agent-mode shots need a real
// VS Code window: see docs/plans/vscode-extension-manual-checks.md §4.
//   npm run screenshots --workspace=packages/vscode-extension [-- --out <dir>]
// Needs the built media/ (npm run build) and Playwright's Chromium.
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { createDemoFixture } from "../ui-automation/demo-fixture.mts";
import { createShowcaseFixture } from "./showcase-fixture.mts";
import { VSCODE_THEMES, type VscodeTheme } from "./vscode-themes.mts";
import { startHarness, type Harness } from "./webview-harness.mts";

interface Shot {
  file: string;
  theme: VscodeTheme;
  width: number;
  height: number;
  view: "turns" | "dashboard" | "savings";
}

const SHOTS: Shot[] = [
  { file: "panel-dark.png", theme: VSCODE_THEMES.dark, width: 1440, height: 660, view: "turns" },
  { file: "panel-light.png", theme: VSCODE_THEMES.light, width: 1440, height: 660, view: "turns" },
  { file: "high-contrast.png", theme: VSCODE_THEMES.hc, width: 1440, height: 660, view: "turns" },
  { file: "narrow.png", theme: VSCODE_THEMES.dark, width: 640, height: 680, view: "turns" },
  { file: "dashboard.png", theme: VSCODE_THEMES.dark, width: 1280, height: 900, view: "dashboard" },
  { file: "savings-dark.png", theme: VSCODE_THEMES.dark, width: 1280, height: 900, view: "savings" },
];

function outDir(): string {
  const index = process.argv.indexOf("--out");
  const dir = index === -1 ? undefined : process.argv[index + 1];
  return path.resolve(dir ?? path.join(import.meta.dirname, "../../../../docs/images/vscode"));
}

// A turn with several rounds and tool calls, for the explanation column.
const FEATURED_TURN = 2;

async function selectTurn(page: Page, harness: Harness, index: number): Promise<void> {
  // Row 0 is the header.
  await page.getByRole("row").nth(index + 1).click();
  await harness.settle(page);
}

async function openDashboard(page: Page, harness: Harness): Promise<void> {
  const view = page.getByRole("combobox", { name: /^view$/i });
  if (await view.first().isVisible().catch(() => false)) {
    await view.first().selectOption({ label: "Dashboard" });
  } else {
    await page.getByText("Dashboard", { exact: true }).first().click();
  }
  await harness.settle(page);
}

// Analyze, then Savings (the option appears once the host's product profile has loaded).
async function openSavings(page: Page, harness: Harness): Promise<void> {
  await page.locator("label.seg-opt", { hasText: /^Analyze$/ }).click();
  await harness.settle(page);
  await page.locator("label.seg-opt", { hasText: /^Savings$/ }).click();
  await page.locator("[data-testid='savings-row']").first().waitFor({ timeout: 30_000 });
  await harness.settle(page);
}

const dir = outDir();
mkdirSync(dir, { recursive: true });

async function takeShots(harness: Harness, shots: Shot[]): Promise<void> {
  for (const shot of shots) {
    const page = await harness.open(shot.theme, shot.width, shot.height);
    await harness.postHostEvent(page, "selectSession", { sessionId: harness.usageSessionId });
    if (shot.view === "dashboard") await openDashboard(page, harness);
    else if (shot.view === "savings") await openSavings(page, harness);
    else await selectTurn(page, harness, FEATURED_TURN);
    await page.screenshot({ path: path.join(dir, shot.file) });
    await page.close();
    console.log(`✓ ${path.join(dir, shot.file)}`);
  }
}

const harness = await startHarness({
  seed: (rootDir) => {
    const fixture = createShowcaseFixture(rootDir);
    return { userDataDir: fixture.userDataDir, usageSessionId: fixture.featuredSessionId };
  },
  deviceScaleFactor: 2,
});
try {
  await takeShots(harness, SHOTS.filter((shot) => shot.view !== "savings"));
} finally {
  await harness.close();
}

// The Savings report needs sessions with findings: the demo scenes' made-up data (E5), not the showcase's.
const savingsHarness = await startHarness({
  seed: (rootDir) => {
    const fixture = createDemoFixture(rootDir);
    return { userDataDir: fixture.userDataDir, usageSessionId: fixture.readSession.id };
  },
  deviceScaleFactor: 2,
});
try {
  await takeShots(savingsHarness, SHOTS.filter((shot) => shot.view === "savings"));
} finally {
  await savingsHarness.close();
}
