// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { buildEvidence, parseRunLog, serializeRunLogEntry, type RunFacts } from "./build.mts";
import { parseEvidence } from "./evidence.mts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const SUITE = "Real Copilot agent mode";

const facts: RunFacts = {
  commit: SHA,
  dirty: false,
  extensionVersion: "0.6.0",
  vscodeVersion: "1.145.0",
  requestedModel: "claude-haiku-5.5",
  ranAt: new Date("2026-11-11T10:00:00.000Z"),
};

describe("parseRunLog and serializeRunLogEntry (what the specs tell the recorder)", () => {
  it("round-trips one JSON entry per line and ignores blank lines", () => {
    const entries = [
      { kind: "skip", scope: "test", title: "1.4 x", reason: "ran gpt-6-luna" },
      { kind: "observed-model", model: "claude-haiku-5-5" },
      { kind: "credits", spent: 0.01 },
    ] as const;
    const text = `${entries.map(serializeRunLogEntry).join("")}\n`;
    expect(parseRunLog(text)).toEqual(entries);
  });

  it("writes each entry on one line", () => {
    expect(serializeRunLogEntry({ kind: "skip", scope: "suite", title: "a\nb", reason: "r" })).toMatch(/^[^\n]*\n$/);
  });

  it.each(["{", '{"kind":"other"}', '{"kind":"credits","spent":"1"}', '{"kind":"skip","scope":"file","title":"t","reason":"r"}', '{"kind":"observed-model"}'])(
    "refuses the line %j, naming its number",
    (line) => {
      expect(() => parseRunLog(`\n${line}\n`)).toThrow(/line 2/);
    },
  );
});

describe("buildEvidence (one record from the reporter's results and the run log)", () => {
  it("records the run's facts and each test's state", () => {
    const evidence = buildEvidence(facts, [
      { title: "1.4 a", parent: SUITE, state: "passed" },
      { title: "2.3 b", parent: SUITE, state: "failed" },
    ], []);

    expect(evidence).toEqual({
      schema: 1,
      suite: "copilot-e2e",
      commit: SHA,
      dirty: false,
      extensionVersion: "0.6.0",
      vscodeVersion: "1.145.0",
      model: { requested: "claude-haiku-5.5", observed: [] },
      tests: [
        { title: "1.4 a", state: "passed", skipReason: null },
        { title: "2.3 b", state: "failed", skipReason: null },
      ],
      aiCreditsSpent: null,
      ranAt: "2026-11-11T10:00:00.000Z",
    });
    expect(parseEvidence(JSON.stringify(evidence))).toEqual({ ok: true, evidence });
  });

  it("records a dirty tree as it was, never hides it", () => {
    expect(buildEvidence({ ...facts, dirty: true }, [], []).dirty).toBe(true);
  });

  it("treats wdio's pending state as skipped", () => {
    expect(buildEvidence(facts, [{ title: "1.4 a", parent: SUITE, state: "pending" }], []).tests[0]!.state).toBe("skipped");
  });

  it("gives a skipped test its own reason first, else its suite's, else none", () => {
    const evidence = buildEvidence(
      facts,
      [
        { title: "1.4 a", parent: SUITE, state: "skipped" },
        { title: "2.3 b", parent: SUITE, state: "skipped" },
        { title: "2.4 c", parent: "another suite", state: "skipped" },
        { title: "9.9 passed", parent: SUITE, state: "passed" },
      ],
      [
        { kind: "skip", scope: "suite", title: SUITE, reason: "not signed in" },
        { kind: "skip", scope: "test", title: "1.4 a", reason: "ran gpt-6-luna" },
        { kind: "skip", scope: "test", title: "9.9 passed", reason: "stale" },
      ],
    );

    expect(evidence.tests.map((test) => test.skipReason)).toEqual(["ran gpt-6-luna", "not signed in", null, null]);
  });

  it("lists each observed model once, in order, and sums the AI Credits the specs measured", () => {
    const evidence = buildEvidence(facts, [], [
      { kind: "observed-model", model: "claude-haiku-5-5" },
      { kind: "credits", spent: 0.25 },
      { kind: "observed-model", model: "gpt-6-luna" },
      { kind: "observed-model", model: "claude-haiku-5-5" },
      { kind: "credits", spent: 0.5 },
    ]);

    expect(evidence.model.observed).toEqual(["claude-haiku-5-5", "gpt-6-luna"]);
    expect(evidence.aiCreditsSpent).toBe(0.75);
  });
});
