// Generic associative (QlikView-style) data model: a tree of flat tables
// linked child → parent by key, and fields that read one value per row
// (docs/plans/insights-dashboard.md §5). No React, no domain types.

export interface TableDef {
  id: string;
  rows: readonly unknown[];
  key(row: unknown): string;
  // Absent for the root table.
  parent?: { table: string; key(row: unknown): string };
}

export interface FieldDef {
  id: string;
  label: string;
  table: string;
  // undefined = this row has no value for the field (not listed, not selectable).
  value(row: unknown): string | undefined;
  display?(value: string): string;
  // Orders values within the same state; default is by display label.
  compare?(a: string, b: string): number;
}

export interface AssociativeModel {
  tables: readonly TableDef[];
  fields: readonly FieldDef[];
}

// fieldId → selected values (OR within a field, AND across fields).
export type Selections = Readonly<Record<string, readonly string[]>>;

export type ValueState = "selected" | "possible" | "alternative" | "excluded";

export interface FieldValue {
  value: string;
  label: string;
  state: ValueState;
  // Associated rows (in the field's table) carrying this value.
  count: number;
}

export interface Evaluation {
  rows<T = unknown>(tableId: string): T[];
  values(fieldId: string): FieldValue[];
}
