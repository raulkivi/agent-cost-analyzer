// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createDemoFixtureHome } from "../../../../web/e2e/support/demo-fixture-home.mts";

// The one place N1 chooses its made-up HOME: the demo variant of the web e2e fixture home (D36), so the sessions
// match the other web scenes and no frame reads "fixture".
export function createTerminalHome(home: string): void {
  createDemoFixtureHome(home);
}
