import type { AssociativeModel, Evaluation, FieldDef, FieldValue, Selections, TableDef, ValueState } from "./data-model.js";

// Associative selection engine (docs/plans/insights-dashboard.md §5):
//   1. local:  a table's rows matching its own fields' selections;
//   2. upward: a row also needs ≥1 surviving child in every constrained
//      child table (one with selections in it or below it);
//   3. downward: a row survives only if its parent row does.
// Field states compare the result with and without the field's own
// selection, giving QlikView's selected / possible / alternative / excluded.

interface PreparedTable {
  def: TableDef;
  fields: FieldDef[];
  children: PreparedTable[];
  // Row index → index of its parent row (-1 = orphan / root).
  parentIndex: number[];
}

type Survivors = Map<string, boolean[]>;

const STATE_RANK: Record<ValueState, number> = { selected: 0, possible: 1, alternative: 2, excluded: 3 };

function prepare(model: AssociativeModel): { ordered: PreparedTable[]; byId: Map<string, PreparedTable> } {
  const byId = new Map<string, PreparedTable>();
  for (const def of model.tables) {
    byId.set(def.id, { def, fields: model.fields.filter((field) => field.table === def.id), children: [], parentIndex: [] });
  }
  for (const table of byId.values()) {
    const parentRef = table.def.parent;
    if (!parentRef) {
      table.parentIndex = table.def.rows.map(() => -1);
      continue;
    }
    const parent = byId.get(parentRef.table);
    if (!parent) {
      throw new Error(`Table "${table.def.id}" names unknown parent "${parentRef.table}"`);
    }
    parent.children.push(table);
    const positionByKey = new Map(parent.def.rows.map((row, index) => [parent.def.key(row), index]));
    table.parentIndex = table.def.rows.map((row) => positionByKey.get(parentRef.key(row)) ?? -1);
  }
  // Parents before children (pre-order from every root).
  const ordered: PreparedTable[] = [];
  const visit = (table: PreparedTable) => {
    ordered.push(table);
    table.children.forEach(visit);
  };
  [...byId.values()].filter((table) => !table.def.parent).forEach(visit);
  return { ordered, byId };
}

export function createAssociativeEngine(model: AssociativeModel) {
  const { ordered, byId } = prepare(model);
  const fieldsById = new Map(model.fields.map((field) => [field.id, field]));

  function activeSelections(selections: Selections): Map<string, Set<string>> {
    const active = new Map<string, Set<string>>();
    for (const [fieldId, values] of Object.entries(selections)) {
      if (values.length > 0 && fieldsById.has(fieldId)) {
        active.set(fieldId, new Set(values));
      }
    }
    return active;
  }

  function survivors(active: Map<string, Set<string>>): Survivors {
    const constrained = new Map<string, boolean>();
    const up: Survivors = new Map();
    for (const table of [...ordered].reverse()) {
      const ownSelections = table.fields.filter((field) => active.has(field.id));
      const constrainedChildren = table.children.filter((child) => constrained.get(child.def.id));
      constrained.set(table.def.id, ownSelections.length > 0 || constrainedChildren.length > 0);
      const parentsWithSurvivingChild = constrainedChildren.map((child) => {
        const childUp = up.get(child.def.id)!;
        return new Set(child.parentIndex.filter((_, index) => childUp[index]));
      });
      up.set(
        table.def.id,
        table.def.rows.map(
          (row, index) =>
            ownSelections.every((field) => {
              const value = field.value(row);
              return value !== undefined && active.get(field.id)!.has(value);
            }) && parentsWithSurvivingChild.every((parents) => parents.has(index)),
        ),
      );
    }
    const anySelection = active.size > 0;
    const final: Survivors = new Map();
    for (const table of ordered) {
      const tableUp = up.get(table.def.id)!;
      const parentFinal = table.def.parent ? final.get(table.def.parent.table)! : undefined;
      final.set(
        table.def.id,
        tableUp.map((alive, index) => {
          if (!alive || !parentFinal) {
            return alive;
          }
          const parent = table.parentIndex[index]!;
          return parent === -1 ? !anySelection : parentFinal[parent]!;
        }),
      );
    }
    return final;
  }

  function evaluate(selections: Selections): Evaluation {
    const active = activeSelections(selections);
    const final = survivors(active);

    function tableOf(tableId: string): PreparedTable {
      const table = byId.get(tableId);
      if (!table) {
        throw new Error(`Unknown table "${tableId}"`);
      }
      return table;
    }

    function presentValues(field: FieldDef, alive: boolean[]): Map<string, number> {
      const counts = new Map<string, number>();
      tableOf(field.table).def.rows.forEach((row, index) => {
        const value = field.value(row);
        if (value !== undefined && alive[index]) {
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
      });
      return counts;
    }

    return {
      rows<T>(tableId: string): T[] {
        const alive = final.get(tableOf(tableId).def.id)!;
        return tableOf(tableId).def.rows.filter((_, index) => alive[index]) as T[];
      },
      values(fieldId: string): FieldValue[] {
        const field = fieldsById.get(fieldId);
        if (!field) {
          throw new Error(`Unknown field "${fieldId}"`);
        }
        const table = tableOf(field.table);
        const possible = presentValues(field, final.get(table.def.id)!);
        const selected = active.get(fieldId);
        let alternative = new Map<string, number>();
        if (selected) {
          const withoutField = new Map(active);
          withoutField.delete(fieldId);
          alternative = presentValues(field, survivors(withoutField).get(table.def.id)!);
        }
        const all = new Set<string>();
        table.def.rows.forEach((row) => {
          const value = field.value(row);
          if (value !== undefined) {
            all.add(value);
          }
        });
        const display = field.display ?? ((value: string) => value);
        const stateOf = (value: string): ValueState =>
          selected?.has(value) ? "selected" : selected ? (alternative.has(value) ? "alternative" : "excluded") : possible.has(value) ? "possible" : "excluded";
        const compare = field.compare ?? ((a: string, b: string) => display(a).localeCompare(display(b)));
        return [...all]
          .map((value) => ({ value, label: display(value), state: stateOf(value), count: possible.get(value) ?? 0 }))
          .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || compare(a.value, b.value));
      },
    };
  }

  return { evaluate };
}

export type AssociativeEngine = ReturnType<typeof createAssociativeEngine>;
