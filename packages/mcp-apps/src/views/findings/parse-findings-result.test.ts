// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { findingsResult, SAMPLE_FINDINGS } from "./fixtures.js";
import { parseFindingsResult } from "./parse-findings-result.js";

describe("parseFindingsResult", () => {
  it("accepts a list_findings result", () => {
    const result = findingsResult(SAMPLE_FINDINGS);
    expect(parseFindingsResult(result)).toBe(result);
  });

  it.each([undefined, null, "text", 3, {}, { findings: [] }, { findings: {}, bySeverity: {}, total: 1 }, { findings: [], bySeverity: {}, total: "1" }])(
    "rejects %j",
    (value) => {
      expect(parseFindingsResult(value)).toBeUndefined();
    },
  );
});
