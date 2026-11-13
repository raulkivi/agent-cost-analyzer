// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import type { SavingsReport } from "@agent-cost-analyzer/domain";
import { createExtensionApiService } from "@agent-cost-analyzer/server/src/composition/create-extension-api-service";
import { InMemoryAppSettingsStore } from "@agent-cost-analyzer/server/src/test-support/in-memory-app-settings-store";
import { copilotLogPathsFromUserDataDir } from "../../../src/platform/copilot-log-paths.js";
import type { UiFixture } from "../../../scripts/ui-automation/ui-fixture.mts";

// Phase 16 SR15: the savings report as the extension's own ApiService answers
// it over the launch's fixture directories (the panel's RPC method
// getSavingsReport is this call), asked for the tab's default window: the last
// 30 days to now. The spec compares the screen to this answer at run time
// rather than to figures written into it.
const DAY_MS = 24 * 60 * 60 * 1000;
const SERVER = path.resolve(import.meta.dirname, "../../../../server");

export function defaultSavingsSince(now: Date): string {
  return new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10);
}

export function savingsReportOver(fixture: UiFixture, now: Date = new Date()): Promise<SavingsReport> {
  const api = createExtensionApiService({
    ...copilotLogPathsFromUserDataDir(fixture.userDataDir),
    copilotHome: fixture.copilotHome,
    appSettings: new InMemoryAppSettingsStore(),
    learnScriptsDir: path.join(SERVER, "fixtures/learn-scripts"),
    vendorProfilesDir: path.join(SERVER, "fixtures/vendor-profiles"),
    appVersion: "0.0.0-test",
  });
  return api.getSavingsReport({ since: defaultSavingsSince(now), pricing: "as-of-use", includeSimulated: false });
}
