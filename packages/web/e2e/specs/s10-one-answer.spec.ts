import type { CostTotal } from "@agent-cost-analyzer/domain";
import { axeViolations } from "../support/axe.js";
import { chooseOption, expect, openDashboard, selectListValue, test } from "../support/app-fixture.js";
import { connectStdioMcp, structured } from "../support/mcp-stdio.js";

// Scenario S10, "One answer everywhere" (plan §12.4.2; step 15.13): for one
// project and month, read the total in the Dashboard, from
// GET /api/cost/timeseries and from MCP get_project_cost over stdio. Passes
// when all three are equal, with the same coverage.
//
// Customer portal in October 2026 ("Last month" at the fixed clock,
// 2026-11-06): Claude Code priced, pi reported, Copilot billed. The stdio
// server reads the same fixture home as the app's server.

const credits = (usd: number) => (usd * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const OCTOBER = { since: "2026-10-01", until: "2026-10-31" };

test("S10: one project and month give the same total and coverage in the Dashboard, the API and MCP", async ({ page, app }) => {
  const api = (await (
    await page.request.get(`${app.baseURL}/api/cost/timeseries?groupBy=project&ids=portal&bucket=month&since=${OCTOBER.since}&until=${OCTOBER.until}`)
  ).json()) as { total: CostTotal };

  const client = await connectStdioMcp(app.home);
  let mcp: { total: CostTotal };
  try {
    mcp = structured(await client.callTool({ name: "get_project_cost", arguments: { projectId: "portal", bucket: "month", ...OCTOBER } }));
  } finally {
    await client.close();
  }

  expect(api.total.usd).not.toBeNull();
  expect(api.total.turns).toBeGreaterThan(0);
  expect(mcp.total).toEqual(api.total);

  await openDashboard(page, app.baseURL);
  await selectListValue(page, "Project", /Customer portal/);
  await chooseOption(page, "Dashboard view", "Cost over time");
  await chooseOption(page, "Bucket", "Month");
  await chooseOption(page, "Date range", "Last month");
  const total = page.getByRole("group", { name: "Total cost" });
  await expect(total).toContainText(`${credits(api.total.usd!)} AI Credits`);
  // The Dashboard words full coverage as "all N turns known".
  const coverage = api.total.knownTurns === api.total.turns ? `all ${api.total.turns} turns known` : `${api.total.knownTurns} of ${api.total.turns} turns known`;
  await expect(total).toContainText(coverage);
  expect(await axeViolations(page)).toEqual([]);
});
