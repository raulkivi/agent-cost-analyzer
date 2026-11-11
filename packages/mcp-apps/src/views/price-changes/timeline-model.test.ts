// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { priceChangeList } from "../../view-models/increment3-fixtures.js";
import { toPriceChangesViewModel } from "../../view-models/price-changes.js";
import { layoutTimeline, timelineEntries } from "./timeline-model.js";

const vm = (overrides = {}) => toPriceChangesViewModel(priceChangeList(overrides));

describe("timelineEntries", () => {
  it("merges documented and observed changes oldest first, each keeping its kind", () => {
    const entries = timelineEntries(vm());
    expect(entries.map((entry) => `${entry.change.kind}:${entry.change.dateText}`)).toEqual(["documented:Oct 15", "observed:Oct 20"]);
  });

  it("puts a documented change before an observed one on the same day", () => {
    const base = priceChangeList();
    const observed = base.changes[1]!;
    const same = priceChangeList({ changes: [{ ...observed, date: "2026-10-15" }, base.changes[0]!] });
    expect(timelineEntries(toPriceChangesViewModel(same)).map((entry) => entry.change.kind)).toEqual(["documented", "observed"]);
  });

  it("gives every entry a key that differs between a documented and an observed change of one model and day", () => {
    const base = priceChangeList();
    const documented = base.changes[0]!;
    const observed = base.changes[1]!;
    const same = priceChangeList({ changes: [documented, { ...observed, date: documented.date, modelId: documented.modelId }] });
    const keys = timelineEntries(toPriceChangesViewModel(same)).map((entry) => entry.key);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("layoutTimeline", () => {
  const WIDTH = 480;
  it("spreads the changes over the period asked for, the first and last day at the axis ends", () => {
    const model = vm({ since: "2026-10-01", until: "2026-10-31" });
    const layout = layoutTimeline(timelineEntries(model), model.range, WIDTH);
    expect(layout.start.text).toBe("Oct 1");
    expect(layout.end.text).toBe("Oct 31");
    expect(layout.start.x).toBeLessThan(layout.marks[0]!.x);
    expect(layout.marks[0]!.x).toBeLessThan(layout.marks[1]!.x);
    expect(layout.marks[1]!.x).toBeLessThan(layout.end.x);
  });

  it("spans the first to the last change when no period was given", () => {
    const layout = layoutTimeline(timelineEntries(vm()), undefined, WIDTH);
    expect(layout.start.text).toBe("Oct 15");
    expect(layout.end.text).toBe("Oct 20");
    expect(layout.marks[0]!.x).toBe(layout.start.x);
    expect(layout.marks[1]!.x).toBe(layout.end.x);
  });

  it("centres a lone change", () => {
    const base = priceChangeList();
    const lone = toPriceChangesViewModel(priceChangeList({ changes: [base.changes[0]!] }));
    const layout = layoutTimeline(timelineEntries(lone), undefined, WIDTH);
    expect(layout.marks).toHaveLength(1);
    expect(layout.marks[0]!.x).toBe(WIDTH / 2);
  });

  it("drops the label of a mark too close to the one before, keeping the mark", () => {
    const base = priceChangeList();
    const observed = base.changes[1]!;
    const near = toPriceChangesViewModel(priceChangeList({ since: "2026-10-01", until: "2026-12-31", changes: [base.changes[0]!, { ...observed, date: "2026-10-16" }] }));
    const layout = layoutTimeline(timelineEntries(near), near.range, WIDTH);
    expect(layout.marks.map((mark) => mark.labelled)).toEqual([true, false]);
  });

  it("names each mark with its kind, for the chart's hover title", () => {
    const model = vm();
    const layout = layoutTimeline(timelineEntries(model), undefined, WIDTH);
    expect(layout.marks.map((mark) => mark.title)).toEqual(["Oct 15 (documented)", "Oct 20 (inferred)"]);
  });
});
