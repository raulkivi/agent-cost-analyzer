// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { compareScope, keepLine, seriesScope } from "./cost-scope.js";

const PLACEHOLDERS = { project: "(no-project)", repository: "(unattributed)" };

describe("seriesScope: the list-box selection as a cost time-series request (plan §11.1)", () => {
  it("draws every project when nothing is selected", () => {
    expect(seriesScope({}, PLACEHOLDERS)).toEqual({ groupBy: "project", ignored: [] });
  });

  it("asks for the selected projects by id", () => {
    expect(seriesScope({ project: ["portal", "billing"] }, PLACEHOLDERS)).toEqual({ groupBy: "project", ids: ["portal", "billing"], ignored: [] });
  });

  it("asks for the selected repositories when no project is selected", () => {
    expect(seriesScope({ repository: ["github.com/acme/portal-web"] }, PLACEHOLDERS)).toEqual({
      groupBy: "repository",
      ids: ["github.com/acme/portal-web"],
      ignored: [],
    });
  });

  it("keeps the No project bucket by filtering the lines, since an id can't name it", () => {
    const scope = seriesScope({ project: ["portal", "(no-project)"] }, PLACEHOLDERS);
    expect(scope).toEqual({ groupBy: "project", keep: ["portal", null], ignored: [] });
  });

  it("filters by one selected provider, and lists every selection the API can't apply", () => {
    expect(seriesScope({ provider: ["vscode"], model: ["gpt-6.1-sol"], date: [] }, PLACEHOLDERS)).toEqual({
      groupBy: "project",
      providerId: "vscode",
      ignored: ["model"],
    });
    expect(seriesScope({ provider: ["vscode", "pi-agent"], project: ["portal"], repository: ["x"] }, PLACEHOLDERS).ignored).toEqual(["provider", "repository"]);
  });

  it("matches a redacted local repository key to the line the API returns", () => {
    const scope = seriesScope({ repository: ["local:/home/dev/scratch", "(unattributed)"] }, PLACEHOLDERS);
    expect(scope.keep).toEqual(["local:/home/dev/scratch", null]);
    expect(keepLine(scope, "local:scratch")).toBe(true);
    expect(keepLine(scope, null)).toBe(true);
    expect(keepLine(scope, "github.com/acme/other")).toBe(false);
    expect(keepLine({ groupBy: "project" }, "anything")).toBe(true);
  });
});

describe("compareScope: which repositories or projects the Compare tab compares (plan §11.3)", () => {
  it("compares the selected values of the grouping field", () => {
    expect(compareScope("project", { project: ["portal", "billing"] }, ["portal", "billing", "tools"], PLACEHOLDERS)).toEqual({
      ids: ["portal", "billing"],
      ignored: [],
    });
  });

  it("compares every possible value when fewer than two are selected, without the placeholder buckets", () => {
    expect(compareScope("project", {}, ["portal", "billing", "(no-project)"], PLACEHOLDERS)).toEqual({ ids: ["portal", "billing"], ignored: [] });
    expect(compareScope("repository", { project: ["portal"] }, ["github.com/acme/a", "github.com/acme/b", "(unattributed)"], PLACEHOLDERS)).toEqual({
      ids: ["github.com/acme/a", "github.com/acme/b"],
      ignored: [],
    });
  });

  it("caps the comparison at 20, the API's limit", () => {
    const many = Array.from({ length: 25 }, (_, index) => `p${index}`);
    expect(compareScope("project", {}, many, PLACEHOLDERS).ids).toHaveLength(20);
  });

  it("lists the selections the figures can't follow", () => {
    expect(compareScope("project", { model: ["x"], provider: ["vscode"] }, ["a", "b"], PLACEHOLDERS)).toEqual({
      ids: ["a", "b"],
      providerId: "vscode",
      ignored: ["model"],
    });
  });
});
