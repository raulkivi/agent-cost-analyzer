// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { UiFixture } from "../../../scripts/ui-automation/ui-fixture.mts";

// A valid fixture description for unit tests of the helpers that read one.
export function createUiFixtureStub(): UiFixture {
  return {
    storagePath: "/tmp/aica-ui/storage",
    userDataDir: "/tmp/aica-ui/storage/settings",
    userSettings: { "aiCreditsAnalyzer.mcp.enabled": false },
    copilotHome: "/tmp/aica-ui/copilot",
    usageSessionId: "1c7604a0-1488-4b5d-880a-f80fd693475e",
    usageSessionTitle: "Fix the bug",
    largeSessionId: "00000000-0000-4000-9000-000000000150",
    largeSessionTurns: 150,
    systemPromptMarker: "MARKER",
    listedSessionCount: 207,
  };
}
