// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// `flock "$XDG_RUNTIME_DIR/aica-demo.lock" npx tsx scripts/demo/desktop/cut-fake-host-templates.mts [--shots <dir>] [--only a,b]`
// Cuts the in-view templates of the Desktop scenes (templates/*.png) from the MCP Apps fake host: the same view
// HTML Desktop shows in its iframe, in Claude's light set at device scale 1 and a 640 px card. Sends no chat
// message and reads only the made-up fixture home. Needs `npm run build -w packages/mcp-apps` and the host page
// (`npx vite build --config e2e/host/vite.config.ts` in packages/mcp-apps).
// Each element is screenshotted alone, so a template holds no names; --shots keeps the full view of each state
// for the uniqueness check (peaks.py).
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";
import { connectStdioMcp } from "../../../../web/e2e/support/mcp-stdio.ts";
import { hostProfileFrom, type HostRecording } from "../../../../mcp-apps/e2e/support/host-context.ts";
import { McpHost } from "../../../../mcp-apps/e2e/support/mcp-host.ts";
import { ViewFrame } from "../../../../mcp-apps/e2e/support/view-frame.ts";
import { CLAUDE_SETS } from "../../../../mcp-apps/test/theme/host-sets.ts";
import { createDemoDesktopHome } from "./demo-desktop-home.mts";
import { TEMPLATE_DIR } from "./screen-probe.mts";

const MCP_APPS = path.resolve(import.meta.dirname, "../../../../mcp-apps");
const VIEWS_HTML = path.join(MCP_APPS, "dist/views.html");
const CARD = { width: 640 };
const OCTOBER = { since: "2026-10-01", until: "2026-10-31" };
const BEFORE = { since: "2026-10-01", until: "2026-10-06" };
const AFTER = { since: "2026-10-07", until: "2026-10-31" };

interface Cut {
  template: string;
  // Shows the state and returns the element to crop.
  prepare: (ctx: Ctx) => Promise<Locator>;
}
interface Ctx {
  scratchId: string;
  show(tool: string, args: Record<string, unknown>): Promise<ViewFrame>;
}

const kicker = (view: ViewFrame) => view.kicker().first();

const CUTS: Cut[] = [
  { template: "cost-change-kicker", prepare: async (c) => kicker(await c.show("explain_cost_change", { groupBy: "project", id: "portal", periodA: BEFORE, periodB: AFTER })) },
  {
    template: "price-changes-button",
    prepare: async (c) => (await c.show("explain_cost_change", { groupBy: "project", id: "portal", periodA: BEFORE, periodB: AFTER })).costChange.priceChangesButton(),
  },
  {
    template: "back-to-cost-change",
    prepare: async (c) => {
      const view = await c.show("explain_cost_change", { groupBy: "project", id: "portal", periodA: BEFORE, periodB: AFTER });
      await view.costChange.openPriceChanges();
      return view.backButton("Back to cost change");
    },
  },
  { template: "statement-kicker", prepare: async (c) => kicker(await c.show("get_statement", { projectId: "portal", period: "2026-10" })) },
  { template: "sessions-kicker", prepare: async (c) => kicker(await c.show("list_sessions", { provider: "claude-code", since: "2026-10-30", until: "2026-10-30" })) },
  {
    template: "analyse-button",
    prepare: async (c) => (await c.show("list_sessions", { provider: "claude-code", since: "2026-10-30", until: "2026-10-30" })).content.getByRole("button", { name: /^Analyse/ }).first(),
  },
  { template: "audit-kicker", prepare: async (c) => kicker(await c.show("get_session_audit", { sessionId: c.scratchId, provider: "claude-code" })) },
  { template: "findings-kicker", prepare: async (c) => kicker(await c.show("list_findings", {})) },
  {
    template: "kind-anomaly",
    prepare: async (c) => (await c.show("list_findings", {})).content.getByRole("group", { name: "Kind", exact: true }).getByText("Anomaly", { exact: true }),
  },
  {
    template: "why-flagged",
    prepare: async (c) => {
      const view = await c.show("list_findings", {});
      await view.findings.chooseKind("Anomaly");
      return view.findings.whyFlagged().first();
    },
  },
  { template: "replay-kicker", prepare: async (c) => kicker(await c.show("compare_models_for_session", { sessionId: c.scratchId, provider: "claude-code", models: ["claude-haiku-5.5", "gpt-6-luna"] })) },
  {
    template: "model-haiku",
    prepare: async (c) => (await c.show("compare_models_for_session", { sessionId: c.scratchId, provider: "claude-code", models: ["claude-haiku-5.5", "gpt-6-luna"] })).replay.modelButton("claude-haiku-5.5"),
  },
  {
    template: "back-to-model-comparison",
    prepare: async (c) => {
      const view = await c.show("compare_models_for_session", { sessionId: c.scratchId, provider: "claude-code", models: ["claude-haiku-5.5", "gpt-6-luna"] });
      await view.replay.modelButton("claude-haiku-5.5").click();
      return view.backButton("Back to model comparison");
    },
  },
  { template: "estimate-kicker", prepare: async (c) => kicker(await c.show("estimate_cost", { projectId: "mobile", activeDays: 10 })) },
];

// The session view reached from the rollup, as M1's frames show it: what the fake-host-vs-Desktop scores compare.
const REFERENCE_CUTS: Cut[] = [
  { template: "ref-back-to-cost-rollup", prepare: async (c) => (await openScratchFromRollup(c)).backButton("Back to cost rollup") },
  { template: "ref-ask-about-session", prepare: async (c) => (await openScratchFromRollup(c)).content.getByRole("button", { name: "Ask about this session", exact: true }) },
  { template: "ref-kicker", prepare: async (c) => kicker(await openScratchFromRollup(c)) },
];

async function openScratchFromRollup(c: Ctx): Promise<ViewFrame> {
  const rollup = await c.show("get_cost_rollup", OCTOBER);
  await rollup.rollup.openSession("scratch");
  return rollup;
}

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(1500);
  // A freshly shown view's iframe is short until the host resizes it; the element crop needs it whole.
  const iframe = page.locator('iframe[title="MCP App view"]').last();
  const frame = await (await iframe.elementHandle())!.contentFrame();
  const height = await frame!.evaluate(() => document.documentElement.scrollHeight);
  await iframe.evaluate((node, h) => void ((node as HTMLElement).style.height = `${h}px`), height);
  // No focus ring, no hover: a template must match the element at rest.
  await frame!.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(1500, 900);
  await page.waitForTimeout(300);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => args[args.indexOf(name) + 1];
  const shots = args.includes("--shots") ? flag("--shots") : undefined;
  const only = args.includes("--only") ? new Set(flag("--only")!.split(",")) : undefined;
  if (shots) mkdirSync(shots, { recursive: true });

  const tmp = mkdtempSync(path.join(tmpdir(), "aica-cut-templates-"));
  const home = path.join(tmp, "home");
  createDemoDesktopHome(home);
  const server = await connectStdioMcp(home, { args: ["--app-views-html", VIEWS_HTML], clientName: "template-cutter" });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const light = CLAUDE_SETS.find((set) => set.theme === "light")!;
    const recording = JSON.parse(readFileSync(path.resolve(MCP_APPS, "../../docs/plans/mcp-apps-spike-results/claude-light.json"), "utf8")) as HostRecording;
    const profile = hostProfileFrom(recording);

    const lookupHost = await McpHost.open(await context.newPage(), server, profile, light);
    const sessions = (await lookupHost.lookup("list_sessions", { provider: "claude-code", ...OCTOBER })) as { sessions: { id: string; turnCount: number }[] };
    const scratchId = sessions.sessions.find((s) => s.turnCount === 4)!.id;

    // One page per cut: views stack in the host page, and an element far down a tall stack never settles.
    const run = async (cuts: Cut[], dir: string) => {
      for (const cut of cuts) {
        if (only && !only.has(cut.template)) continue;
        const page = await context.newPage();
        const host = await McpHost.open(page, server, profile, light);
        const ctx: Ctx = { scratchId, show: (tool, toolArgs) => host.show(tool, toolArgs, CARD) };
        const target = await cut.prepare(ctx);
        await settle(page);
        await target.screenshot({ path: path.join(dir, `${cut.template}.png`) });
        if (shots) await page.locator('iframe[title="MCP App view"]').last().screenshot({ path: path.join(shots, `${cut.template}.view.png`) });
        console.log(`cut ${cut.template}`);
        await page.close();
      }
    };
    await run(CUTS, TEMPLATE_DIR);
    // The reference cuts go to --shots, never into templates/: they only score the fake host against Desktop's frame.
    if (shots) await run(REFERENCE_CUTS, shots);
  } finally {
    await browser.close();
    await server.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
