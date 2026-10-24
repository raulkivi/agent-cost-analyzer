import type { PerformanceMarkName } from "@copilot-cost-analyzer/domain";

// What the host times itself: the Sessions tree, from the start of a full
// refresh to its nodes being built (sidebar/sidebar-controller.ts).
export type HostTimingName = "sessions-tree";

export type TimingMarkName = PerformanceMarkName | HostTimingName;

export interface TimingMark {
  name: TimingMarkName;
  // How long the user waited, in ms. For a webview mark, from the host
  // loading the page into the panel to the mark arriving, so the webview's
  // own start-up counts; for a host timing, the measured duration.
  durationMs: number;
  // Webview marks only: the mark's own time since the page started
  // (performance.mark's startTime), as the webview reported it.
  pageTimeMs?: number;
}

const DEFAULT_CAPACITY = 100;

// Records the timing marks behind the §3.5 performance budgets
// (vscode-extension.md, step 10.9): the webview's first-render and
// data-ready marks (domain rpc.ts, perfMark) and the host's own Sessions
// tree timing. Free of `vscode`, with the clock injected. Only the most
// recent marks are kept, so it costs next to nothing when no test reads it.
export class PerformanceRecorder {
  private readonly recorded: TimingMark[] = [];
  private pageLoadedAt: number | undefined;

  // `now` is a monotonic clock in ms (performance.now in the extension).
  constructor(
    private readonly now: () => number,
    private readonly capacity = DEFAULT_CAPACITY,
  ) {}

  // The host is loading a new page into the panel (a new panel, or a hidden
  // one shown again, whose page loads afresh): webview marks are timed from
  // the latest such load.
  pageLoading(): void {
    this.pageLoadedAt = this.now();
  }

  // A mark the webview posted. With no page load seen, the page's own time
  // is the best measure there is.
  recordWebviewMark(name: PerformanceMarkName, pageTimeMs: number): void {
    const durationMs = this.pageLoadedAt === undefined ? pageTimeMs : this.now() - this.pageLoadedAt;
    this.push({ name, durationMs, pageTimeMs });
  }

  recordDuration(name: HostTimingName, durationMs: number): void {
    this.push({ name, durationMs });
  }

  // Oldest first; a copy.
  marks(): TimingMark[] {
    return this.recorded.map((mark) => ({ ...mark }));
  }

  clear(): void {
    this.recorded.length = 0;
    this.pageLoadedAt = undefined;
  }

  private push(mark: TimingMark): void {
    this.recorded.push(mark);
    if (this.recorded.length > this.capacity) {
      this.recorded.splice(0, this.recorded.length - this.capacity);
    }
  }
}
