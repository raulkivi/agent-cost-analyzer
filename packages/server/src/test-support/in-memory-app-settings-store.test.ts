// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describeAppSettingsStoreContract } from "../data-sources/log-providers/app-settings-store-contract.js";
import { InMemoryAppSettingsStore } from "./in-memory-app-settings-store.js";

describeAppSettingsStoreContract("InMemoryAppSettingsStore", {
  buildEmptyStore: () => new InMemoryAppSettingsStore(),
  reopen: (store) => (store as InMemoryAppSettingsStore).reopen(),
});
