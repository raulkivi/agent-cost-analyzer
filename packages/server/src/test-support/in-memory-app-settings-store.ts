import type { AppSettingsStore } from "../data-sources/log-providers/app-settings.js";

// In-memory AppSettingsStore for tests that shouldn't touch the disk — and
// the proof that a second implementation can pass the shared contract
// (app-settings-store-contract.ts) without any change to its callers.
export class InMemoryAppSettingsStore implements AppSettingsStore {
  constructor(
    private readonly values: { activeProviderId?: string; minRetainedSessionLogsThreshold?: number } = {},
  ) {}

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

  // A second store over the same backing values, for the contract's reopen.
  reopen(): InMemoryAppSettingsStore {
    return new InMemoryAppSettingsStore(this.values);
  }
}
