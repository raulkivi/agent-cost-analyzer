// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Page } from "@playwright/test";
import { Pointer } from "../../../../web/e2e/demo/support/demo-driver.js";
import { demoLayoutCss } from "./demo-layout.js";

// Gives the fake host's page the view-only layout; call it before the first view is shown.
export async function applyDemoLayout(page: Page): Promise<void> {
  await page.addStyleTag({ content: demoLayoutCss() });
}

// The drawn pointer lives in the host's document, above the view's iframe.
export async function installPointer(page: Page): Promise<Pointer> {
  const pointer = new Pointer(page);
  await pointer.install();
  return pointer;
}
