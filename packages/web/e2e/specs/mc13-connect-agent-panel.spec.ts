// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpSetupClient, McpSetupResponse } from "@agent-cost-analyzer/domain";
import type { Page } from "@playwright/test";
import { axeViolations } from "../support/axe.js";
import { expect, openDashboard, test } from "../support/app-fixture.js";

// Phase 18 MC13 (mcp-client-setup.md §5.6, §7 item 5): the standalone app's
// "Connect an agent" panel, against the real GET /api/mcp/setup. The light
// and dark Playwright projects run every test in both color modes.

test.beforeEach(async ({ context, app }) => {
  // The panel copies through navigator.clipboard; read it back to compare.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.baseURL });
});

async function fetchSetup(page: Page, baseURL: string): Promise<McpSetupResponse> {
  const response = await page.request.get(`${baseURL}/api/mcp/setup`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as McpSetupResponse;
}

async function openPanel(page: Page, baseURL: string) {
  // The Overview is axe-clean on its own (overview-a11y.spec.ts), so the axe
  // checks below measure the panel and not the page behind it.
  await openDashboard(page, baseURL);
  const opener = page.getByRole("button", { name: "Connect an agent" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Connect an agent" });
  await expect(dialog).toBeVisible();
  return { opener, dialog };
}

const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

function manualText(client: McpSetupClient): { text: string; copyLabel: string } {
  return client.manual.kind === "command"
    ? { text: client.manual.command, copyLabel: "setup command" }
    : { text: client.manual.json, copyLabel: "setup JSON" };
}

test("the header button opens the panel, which lists every agent the API returns", async ({ page, app }) => {
  const setup = await fetchSetup(page, app.baseURL);
  const { dialog } = await openPanel(page, app.baseURL);
  await expect(dialog.getByText(`Version ${setup.version} · runs`)).toBeVisible();
  for (const client of setup.clients) {
    await expect(dialog.getByRole("tab", { name: client.label, exact: true })).toBeVisible();
  }
});

test("each copy button puts the snippet the API returned on the clipboard", async ({ page, app }) => {
  const setup = await fetchSetup(page, app.baseURL);
  const { dialog } = await openPanel(page, app.baseURL);
  for (const client of setup.clients) {
    await dialog.getByRole("tab", { name: client.label, exact: true }).click();
    await expect(dialog.getByRole("heading", { name: client.label, level: 3, exact: true })).toBeVisible();
    // The by-hand block waits for the API; its heading marks the data as in.
    await expect(dialog.getByRole("heading", { name: "Or set it up by hand" })).toBeVisible();

    await dialog.getByRole("button", { name: "Copy: install command" }).click();
    await expect(dialog.getByRole("button", { name: "Copied: install command" })).toBeVisible();
    expect(await readClipboard(page)).toBe(client.installCommand);

    const manual = manualText(client);
    await dialog.getByRole("button", { name: `Copy: ${manual.copyLabel}` }).click();
    await expect(dialog.getByRole("button", { name: `Copied: ${manual.copyLabel}` })).toBeVisible();
    expect(await readClipboard(page)).toBe(manual.text);
  }
});

test("the code blocks show the install command the API returned", async ({ page, app }) => {
  const setup = await fetchSetup(page, app.baseURL);
  const { dialog } = await openPanel(page, app.baseURL);
  const first = setup.clients[0];
  if (!first) throw new Error("The API listed no agent.");
  await expect(dialog.getByRole("group", { name: `Install command for ${first.label}` })).toHaveText(first.installCommand);
});

test("install links point at the API's link and are never followed", async ({ page, app }) => {
  const setup = await fetchSetup(page, app.baseURL);
  expect(setup.clients.some((client) => client.installLink)).toBe(true);
  const { dialog } = await openPanel(page, app.baseURL);
  for (const client of setup.clients) {
    await dialog.getByRole("tab", { name: client.label, exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Or set it up by hand" })).toBeVisible();
    const link = dialog.getByRole("link", { name: `Add to ${client.label}`, exact: true });
    if (client.installLink) await expect(link).toHaveAttribute("href", client.installLink);
    else await expect(link).toHaveCount(0);
  }
  // Only the href is asserted: the page stays where it was.
  expect(page.url()).toBe(`${app.baseURL}/`);
});

test("the close button, the footer button and Escape close it, and focus returns to the header button", async ({ page, app }) => {
  const { opener, dialog } = await openPanel(page, app.baseURL);
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  await page.locator(".mcp-footer").getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("the panel follows the color mode and has no axe violations", async ({ page, app }, testInfo) => {
  await openPanel(page, app.baseURL);
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", testInfo.project.name);
  await expect(page.getByRole("heading", { name: "Or set it up by hand" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("the panel has no axe violations on an agent with an install link", async ({ page, app }) => {
  const setup = await fetchSetup(page, app.baseURL);
  const linked = setup.clients.find((client) => client.installLink);
  if (!linked) throw new Error("No agent has an install link.");
  const { dialog } = await openPanel(page, app.baseURL);
  await dialog.getByRole("tab", { name: linked.label, exact: true }).click();
  await expect(dialog.getByRole("link", { name: `Add to ${linked.label}`, exact: true })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});
