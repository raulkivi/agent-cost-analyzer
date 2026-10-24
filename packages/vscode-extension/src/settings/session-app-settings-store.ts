import type { AppSettingsStore } from "@copilot-cost-analyzer/server/src/data-sources/log-providers/app-settings";

// The extension's app settings for now: kept for the life of the extension
// host only. Step 10.4 replaces it with the globalState-backed store (D5),
// which passes the same AppSettingsStore contract.
export class SessionAppSettingsStore implements AppSettingsStore {
  constructor(readonly values: { activeProviderId?: string; minRetainedSessionLogsThreshold?: number } = {}) {}

  readActiveProviderId(): string | undefined {
    return this.values.activeProviderId;
  }

  writeActiveProviderId(activeProviderId: string): void {
    this.values.activeProviderId = activeProviderId;
  }

  readMinRetainedSessionLogsThreshold(): number | undefined {
    return this.values.minRetainedSessionLogsThreshold;
  }

  writeMinRetainedSessionLogsThreshold(minRetainedSessionLogsThreshold: number): void {
    this.values.minRetainedSessionLogsThreshold = minRetainedSessionLogsThreshold;
  }
}
