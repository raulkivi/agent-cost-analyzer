// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SessionsGrouping, SessionsGroupingStore } from "../sidebar/sidebar-controller.js";
import type { Memento } from "./global-state-app-settings-store.js";

export const SESSIONS_GROUPING_KEY = "aiCreditsAnalyzer.sessionsGrouping";

function isGrouping(value: unknown): value is SessionsGrouping {
  return value === "day" || value === "repository";
}

// Step 15.14 (plan §11.9): the Sessions view's Group by day / by repository
// choice in context.globalState (D5), so it holds in every workspace. Cached
// like GlobalStateAppSettingsStore: a write takes effect at once and is
// persisted in the background; a failed persist is reported and the choice
// holds for this session.
export class GlobalStateSessionsGroupingStore implements SessionsGroupingStore {
  private value: SessionsGrouping | undefined;

  constructor(
    private readonly memento: Memento,
    private readonly onError?: (error: unknown) => void,
  ) {
    const stored = memento.get<unknown>(SESSIONS_GROUPING_KEY);
    this.value = isGrouping(stored) ? stored : undefined;
  }

  read(): SessionsGrouping | undefined {
    return this.value;
  }

  write(grouping: SessionsGrouping): void {
    this.value = grouping;
    try {
      this.memento.update(SESSIONS_GROUPING_KEY, grouping).then(undefined, (error: unknown) => this.onError?.(error));
    } catch (error) {
      this.onError?.(error);
    }
  }
}
