// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Release evidence for owner decision D1 (docs/plans/release-ui-gate.md, G2):
// the real-Copilot suite runs on the owner's machine, never in CI, and its
// result is kept as a git note on the commit it ran on. This module is the
// note's format and the verdict on it; the release workflow refuses an
// `ext-v*` tag whose commit has no note it accepts.

export const EVIDENCE_SCHEMA = 1;
export const COPILOT_E2E_SUITE = "copilot-e2e";

// The real-chat checks of docs/plans/vscode-extension-manual-checks.md the
// suite covers. Spec titles start with these ids (copilotTestTitle), so a
// renamed or deleted test shows up as missing instead of dropping out.
export const COPILOT_CHAT_CHECKS = ["1.4", "2.3", "2.4"] as const;

// G4 (step 10.17): the MCP App view rows of mcp-apps-a24-checklist.md §1 and
// mcp-apps-a16-checklist.md §1 that copilot-views.e2e.ts checks in a real
// Copilot Chat. A16's themes and narrow rows run inside A24 1.7 and 1.8.
export const COPILOT_VIEW_ROWS = [
  "A24 1.1",
  "A24 1.2",
  "A24 1.3",
  "A24 1.4",
  "A24 1.5",
  "A24 1.6",
  "A24 1.7",
  "A24 1.8",
  "A24 1.9",
  "A16 U1",
  "A16 U2",
  "A16 U3",
  "A16 keyboard",
] as const;

export const REQUIRED_COPILOT_E2E_TESTS = [...COPILOT_CHAT_CHECKS, ...COPILOT_VIEW_ROWS] as const;

export type EvidenceTestState = "passed" | "failed" | "skipped";

export interface EvidenceTest {
  title: string;
  state: EvidenceTestState;
  skipReason: string | null;
}

export interface ReleaseEvidence {
  schema: typeof EVIDENCE_SCHEMA;
  suite: typeof COPILOT_E2E_SUITE;
  // Full SHA of HEAD when the run started.
  commit: string;
  // The working tree had changes (tracked or untracked), so the run didn't test `commit` alone.
  dirty: boolean;
  extensionVersion: string;
  vscodeVersion: string;
  // `observed` is every model id Copilot's sessions recorded, in order seen.
  model: { requested: string; observed: string[] };
  tests: EvidenceTest[];
  // Null when the run couldn't measure them.
  aiCreditsSpent: number | null;
  ranAt: string;
}

export type ProblemCode =
  | "missing-note"
  | "malformed"
  | "unknown-schema"
  | "wrong-commit"
  | "dirty-tree"
  | "test-missing"
  | "test-failed"
  | "test-skipped";

export interface Problem {
  code: ProblemCode;
  message: string;
}

export interface Expectation {
  commit: string;
  requiredTests: readonly string[];
}

const RUN_HINT =
  "run `COPILOT_E2E=1 COPILOT_E2E_USER_DATA_DIR=<profile> xvfb-run -a npm run test:ui:vscode:copilot --workspace=packages/vscode-extension` on a clean checkout of that commit, then `git push origin refs/notes/release-ui`";

export function copilotTestTitle(id: string, text: string): string {
  return `${id} ${text}`;
}

// A check id ("2.3") or a checklist row id ("A24 1.1", "A16 U1", "A16 keyboard"; G4).
export function testIdOf(title: string): string | undefined {
  return /^(\d+\.\d+|A\d+ [A-Za-z0-9.]+) \S/.exec(title)?.[1];
}

type Parsed = { ok: true; evidence: ReleaseEvidence } | { ok: false; problems: Problem[] };

const KEYS = ["schema", "suite", "commit", "dirty", "extensionVersion", "vscodeVersion", "model", "tests", "aiCreditsSpent", "ranAt"];
const STATES: readonly string[] = ["passed", "failed", "skipped"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isTest(value: unknown): value is EvidenceTest {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    isNonEmptyString(value.title) &&
    typeof value.state === "string" &&
    STATES.includes(value.state) &&
    (value.skipReason === null || typeof value.skipReason === "string")
  );
}

// Why `value` isn't a schema-1 record, or undefined when it is one.
function shapeError(value: Record<string, unknown>): string | undefined {
  const unknownKey = Object.keys(value).find((key) => !KEYS.includes(key));
  if (unknownKey !== undefined) return `unknown field "${unknownKey}"`;
  if (value.suite !== COPILOT_E2E_SUITE) return `suite must be "${COPILOT_E2E_SUITE}"`;
  // Lower-case SHA-1 or SHA-256, as `git rev-parse` prints it.
  if (typeof value.commit !== "string" || !/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(value.commit)) return "commit must be a full lower-case SHA";
  if (typeof value.dirty !== "boolean") return "dirty must be true or false";
  if (!isNonEmptyString(value.extensionVersion)) return "extensionVersion must be a version";
  if (!isNonEmptyString(value.vscodeVersion)) return "vscodeVersion must be a version";
  const model = value.model;
  if (!isRecord(model) || !isNonEmptyString(model.requested) || !Array.isArray(model.observed) || !model.observed.every(isNonEmptyString)) {
    return "model must hold the requested id and the observed ids";
  }
  if (!Array.isArray(value.tests) || !value.tests.every(isTest)) return "tests must each have a title, a state (passed, failed or skipped) and a skipReason (text or null)";
  const credits = value.aiCreditsSpent;
  if (credits !== null && !(typeof credits === "number" && Number.isFinite(credits) && credits >= 0)) return "aiCreditsSpent must be a number of at least 0, or null";
  if (typeof value.ranAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value.ranAt) || Number.isNaN(Date.parse(value.ranAt))) return "ranAt must be an ISO date and time";
  return undefined;
}

export function parseEvidence(text: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, problems: [{ code: "malformed", message: "The release evidence note isn't JSON." }] };
  }
  if (!isRecord(value)) return { ok: false, problems: [{ code: "malformed", message: "The release evidence note isn't a JSON object." }] };
  if (!Number.isInteger(value.schema)) return { ok: false, problems: [{ code: "malformed", message: "The release evidence note has no schema version." }] };
  if (value.schema !== EVIDENCE_SCHEMA) {
    return {
      ok: false,
      problems: [{ code: "unknown-schema", message: `The release evidence note has schema ${String(value.schema)}; this check reads schema ${EVIDENCE_SCHEMA}.` }],
    };
  }
  const error = shapeError(value);
  if (error !== undefined) return { ok: false, problems: [{ code: "malformed", message: `The release evidence note is malformed: ${error}.` }] };
  return { ok: true, evidence: value as unknown as ReleaseEvidence };
}

function requiredTestProblems(evidence: ReleaseEvidence, id: string): Problem[] {
  const tests = evidence.tests.filter((test) => testIdOf(test.title) === id);
  if (tests.length === 0) {
    return [{ code: "test-missing", message: `Required test ${id} isn't in the run (renamed, deleted, or the spec didn't load).` }];
  }
  const failed = tests.find((test) => test.state === "failed");
  if (failed) return [{ code: "test-failed", message: `Required test ${id} failed: "${failed.title}".` }];
  const skipped = tests.find((test) => test.state === "skipped");
  if (skipped) {
    const reason = skipped.skipReason === null ? "no reason recorded" : `"${skipped.skipReason}"`;
    return [
      {
        code: "test-skipped",
        message: `Required test ${id} was skipped (${reason}). A skip proves nothing about the release (Copilot didn't run the chat, call the tool, or use the requested model): fix the cause and rerun the suite.`,
      },
    ];
  }
  return [];
}

export function judgeEvidence(evidence: ReleaseEvidence, expectation: Expectation): Problem[] {
  const problems: Problem[] = [];
  if (evidence.commit !== expectation.commit.toLowerCase()) {
    problems.push({ code: "wrong-commit", message: `The evidence is for commit ${evidence.commit}, not the release commit ${expectation.commit.toLowerCase()}.` });
  }
  if (evidence.dirty) {
    problems.push({ code: "dirty-tree", message: "The run's working tree had changes, so it didn't test the commit alone: commit or remove them and rerun the suite." });
  }
  for (const id of expectation.requiredTests) problems.push(...requiredTestProblems(evidence, id));
  const required = new Set(expectation.requiredTests);
  for (const test of evidence.tests) {
    const id = testIdOf(test.title);
    if (test.state === "failed" && (id === undefined || !required.has(id))) {
      problems.push({ code: "test-failed", message: `Test "${test.title}" failed; a red suite isn't released.` });
    }
  }
  return problems;
}

export interface Verdict {
  evidence?: ReleaseEvidence;
  problems: Problem[];
}

// `note` is the text of `git notes --ref=release-ui show <commit>`, or
// undefined when the commit has none.
export function evaluateNote(note: string | undefined, expectation: Expectation): Verdict {
  if (note === undefined) {
    return { problems: [{ code: "missing-note", message: `Commit ${expectation.commit} has no release evidence (refs/notes/release-ui): ${RUN_HINT}.` }] };
  }
  const parsed = parseEvidence(note);
  if (!parsed.ok) return { problems: parsed.problems };
  return { evidence: parsed.evidence, problems: judgeEvidence(parsed.evidence, expectation) };
}
