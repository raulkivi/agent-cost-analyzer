// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { findForbidden, parseForbidden } from "./privacy-probe.mts";

describe("parseForbidden", () => {
  it("returns an empty list for undefined or blank", () => {
    expect(parseForbidden(undefined)).toEqual([]);
    expect(parseForbidden("  ")).toEqual([]);
  });
  it("splits on commas, trims and drops empties", () => {
    expect(parseForbidden(" alice , ,bob@example.com,")).toEqual(["alice", "bob@example.com"]);
  });
  it("rejects a term shorter than 3 characters, which would match nearly everything", () => {
    expect(() => parseForbidden("okay,ab")).toThrow(/ab/);
  });
});

describe("findForbidden", () => {
  it("matches case-insensitively as a substring", () => {
    expect(findForbidden([{ source: "title", text: "Hello ALICE" }], ["alice"])).toEqual([{ source: "title", match: "alice" }]);
  });
  it("returns one entry per source and term, even for repeated hits", () => {
    const out = findForbidden(
      [
        { source: "a", text: "bob bob bob" },
        { source: "b", text: "Bob" },
      ],
      ["bob"],
    );
    expect(out).toEqual([
      { source: "a", match: "bob" },
      { source: "b", match: "bob" },
    ]);
  });
  it("does not duplicate a duplicated forbidden term", () => {
    expect(findForbidden([{ source: "a", text: "carol" }], ["carol", "CAROL"])).toEqual([{ source: "a", match: "carol" }]);
  });
  it("returns every distinct term found in one source", () => {
    expect(findForbidden([{ source: "a", text: "carol and dave" }], ["carol", "dave"])).toHaveLength(2);
  });
  it("finds nothing in empty texts or with no terms", () => {
    expect(findForbidden([{ source: "a", text: "" }], ["carol"])).toEqual([]);
    expect(findForbidden([{ source: "a", text: "carol" }], [])).toEqual([]);
    expect(findForbidden([], ["carol"])).toEqual([]);
  });
});
