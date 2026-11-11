// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// wdio reporter of the real-Copilot suite: writes each test's title, suite
// and state to the run's evidence directory when the worker ends, for
// wdio.copilot.conf.mts's onComplete to record as release evidence (G2).
// It sees tests a suite-level skip never ran, which a mocha hook doesn't.
// TDD exception: only a real wdio run drives a reporter; what it writes is
// read by the unit-tested run-artifacts.mts and build.mts.
import WDIOReporter, { type RunnerStats, type TestStats } from "@wdio/reporter";
import type { ReporterTestResult } from "../../../../scripts/release-evidence/build.mts";
import { writeWorkerResults } from "../../../../scripts/release-evidence/run-artifacts.mts";

// Optional in the type only because wdio's reporter class contract takes partial options.
export type ResultsReporterOptions = ConstructorParameters<typeof WDIOReporter>[0] & { evidenceDir?: string };

export default class CopilotE2eResultsReporter extends WDIOReporter {
  private readonly evidenceDir: string;
  private readonly results: ReporterTestResult[] = [];

  constructor(options: ResultsReporterOptions) {
    super(options);
    if (options.evidenceDir === undefined) throw new Error("CopilotE2eResultsReporter needs an evidenceDir option");
    this.evidenceDir = options.evidenceDir;
  }

  private add(test: TestStats): void {
    this.results.push({ title: test.title, parent: test.parent, state: test.state });
  }

  override onTestPass(test: TestStats): void {
    this.add(test);
  }

  override onTestFail(test: TestStats): void {
    this.add(test);
  }

  override onTestSkip(test: TestStats): void {
    this.add(test);
  }

  override onTestPending(test: TestStats): void {
    this.add(test);
  }

  override onRunnerEnd(runner: RunnerStats): void {
    writeWorkerResults(this.evidenceDir, runner.cid, this.results);
  }
}
