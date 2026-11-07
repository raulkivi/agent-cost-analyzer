// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { knownWorkspace, sessionWorkspaceSchema, unknownWorkspace } from "./workspace.js";

describe("sessionWorkspaceSchema", () => {
  it("accepts a known workspace with only a folder", () => {
    const sample = { known: true, cwd: "/home/dev/app" };
    expect(sessionWorkspaceSchema.parse(sample)).toEqual(sample);
  });

  it("accepts a known workspace with a repository hint and a branch", () => {
    const sample = { known: true, cwd: "/home/dev/app", repositoryHint: "org/app", branch: "main" };
    expect(sessionWorkspaceSchema.parse(sample)).toEqual(sample);
  });

  it("accepts an unknown workspace with its reason", () => {
    const sample = { known: false, reason: "mitmproxy captures record no working folder" };
    expect(sessionWorkspaceSchema.parse(sample)).toEqual(sample);
  });

  it("rejects a known workspace with an empty folder", () => {
    expect(sessionWorkspaceSchema.safeParse({ known: true, cwd: "" }).success).toBe(false);
  });

  it("rejects an unknown workspace without a reason (constraint 6)", () => {
    expect(sessionWorkspaceSchema.safeParse({ known: false, reason: "" }).success).toBe(false);
    expect(sessionWorkspaceSchema.safeParse({ known: false }).success).toBe(false);
  });

  it("rejects empty optional strings rather than keeping them as values", () => {
    expect(sessionWorkspaceSchema.safeParse({ known: true, cwd: "/a", branch: "" }).success).toBe(false);
    expect(sessionWorkspaceSchema.safeParse({ known: true, cwd: "/a", repositoryHint: "" }).success).toBe(false);
  });
});

describe("knownWorkspace", () => {
  it("keeps the folder and drops missing or blank hints", () => {
    expect(knownWorkspace("/home/dev/app")).toEqual({ known: true, cwd: "/home/dev/app" });
    expect(knownWorkspace("/home/dev/app", { repositoryHint: "  ", branch: null })).toEqual({ known: true, cwd: "/home/dev/app" });
    expect(knownWorkspace("/home/dev/app", { repositoryHint: "org/app", branch: "main" })).toEqual({
      known: true,
      cwd: "/home/dev/app",
      repositoryHint: "org/app",
      branch: "main",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(knownWorkspace(" /home/dev/app ", { branch: " main " })).toEqual({ known: true, cwd: "/home/dev/app", branch: "main" });
  });

  it("returns null for a missing or blank folder, so callers choose the reason", () => {
    expect(knownWorkspace(null)).toBeNull();
    expect(knownWorkspace(undefined)).toBeNull();
    expect(knownWorkspace("   ")).toBeNull();
  });
});

describe("unknownWorkspace", () => {
  it("builds the unknown shape", () => {
    expect(unknownWorkspace("no folder recorded")).toEqual({ known: false, reason: "no folder recorded" });
  });
});
