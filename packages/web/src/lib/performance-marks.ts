// Timing marks for the §3.5 performance budgets (vscode-extension.md):
// "first-render" when the app first paints, "data-ready" when the first
// session or scenario list is on screen. They go through the standard
// Performance API (read() below reads them back), and each is also handed
// to an optional reporter as it's emitted: in the extension, the webview
// transport posts it to the host, where step 10.9's integration tests
// assert the budgets.
export const PERFORMANCE_MARKS = { firstRender: "first-render", dataReady: "data-ready" } as const;

export type PerformanceMarkName = (typeof PERFORMANCE_MARKS)[keyof typeof PERFORMANCE_MARKS];

// The slice of window.performance this needs.
export interface MarkablePerformance {
  mark(name: string): unknown;
  getEntriesByName(name: string): { startTime: number }[];
}

export interface PerformanceMarks {
  // Emits the mark the first time only: React re-renders and StrictMode's
  // double effects mustn't move it.
  mark(name: PerformanceMarkName): void;
  // Each emitted mark's time, in ms since the page started.
  read(): Partial<Record<PerformanceMarkName, number>>;
}

// Hears each mark once, with its time in ms since the page started.
export type PerformanceMarkReporter = (name: PerformanceMarkName, timeMs: number) => void;

export function createPerformanceMarks(performance: MarkablePerformance | undefined, report?: PerformanceMarkReporter): PerformanceMarks {
  const emitted = new Set<PerformanceMarkName>();
  return {
    mark(name) {
      if (!performance || emitted.has(name)) return;
      emitted.add(name);
      performance.mark(name);
      const entry = performance.getEntriesByName(name)[0];
      if (!entry || !report) return;
      try {
        report(name, entry.startTime);
      } catch {
        // Timing is diagnostics: a host that can't hear it never breaks the UI.
      }
    },
    read() {
      const times: Partial<Record<PerformanceMarkName, number>> = {};
      for (const name of Object.values(PERFORMANCE_MARKS)) {
        const entry = performance?.getEntriesByName(name)[0];
        if (entry) times[name] = entry.startTime;
      }
      return times;
    },
  };
}

// The page's own marks.
export const performanceMarks = createPerformanceMarks(globalThis.performance);
