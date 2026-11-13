// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readMainJsonlFile } from "./main-jsonl-reader.js";

const subagentFixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/jsonl/subagents",
);

// Event counts of each fixture file (step 10.19 SA2). The fixtures are
// synthetic: invented ids and texts, the real structure SA0 confirmed.
interface ExpectedFile {
  file: string;
  envelopes: number;
  rawLines: number;
  types: Record<string, number>;
}

const sub = (requests: number, extra: Record<string, number> = {}) => ({
  session_start: 1,
  user_message: 1,
  turn_start: requests,
  llm_request: requests,
  tool_call: requests,
  turn_end: requests,
  ...extra,
});

const cases: Record<string, ExpectedFile[]> = {
  "run-and-search": [
    {
      file: "main.jsonl",
      envelopes: 14,
      rawLines: 14,
      types: { session_start: 1, user_message: 2, llm_request: 2, tool_call: 1, child_session_ref: 2 },
    },
    { file: "runSubagent-Explore-call_fixturerun1.jsonl", envelopes: 11, rawLines: 11, types: sub(2, { subagent: 1 }) },
    { file: "searchSubagent-call_fixturesearch1.jsonl", envelopes: 6, rawLines: 6, types: sub(1) },
  ],
  "dangling-ref": [
    { file: "main.jsonl", envelopes: 8, rawLines: 8, types: { user_message: 1, tool_call: 1, child_session_ref: 1 } },
  ],
  "orphan-by-time": [
    { file: "main.jsonl", envelopes: 11, rawLines: 11, types: { user_message: 2, child_session_ref: 0 } },
    { file: "runSubagent-Plan-call_fixtureorphan1.jsonl", envelopes: 7, rawLines: 7, types: sub(1, { subagent: 1 }) },
  ],
  "orphan-unplaceable": [
    { file: "main.jsonl", envelopes: 6, rawLines: 6, types: { user_message: 1, child_session_ref: 0 } },
    { file: "runSubagent-Plan-call_fixtureorphan2.jsonl", envelopes: 7, rawLines: 7, types: sub(1, { subagent: 1 }) },
  ],
  "request-without-credits": [
    { file: "main.jsonl", envelopes: 8, rawLines: 8, types: { child_session_ref: 1 } },
    { file: "runSubagent-Explore-call_fixturenoaiu.jsonl", envelopes: 11, rawLines: 11, types: sub(2, { subagent: 1 }) },
  ],
  "traversal-ref": [
    { file: "main.jsonl", envelopes: 7, rawLines: 7, types: { user_message: 1, child_session_ref: 1 } },
  ],
  "nested-ref": [
    { file: "main.jsonl", envelopes: 8, rawLines: 8, types: { child_session_ref: 1 } },
    {
      file: "runSubagent-Explore-call_fixturenest.jsonl",
      envelopes: 8,
      rawLines: 8,
      types: sub(1, { subagent: 1, child_session_ref: 1 }),
    },
  ],
  "partial-last-line": [
    { file: "main.jsonl", envelopes: 8, rawLines: 8, types: { child_session_ref: 1 } },
    // The truncated last line is counted raw but yields no envelope.
    { file: "runSubagent-Explore-call_fixturepart.jsonl", envelopes: 7, rawLines: 8, types: sub(1, { subagent: 1 }) },
  ],
  "ref-before-first-turn": [
    { file: "main.jsonl", envelopes: 7, rawLines: 7, types: { user_message: 1, child_session_ref: 1 } },
    { file: "runSubagent-Explore-call_fixtureearly.jsonl", envelopes: 7, rawLines: 7, types: sub(1, { subagent: 1 }) },
  ],
};

describe("subagent fixtures", () => {
  for (const [caseName, files] of Object.entries(cases)) {
    for (const expected of files) {
      it(`${caseName}/${expected.file} has the expected event counts`, async () => {
        const result = await readMainJsonlFile(path.join(subagentFixturesDir, caseName, expected.file));

        expect(result.envelopes).toHaveLength(expected.envelopes);
        expect(result.rawLineCount).toBe(expected.rawLines);
        const counts: Record<string, number> = {};
        for (const envelope of result.envelopes) {
          counts[envelope.type] = (counts[envelope.type] ?? 0) + 1;
        }
        for (const [type, count] of Object.entries(expected.types)) {
          expect(counts[type] ?? 0, type).toBe(count);
        }
      });
    }
  }

  it("keeps no prompt, response or tool text from a subagent file", async () => {
    const { envelopes } = await readMainJsonlFile(
      path.join(subagentFixturesDir, "run-and-search", "runSubagent-Explore-call_fixturerun1.jsonl"),
    );
    const serialized = JSON.stringify(envelopes);
    expect(serialized).not.toContain("Fixture subagent task");
    expect(serialized).not.toContain("Fixture tool result");
    expect(serialized).not.toContain("fixture payload");
  });
});
