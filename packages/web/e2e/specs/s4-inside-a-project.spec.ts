import { axeViolations } from "../support/axe.js";
import { chooseOption, expect, openDashboard, selectListValue, test } from "../support/app-fixture.js";

// Scenario S4, "Inside a project" (plan §12.4.2, board 3; step 15.10):
// select the project → Project tab → click Anthropic → its models → choose
// August and October. Passes when the model bars sum to the vendor's total,
// and usage, price and mix effects add up exactly to the change, in the
// waterfall and its table.
//
// The fixture home's portal project has no priced turns before October
// (the price book starts on 2026-10-01, D8), so August's cost is 0 and the
// October work is all usage; the sums are checked as the UI shows them.

const amount = (text: string): number => {
  const cleaned = text.replace(/[,$\s]/g, "").replace("−", "-").replace(/^\+/, "");
  return Number(cleaned);
};

async function barValues(group: import("@playwright/test").Locator): Promise<number[]> {
  await group.getByRole("button", { name: "View as table" }).click();
  const values: number[] = [];
  for (const row of await group.locator("tbody tr").all()) values.push(amount((await row.locator("td").last().textContent()) ?? ""));
  await group.getByRole("button", { name: "View as table" }).click();
  return values;
}

test("S4: inside a project, vendors and models add up, and the effects add up to the change", async ({ page, app }) => {
  await openDashboard(page, app.baseURL);
  await selectListValue(page, "Project", /Customer portal/);
  await chooseOption(page, "Dashboard view", "Project");
  await chooseOption(page, "Date range", "Last 90 days");

  const vendors = page.getByRole("group", { name: /^Cost by vendor/ });
  await expect(vendors).toBeVisible();
  await vendors.getByRole("button", { name: /Anthropic/ }).click();
  await expect(vendors.getByRole("button", { name: /Anthropic/ })).toHaveAttribute("aria-pressed", "true");
  const anthropicText = (await vendors.getByRole("button", { name: /Anthropic/ }).textContent()) ?? "";
  const anthropicTotal = amount(anthropicText.match(/[\d,]+\.\d\d/)![0]);

  const models = page.getByRole("group", { name: "Anthropic models" });
  await expect(models).toContainText("claude-sonnet-5-5");
  const modelValues = await barValues(models);
  expect(modelValues.reduce((sum, value) => sum + value, 0)).toBeCloseTo(anthropicTotal, 2);
  await expect(page.getByRole("group", { name: "Anthropic tokens by type" })).toContainText("Cache read");
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("combobox", { name: "From", exact: true }).selectOption({ label: "Aug 2026" });
  await page.getByRole("combobox", { name: "To", exact: true }).selectOption({ label: "Oct 2026" });
  const waterfall = page.getByRole("img", { name: /^Why cost changed: Aug 2026 to Oct 2026/ });
  await expect(waterfall).toBeVisible();
  const name = (await waterfall.getAttribute("aria-label")) ?? "";
  const figure = (label: string) => amount(name.match(new RegExp(`${label} ([+−]?[\\d,]+\\.\\d\\d)`))![1]!);
  expect(figure("Aug 2026") + figure("usage") + figure("price") + figure("mix")).toBeCloseTo(figure("Oct 2026"), 2);
  expect(figure("Oct 2026")).toBeGreaterThan(0);

  // The table: the same figures, adding up the same way.
  const section = page.getByRole("region", { name: /^Why cost changed/ });
  await section.getByRole("button", { name: "View as table" }).click();
  const table = section.getByRole("table", { name: /Effects add up to the change exactly/ });
  const cells: Record<string, number> = {};
  for (const row of await table.locator("tbody tr").all()) {
    cells[((await row.locator("th").textContent()) ?? "").trim()] = amount((await row.locator("td").textContent()) ?? "");
  }
  expect(Object.keys(cells)).toEqual(["Aug 2026", "Usage", "Price", "Mix", "Oct 2026"]);
  expect(cells["Aug 2026"]! + cells.Usage! + cells.Price! + cells.Mix!).toBeCloseTo(cells["Oct 2026"]!, 2);
  expect(cells["Oct 2026"]).toBeCloseTo(figure("Oct 2026"), 2);
  expect(await axeViolations(page)).toEqual([]);
});
