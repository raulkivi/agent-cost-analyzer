import { describeAppSettingsStoreContract } from "@copilot-cost-analyzer/server/src/data-sources/log-providers/app-settings-store-contract";
import { SessionAppSettingsStore } from "./session-app-settings-store.js";

describeAppSettingsStoreContract("SessionAppSettingsStore", {
  buildEmptyStore: () => new SessionAppSettingsStore(),
  reopen: (store) => new SessionAppSettingsStore((store as SessionAppSettingsStore).values),
});
