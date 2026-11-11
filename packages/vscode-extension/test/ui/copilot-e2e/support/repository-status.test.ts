// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { groupCredits, repositoryStatusCredits } from "./repository-status.mts";

const label = (inRepo: string, all: string) => `AI Credits today: ${inRepo} in demo, ${all} in all repositories, 1 of 2 sessions today have cost data. Open analyzer.`;

describe("repositoryStatusCredits", () => {
  it("reads the repository's AI Credits from the status bar's accessible name", () => {
    expect(repositoryStatusCredits(["Notifications", label("0.31", "4.20")], "demo")).toBe(0.31);
  });

  it("is null when the status bar names another repository, or none", () => {
    expect(repositoryStatusCredits([label("0.31", "4.20")], "other")).toBeNull();
    expect(repositoryStatusCredits(["AI Credits today: 4.20, 1 of 2 sessions today have cost data. Open analyzer."], "demo")).toBeNull();
    expect(repositoryStatusCredits([], "demo")).toBeNull();
  });

  it("is null when the repository's credits are unknown (never read as 0)", () => {
    expect(repositoryStatusCredits([label("unknown", "4.20")], "demo")).toBeNull();
  });

  it("matches the name exactly, not as a suffix of another", () => {
    expect(repositoryStatusCredits([`AI Credits today: 1.00 in my-demo, 1.00 in all repositories, x. Open analyzer.`], "demo")).toBeNull();
  });
});

describe("groupCredits", () => {
  it("reads the known sum of a repository group's description", () => {
    expect(groupCredits("0.31")).toBe(0.31);
    expect(groupCredits("12.40 · 1 unknown")).toBe(12.4);
  });

  it("is null when no cost in the group is known", () => {
    expect(groupCredits("2 unknown")).toBeNull();
    expect(groupCredits("")).toBeNull();
  });
});
