// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Layout } from "./layout.js";

// The turns table's columns, in display order (§3.5 Layout: users choose
// and keep the visible ones; narrow panels show the priority ones and put
// the rest in the details drawer).
export const TURN_COLUMNS = [
  { id: "turn", label: "Turn" },
  { id: "trigger", label: "Trigger" },
  // Simulated (Learn) sessions only: the table and drawer leave it out when no turn has a simulation.
  { id: "cache", label: "Cache" },
  { id: "rounds", label: "Rounds" },
  { id: "calls", label: "Calls" },
  { id: "uncachedInput", label: "Uncached in" },
  { id: "cacheRead", label: "Cache read" },
  { id: "cacheWrite", label: "Cache write" },
  { id: "tool", label: "Tool" },
  { id: "vision", label: "Vision" },
  { id: "reasoning", label: "Reasoning" },
  { id: "output", label: "Output" },
  { id: "aiCredits", label: "AI Credits" },
  { id: "cumulative", label: "Cumulative" },
  { id: "model", label: "Model" },
] as const;

// Phase 14 step 14.7: a replayed session's "Simulated" group, after the
// measured columns (mock-up board 1). They apply only while a replay is
// shown; the labels say Simulated wherever a column is named on its own
// (the column chooser, the details drawer).
export const REPLAY_TURN_COLUMNS = [
  { id: "replayCache", label: "Simulated cache" },
  { id: "replayCacheRead", label: "Simulated cache read" },
  { id: "replayCost", label: "Simulated cost" },
] as const;

type MeasuredTurnColumnId = (typeof TURN_COLUMNS)[number]["id"];
export type ReplayTurnColumnId = (typeof REPLAY_TURN_COLUMNS)[number]["id"];
export type TurnColumnId = MeasuredTurnColumnId | ReplayTurnColumnId;

export const ALL_TURN_COLUMNS: TurnColumnId[] = [...TURN_COLUMNS, ...REPLAY_TURN_COLUMNS].map((column) => column.id);
export const ALL_TURN_COLUMN_LABELS = new Map<TurnColumnId, string>(
  [...TURN_COLUMNS, ...REPLAY_TURN_COLUMNS].map((column) => [column.id, column.label]),
);

const REPLAY_IDS = new Set<string>(REPLAY_TURN_COLUMNS.map((column) => column.id));
export function isReplayColumn(id: TurnColumnId): id is ReplayTurnColumnId {
  return REPLAY_IDS.has(id);
}

// Mock-up board 4 (Narrow.dc.html), plus the simulated cost, which stays
// in view at every width while a replay is shown (step 14.7).
export const PRIORITY_TURN_COLUMNS: TurnColumnId[] = ["turn", "trigger", "aiCredits", "cumulative", "replayCost"];

// Turn names the row, so it can't be hidden; nor can the simulated cost,
// the figure a replay is for.
export const REQUIRED_TURN_COLUMNS: TurnColumnId[] = ["turn", "replayCost"];
export const REQUIRED_TURN_COLUMN: TurnColumnId = "turn";

// `ids` in display order, with the required columns.
function inDisplayOrder(ids: readonly string[]): TurnColumnId[] {
  return ALL_TURN_COLUMNS.filter((id) => REQUIRED_TURN_COLUMNS.includes(id) || ids.includes(id));
}

export function turnColumnsFor(layout: Layout, chosen: readonly TurnColumnId[]): TurnColumnId[] {
  return layout === "narrow" ? PRIORITY_TURN_COLUMNS : inDisplayOrder(chosen);
}

export function hiddenTurnColumns(visible: readonly TurnColumnId[]): TurnColumnId[] {
  return ALL_TURN_COLUMNS.filter((id) => !visible.includes(id));
}

// A stored choice, from any version of the app: unknown ids are dropped,
// and anything but an array means nothing was stored.
export function parseTurnColumns(stored: unknown): TurnColumnId[] | undefined {
  if (!Array.isArray(stored)) return undefined;
  const ids = stored.filter((id): id is string => typeof id === "string");
  // A list saved before the Cache column existed that showed every column
  // meant "all of them", so the new column joins it.
  const showedEverything = TURN_COLUMNS.every((column) => column.id === "cache" || ids.includes(column.id));
  // Every list saved since step 14.7 holds the required replayCost, so one
  // without it predates the simulated group, which joins it.
  const predatesReplay = !ids.includes("replayCost");
  return inDisplayOrder([...ids, ...(showedEverything ? ["cache"] : []), ...(predatesReplay ? REPLAY_IDS : [])]);
}

// Whether a column applies to these turns: Cache only to simulated (Learn)
// ones, the simulated group only while a replay is shown.
export function columnsApplyingTo(columns: readonly TurnColumnId[], simulated: boolean, replayed = false): TurnColumnId[] {
  return columns.filter((id) => (id !== "cache" || simulated) && (!isReplayColumn(id) || replayed));
}
