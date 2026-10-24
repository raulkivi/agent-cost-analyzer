import { describe, expect, it } from "vitest";
import { PerformanceRecorder } from "./performance-recorder.js";

// A clock the test moves by hand.
function fakeClock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("PerformanceRecorder (vscode-extension.md §3.5 Performance, step 10.9)", () => {
  it("starts empty", () => {
    expect(new PerformanceRecorder(fakeClock().now).marks()).toEqual([]);
  });

  it("times a webview mark from when the host loaded the page to when the mark arrived", () => {
    const clock = fakeClock();
    const recorder = new PerformanceRecorder(clock.now);

    recorder.pageLoading();
    clock.advance(450);
    recorder.recordWebviewMark("first-render", 300);

    expect(recorder.marks()).toEqual([{ name: "first-render", durationMs: 450, pageTimeMs: 300 }]);
  });

  it("measures each mark from the latest page load (a hidden panel's page loads again when shown)", () => {
    const clock = fakeClock();
    const recorder = new PerformanceRecorder(clock.now);

    recorder.pageLoading();
    clock.advance(5_000);
    recorder.pageLoading();
    clock.advance(200);
    recorder.recordWebviewMark("data-ready", 180);

    expect(recorder.marks()).toEqual([{ name: "data-ready", durationMs: 200, pageTimeMs: 180 }]);
  });

  it("falls back to the page's own time for a mark with no page load seen", () => {
    const recorder = new PerformanceRecorder(fakeClock().now);

    recorder.recordWebviewMark("first-render", 320);

    expect(recorder.marks()).toEqual([{ name: "first-render", durationMs: 320, pageTimeMs: 320 }]);
  });

  it("records a host-side duration as measured", () => {
    const recorder = new PerformanceRecorder(fakeClock().now);

    recorder.recordDuration("sessions-tree", 42.5);

    expect(recorder.marks()).toEqual([{ name: "sessions-tree", durationMs: 42.5 }]);
  });

  it("keeps only the most recent marks, so a long session can't grow it without bound", () => {
    const recorder = new PerformanceRecorder(fakeClock().now, 3);

    for (const ms of [1, 2, 3, 4, 5]) recorder.recordDuration("sessions-tree", ms);

    expect(recorder.marks().map((mark) => mark.durationMs)).toEqual([3, 4, 5]);
  });

  it("hands out a copy, and clear() forgets every mark and the page load", () => {
    const clock = fakeClock();
    const recorder = new PerformanceRecorder(clock.now);
    recorder.pageLoading();
    recorder.recordDuration("sessions-tree", 1);

    recorder.marks().pop();
    expect(recorder.marks()).toHaveLength(1);

    recorder.clear();
    clock.advance(999);
    recorder.recordWebviewMark("first-render", 10);
    expect(recorder.marks()).toEqual([{ name: "first-render", durationMs: 10, pageTimeMs: 10 }]);
  });
});
