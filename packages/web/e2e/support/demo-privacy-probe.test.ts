// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { findForbidden } from "../../../vscode-extension/scripts/demo/privacy-probe.mts";
import { sceneForbiddenTerms } from "../demo/support/privacy-probe.js";

const OS = { homedir: "/home/someone", username: "someone" };

describe("sceneForbiddenTerms", () => {
  it("holds the owner-private terms and the word fixture", () => {
    const terms = sceneForbiddenTerms("acme-corp, jane.doe", OS);
    expect(terms).toEqual(expect.arrayContaining(["acme-corp", "jane.doe", "/home/someone", "someone", "fixture"]));
  });

  it("matches the word fixture in any case, in titles and model names alike", () => {
    const terms = sceneForbiddenTerms(undefined, OS);
    for (const text of ["Fixture session", "fixture-main-model", "A FIXTURE row"]) expect(findForbidden([{ source: "page", text }], terms)).not.toEqual([]);
    expect(findForbidden([{ source: "page", text: "Draft the release notes" }], terms)).toEqual([]);
  });
});
