import type { Selections } from "./data-model.js";

// Pure selection reducers + a Back history (QlikView's "Back" button).

function withField(selections: Selections, fieldId: string, values: readonly string[]): Selections {
  const rest = Object.fromEntries(Object.entries(selections).filter(([key]) => key !== fieldId));
  return values.length > 0 ? { ...rest, [fieldId]: values } : rest;
}

// A plain click: select only this value (click it again to clear).
export function selectOnly(selections: Selections, fieldId: string, value: string): Selections {
  const current = selections[fieldId] ?? [];
  const alreadyOnly = current.length === 1 && current[0] === value;
  return withField(selections, fieldId, alreadyOnly ? [] : [value]);
}

// Ctrl/⌘-click: add or remove one value.
export function toggleValue(selections: Selections, fieldId: string, value: string): Selections {
  const current = selections[fieldId] ?? [];
  return withField(
    selections,
    fieldId,
    current.includes(value) ? current.filter((existing) => existing !== value) : [...current, value],
  );
}

export function clearField(selections: Selections, fieldId: string): Selections {
  return withField(selections, fieldId, []);
}

export function clearAll(): Selections {
  return {};
}

export interface SelectionHistory {
  past: readonly Selections[];
  present: Selections;
}

export function emptyHistory(): SelectionHistory {
  return { past: [], present: {} };
}

function sameSelections(a: Selections, b: Selections): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => {
      const left = a[key]!;
      const right = b[key];
      return right !== undefined && left.length === right.length && left.every((value) => right.includes(value));
    })
  );
}

export function commit(history: SelectionHistory, next: Selections): SelectionHistory {
  return sameSelections(history.present, next) ? history : { past: [...history.past, history.present], present: next };
}

export function back(history: SelectionHistory): SelectionHistory {
  const previous = history.past[history.past.length - 1];
  return previous === undefined ? history : { past: history.past.slice(0, -1), present: previous };
}
