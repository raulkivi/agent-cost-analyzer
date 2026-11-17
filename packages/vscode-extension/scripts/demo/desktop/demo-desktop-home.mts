// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createDemoFixtureHome, DEMO_COPILOT_MODELS } from "../../../../web/e2e/support/demo-fixture-home.mts";
import type { FixtureHome } from "../../../../web/e2e/support/fixture-home.mts";

// D21 and D36: the realistic model names and the DR1 additions (the unused-tools row, the pi session
// on a local model) live in the web demo variant, which the Desktop home inherits unchanged.
export { DEMO_COPILOT_MODELS };

export function createDemoDesktopHome(home: string): FixtureHome {
  return createDemoFixtureHome(home);
}
