// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { EXTENSION_NO_PROJECTS_REASON, parseUnknownProjectIdText, unknownProjectIdText } from "./index.js";

const REASON = EXTENSION_NO_PROJECTS_REASON;

describe("unknownProjectIdText", () => {
  it("is the tools' answer to an unknown project id", () => {
    expect(unknownProjectIdText("portal")).toBe('Unknown project id "portal". Call list_projects to find valid ids.');
  });

  it("appends the product's no-projects reason when there is one", () => {
    expect(unknownProjectIdText("portal", REASON)).toBe(`Unknown project id "portal". Call list_projects to find valid ids. ${REASON}`);
  });
});

describe("parseUnknownProjectIdText", () => {
  it("reads back what the builder wrote, with and without the reason", () => {
    expect(parseUnknownProjectIdText(unknownProjectIdText("portal", REASON))).toEqual({ projectId: "portal", noProjectsReason: REASON });
    expect(parseUnknownProjectIdText(unknownProjectIdText("portal"))).toEqual({ projectId: "portal" });
  });

  it("keeps a project id with quotes and dots whole", () => {
    expect(parseUnknownProjectIdText(unknownProjectIdText('a "b". c', REASON))).toEqual({ projectId: 'a "b". c', noProjectsReason: REASON });
  });

  it("accepts only a known reason, so other text after the answer is not taken for one", () => {
    expect(parseUnknownProjectIdText(`${unknownProjectIdText("x")} No projects here, honestly.`)).toBeUndefined();
  });

  // The project id comes from the model's arguments; it must not be able to
  // make a product that has projects look like one without.
  it("can't be made to report a reason by the project id", () => {
    const crafted = unknownProjectIdText(`x". Call list_projects to find valid ids. ${REASON}`);
    expect(parseUnknownProjectIdText(crafted)).toEqual({ projectId: `x". Call list_projects to find valid ids. ${REASON}` });
  });

  it("is undefined for any other text", () => {
    expect(parseUnknownProjectIdText("periodB: month must be YYYY-MM")).toBeUndefined();
    expect(parseUnknownProjectIdText("")).toBeUndefined();
  });
});
