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

export type TurnColumnId = (typeof TURN_COLUMNS)[number]["id"];

export const ALL_TURN_COLUMNS: TurnColumnId[] = TURN_COLUMNS.map((column) => column.id);

// Mock-up board 4 (Narrow.dc.html).
export const PRIORITY_TURN_COLUMNS: TurnColumnId[] = ["turn", "trigger", "aiCredits", "cumulative"];

// Names the row, so it can't be hidden.
export const REQUIRED_TURN_COLUMN: TurnColumnId = "turn";

// `ids` in display order, with the required column.
function inDisplayOrder(ids: readonly string[]): TurnColumnId[] {
  return ALL_TURN_COLUMNS.filter((id) => id === REQUIRED_TURN_COLUMN || ids.includes(id));
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
  const showedEverything = ALL_TURN_COLUMNS.every((id) => id === "cache" || ids.includes(id));
  return inDisplayOrder(showedEverything ? [...ids, "cache"] : ids);
}

// Whether a column applies to these turns: Cache only to simulated ones.
export function columnsApplyingTo(columns: readonly TurnColumnId[], simulated: boolean): TurnColumnId[] {
  return columns.filter((id) => id !== "cache" || simulated);
}
