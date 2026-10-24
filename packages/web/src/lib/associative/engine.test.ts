import { describe, expect, it } from "vitest";
import { createAssociativeEngine } from "./engine.js";
import type { AssociativeModel } from "./data-model.js";

// A tiny star schema: customers ← orders ← lines, customers ← notes.
interface Customer { id: string; country: string }
interface Order { id: string; customer: string; year: string }
interface Line { id: string; order: string; product: string }
interface Note { id: string; customer: string; tag?: string }

const customers: Customer[] = [
  { id: "c1", country: "EE" },
  { id: "c2", country: "FI" },
  { id: "c3", country: "EE" },
];
const orders: Order[] = [
  { id: "o1", customer: "c1", year: "2025" },
  { id: "o2", customer: "c1", year: "2026" },
  { id: "o3", customer: "c2", year: "2026" },
];
const lines: Line[] = [
  { id: "l1", order: "o1", product: "apple" },
  { id: "l2", order: "o2", product: "pear" },
  { id: "l3", order: "o3", product: "apple" },
  { id: "l4", order: "o3", product: "plum" },
];
const notes: Note[] = [
  { id: "n1", customer: "c2", tag: "vip" },
  { id: "n2", customer: "c3" },
];

const model: AssociativeModel = {
  tables: [
    { id: "customers", rows: customers, key: (row) => (row as Customer).id },
    { id: "orders", rows: orders, key: (row) => (row as Order).id, parent: { table: "customers", key: (row) => (row as Order).customer } },
    { id: "lines", rows: lines, key: (row) => (row as Line).id, parent: { table: "orders", key: (row) => (row as Line).order } },
    { id: "notes", rows: notes, key: (row) => (row as Note).id, parent: { table: "customers", key: (row) => (row as Note).customer } },
  ],
  fields: [
    { id: "country", label: "Country", table: "customers", value: (row) => (row as Customer).country },
    { id: "year", label: "Year", table: "orders", value: (row) => (row as Order).year },
    { id: "product", label: "Product", table: "lines", value: (row) => (row as Line).product, display: (value) => value.toUpperCase() },
    { id: "tag", label: "Tag", table: "notes", value: (row) => (row as Note).tag },
  ],
};

const engine = createAssociativeEngine(model);

function ids(rows: unknown[]): string[] {
  return rows.map((row) => (row as { id: string }).id);
}

function states(fieldId: string, selections = {}) {
  return Object.fromEntries(engine.evaluate(selections).values(fieldId).map((value) => [value.value, value.state]));
}

describe("associative engine", () => {
  it("returns every row and every value as possible with no selections", () => {
    const result = engine.evaluate({});
    expect(ids(result.rows("lines"))).toEqual(["l1", "l2", "l3", "l4"]);
    expect(states("product")).toEqual({ apple: "possible", pear: "possible", plum: "possible" });
  });

  it("propagates a selection down to child tables", () => {
    const result = engine.evaluate({ country: ["FI"] });
    expect(ids(result.rows("orders"))).toEqual(["o3"]);
    expect(ids(result.rows("lines"))).toEqual(["l3", "l4"]);
    expect(ids(result.rows("notes"))).toEqual(["n1"]);
  });

  it("propagates a selection up to parents and across to sibling tables", () => {
    const result = engine.evaluate({ product: ["pear"] });
    expect(ids(result.rows("orders"))).toEqual(["o2"]);
    expect(ids(result.rows("customers"))).toEqual(["c1"]);
    // c1 has no notes: the sibling table is fully excluded.
    expect(ids(result.rows("notes"))).toEqual([]);
    expect(ids(result.rows("lines"))).toEqual(["l2"]);
  });

  it("keeps every child of a matching parent when the selection is on the parent", () => {
    const result = engine.evaluate({ year: ["2026"] });
    expect(ids(result.rows("lines"))).toEqual(["l2", "l3", "l4"]);
    expect(ids(result.rows("customers"))).toEqual(["c1", "c2"]);
  });

  it("intersects selections in different fields and ORs values within one field", () => {
    expect(ids(engine.evaluate({ product: ["apple", "pear"], year: ["2026"] }).rows("lines"))).toEqual(["l2", "l3"]);
    expect(ids(engine.evaluate({ product: ["apple"], country: ["EE"] }).rows("orders"))).toEqual(["o1"]);
  });

  it("marks selected, alternative and excluded values like QlikView", () => {
    // Selecting EE: FI is still an alternative in Country; pear/apple
    // associate through c1, plum only through c2 (excluded).
    expect(states("country", { country: ["EE"] })).toEqual({ EE: "selected", FI: "alternative" });
    expect(states("product", { country: ["EE"] })).toEqual({ apple: "possible", pear: "possible", plum: "excluded" });
  });

  it("marks an alternative as excluded when another field rules it out", () => {
    // year 2025 → only c1 (EE). FI is not reachable even ignoring Country's own selection.
    expect(states("country", { country: ["EE"], year: ["2025"] })).toEqual({ EE: "selected", FI: "excluded" });
  });

  it("orders values selected, possible, alternative, excluded, then by label", () => {
    const values = engine.evaluate({ product: ["plum"] }).values("product");
    expect(values.map((value) => [value.value, value.state])).toEqual([
      ["plum", "selected"],
      ["apple", "alternative"],
      ["pear", "alternative"],
    ]);
    expect(values[0]).toMatchObject({ label: "PLUM", count: 1 });
  });

  it("counts associated rows per value and ignores rows with no value", () => {
    const values = engine.evaluate({}).values("tag");
    expect(values).toEqual([{ value: "vip", label: "vip", state: "possible", count: 1 }]);
    expect(engine.evaluate({}).values("product").find((value) => value.value === "apple")?.count).toBe(2);
  });

  it("returns no rows when the selection matches nothing, and ignores an empty selection list", () => {
    expect(ids(engine.evaluate({ country: ["SE"] }).rows("customers"))).toEqual([]);
    expect(ids(engine.evaluate({ country: [] }).rows("customers"))).toEqual(["c1", "c2", "c3"]);
  });

  it("rejects an unknown field or table", () => {
    expect(() => engine.evaluate({}).values("nope")).toThrow(/Unknown field/);
    expect(() => engine.evaluate({}).rows("nope")).toThrow(/Unknown table/);
  });
});
