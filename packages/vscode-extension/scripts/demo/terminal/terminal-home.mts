// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createFixtureHome } from "../../../../web/e2e/support/fixture-home.mts";

// The one place N1 chooses its made-up HOME. Today it is the shared web e2e fixture home. DR1 adds a demo variant
// with realistic model names (D36): switch to it here, nowhere else.
export function createTerminalHome(home: string): void {
  createFixtureHome(home);
}
