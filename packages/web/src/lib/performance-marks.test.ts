import { describe, expect, it, vi } from "vitest";
import { createPerformanceMarks, PERFORMANCE_MARKS } from "./performance-marks.js";

// A stand-in for window.performance's mark/getEntriesByName.
function fakePerformance() {
  const entries: { name: string; startTime: number }[] = [];
  let now = 0;
  return {
    entries,
    tick: (ms: number) => {
      now += ms;
    },
    mark: vi.fn((name: string) => {
      entries.push({ name, startTime: now });
    }),
    getEntriesByName: (name: string) => entries.filter((entry) => entry.name === name),
  };
}

describe("performance marks (vscode-extension.md §3.5 Performance, step 10.9 budgets)", () => {
  it("names the two marks the host reads", () => {
    expect(PERFORMANCE_MARKS).toEqual({ firstRender: "first-render", dataReady: "data-ready" });
  });

  it("emits a mark through performance.mark", () => {
    const performance = fakePerformance();
    const marks = createPerformanceMarks(performance);

    marks.mark("first-render");

    expect(performance.mark).toHaveBeenCalledWith("first-render");
  });

  it("emits each mark once per page, however often the UI re-renders", () => {
    const performance = fakePerformance();
    const marks = createPerformanceMarks(performance);

    marks.mark("data-ready");
    marks.mark("data-ready");

    expect(performance.mark).toHaveBeenCalledTimes(1);
  });

  it("reads back each mark's time, and leaves out one not yet emitted", () => {
    const performance = fakePerformance();
    const marks = createPerformanceMarks(performance);

    performance.tick(120);
    marks.mark("first-render");
    performance.tick(300);
    marks.mark("data-ready");

    expect(marks.read()).toEqual({ "first-render": 120, "data-ready": 420 });
    expect(createPerformanceMarks(fakePerformance()).read()).toEqual({});
  });

  it("does nothing where the host has no Performance API", () => {
    const marks = createPerformanceMarks(undefined);

    expect(() => marks.mark("first-render")).not.toThrow();
    expect(marks.read()).toEqual({});
  });
});
