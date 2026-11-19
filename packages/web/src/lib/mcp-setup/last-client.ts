// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ColorModeStorage } from "../color-mode.js";
import { DEFAULT_CLIENT_ID, isClientId } from "./clients.js";
import type { McpSetupClientId } from "./types.js";

export const LAST_CLIENT_STORAGE_KEY = "aca.mcpSetupClient";

// Storage can be missing or throw (blocked site data, private windows); the
// dialog then opens on Claude Code every time.
export function readLastClient(storage: ColorModeStorage | null): McpSetupClientId {
  try {
    const stored = storage?.getItem(LAST_CLIENT_STORAGE_KEY);
    return isClientId(stored) ? stored : DEFAULT_CLIENT_ID;
  } catch {
    return DEFAULT_CLIENT_ID;
  }
}

export function writeLastClient(storage: ColorModeStorage | null, id: McpSetupClientId): void {
  try {
    storage?.setItem(LAST_CLIENT_STORAGE_KEY, id);
  } catch {
    // Not remembered; the dialog still works for this page view.
  }
}
