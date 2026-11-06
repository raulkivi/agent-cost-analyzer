import { axeViolations } from "../support/axe.js";
import { chooseOption, expect, openDashboard, test } from "../support/app-fixture.js";

// Scenario S1, "First project" (plan §12.4.2, boards 6 and 5; step 15.11):
// no projects file → the "no projects" empty state → Create project →
// assign three repositories with each row's Project select, by keyboard
// only → Save. Passes when the project appears in the Project list box and
// its total equals the sum of its repositories'.

test.use({ noProjects: true });

test("S1: first project, assigned by keyboard alone", async ({ page, app }) => {
  await openDashboard(page, app.baseURL);
  await chooseOption(page, "Dashboard view", "Billing");
  await expect(page.getByText("Group repositories into a project to bill and compare them.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).focus();
  await page.keyboard.press("Enter");
  // The new project's Name field has focus, its text selected.
  await page.keyboard.type("Customer portal");
  for (const key of ["github.com/acme/portal-web", "github.com/acme/portal-api", "github.com/acme/billing"]) {
    const select = page.getByRole("combobox", { name: `Assign ${key} to` });
    await select.focus();
    // Keyboard only: ArrowDown picks the first project, which assigns the row.
    await page.keyboard.press("ArrowDown");
    await expect(select).toHaveCount(0);
  }
  await expect(page.getByRole("region", { name: "Customer portal" }).getByRole("row")).toHaveCount(4);
  expect(await axeViolations(page)).toEqual([]);
  const save = page.getByRole("button", { name: "Save" });
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^Saved\./)).toBeVisible();

  await page.getByRole("button", { name: /Back to the Dashboard/ }).click();
  const projectBox = page.getByRole("listbox", { name: "Project" });
  await expect(projectBox.getByRole("option", { name: /Customer portal/ })).toBeVisible();

  // The project's total equals the sum of its three repositories' (Cost over time, by repository).
  await projectBox.getByRole("option", { name: /Customer portal/ }).click();
  await chooseOption(page, "Dashboard view", "Cost over time");
  await chooseOption(page, "Date range", "Last 90 days");
  const projectTotal = await page.getByRole("group", { name: "Total cost" }).textContent();
  await page.getByRole("button", { name: "Clear all" }).click();
  for (const key of ["github.com/acme/portal-web", "github.com/acme/portal-api", "github.com/acme/billing"]) {
    await page.getByRole("listbox", { name: "Repository" }).getByRole("option", { name: key }).click({ modifiers: ["ControlOrMeta"] });
  }
  const amount = (text: string | null) => Number(/([\d,]+\.\d\d) AI Credits/.exec(text ?? "")![1]!.replace(/,/g, ""));
  const lines = page.getByRole("button", { name: "View as table" }).first();
  await lines.click();
  const table = page.getByRole("table", { name: /^Cost over time/ });
  const header = await table.locator("thead th").allTextContents();
  expect(header.filter((cell) => /acme/.test(cell))).toHaveLength(3);
  const sums = await table.locator("tbody tr").evaluateAll((rows) =>
    rows
      .filter((row) => row.querySelector("th")?.textContent?.startsWith("Week of"))
      .map((row) => [...row.querySelectorAll("td")].slice(0, 3).reduce((sum, cell) => sum + (Number((cell.textContent ?? "").replace(/,/g, "")) || 0), 0)),
  );
  expect(sums.reduce((a, b) => a + b, 0)).toBeCloseTo(amount(projectTotal), 2);
});
