// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { EXTENSION_NO_PROJECTS_REASON } from "./index.js";

describe("EXTENSION_NO_PROJECTS_REASON", () => {
  it("is the text users read when the extension has no projects", () => {
    expect(EXTENSION_NO_PROJECTS_REASON).toBe(
      "AI Credits Analyzer has no projects: projects are edited in the standalone Agent Cost Analyzer app. Every turn is in No project; repositories are listed as usual.",
    );
  });
});
