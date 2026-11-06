import { axeViolations } from "../support/axe.js";
import { chooseOption, expect, openDashboard, test } from "../support/app-fixture.js";

// Scenario S6, "Overlapping projects" (plan §12.4.2, board 5; step 15.11):
// in the Projects editor, add the same repository and branch scope to a
// second project. Passes when the tie error shows inline and in the summary
// with Save disabled, and removing one member enables it.

test("S6: an exact tie is shown inline and in the summary, and blocks Save", async ({ page, app }) => {
  await openDashboard(page, app.baseURL);
  await chooseOption(page, "Dashboard view", "Billing");
  await page.getByRole("button", { name: "Edit projects" }).click();

  const billing = page.getByRole("region", { name: "Billing service" });
  await billing.getByRole("combobox", { name: "Add member" }).selectOption("github.com/acme/portal-web");
  const summary = page.getByRole("alert");
  await expect(summary).toContainText("1 problem to fix before saving");
  await expect(summary).toContainText("Exact tie");
  const branchInputs = billing.getByRole("textbox", { name: "Branch patterns" });
  await expect(branchInputs.last()).toHaveAttribute("aria-invalid", "true");
  await expect(billing.getByText(/Exact tie/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(await axeViolations(page)).toEqual([]);

  await billing.getByRole("button", { name: "Remove github.com/acme/portal-web from this project" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  // Back to the file as saved: nothing to save.
  await billing.getByRole("checkbox", { name: /Include subscription use/ }).check();
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
});
