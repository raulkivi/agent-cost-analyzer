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
    savings: {
      unusedToolsServer: "acmedocs",
      localSessionId: "00000000-0000-4000-9000-000000000021",
      failedCallsProgram: "rg",
      failedCallsCount: 3,
      agentHostSessionId: "9a1b2c3d-5555-4e6f-8a07-000000000020",
    },
    listedSessionCount: 209,
  };
}
