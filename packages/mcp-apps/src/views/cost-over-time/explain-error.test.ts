// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { EXTENSION_NO_PROJECTS_REASON } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { explainError } from "./explain-error.js";

const REASON = EXTENSION_NO_PROJECTS_REASON;
const BASE = 'Unknown project id "provider-platform". Call list_projects to find valid ids.';

describe("explainError", () => {
  it("recognises the extension's no-projects answer and separates the reason from the tool's own words", () => {
    expect(explainError(`${BASE} ${REASON}`)).toEqual({ kind: "no-projects", reason: REASON, answer: 'Unknown project id "provider-platform"' });
  });

  it("treats an unknown id without a reason as a plain error showing the text", () => {
    expect(explainError(BASE)).toEqual({ kind: "error", text: BASE });
  });

  it("shows any other tool error text as it is", () => {
    expect(explainError("periodB: month must be YYYY-MM")).toEqual({ kind: "error", text: "periodB: month must be YYYY-MM" });
  });

  it("has no text to show when the host gave none", () => {
    expect(explainError(undefined)).toEqual({ kind: "error" });
    expect(explainError("   ")).toEqual({ kind: "error" });
  });

  it("caps a very long text, so a view never grows without bound", () => {
    const long = explainError("x".repeat(5000));
    expect(long.kind === "error" && long.text?.length).toBe(501);
  });

  it("keeps markup as inert text", () => {
    expect(explainError("<img src=x onerror=alert(1)>")).toEqual({ kind: "error", text: "<img src=x onerror=alert(1)>" });
  });
});
