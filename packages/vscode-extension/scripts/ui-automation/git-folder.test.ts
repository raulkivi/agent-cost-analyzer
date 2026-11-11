// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGitFolder, E2E_REMOTE, E2E_REPOSITORY } from "./git-folder.mts";

describe("createGitFolder", () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const originOf = (dir: string) => execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();

  it("makes a real git repository whose origin is the made-up remote", () => {
    root = mkdtempSync(path.join(tmpdir(), "aica-git-folder-"));
    const dir = path.join(root, "demo");

    createGitFolder(dir, E2E_REMOTE);

    expect(execFileSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).trim()).toBe("true");
    expect(originOf(dir)).toBe(E2E_REMOTE);
  });

  it("creates missing parent folders and accepts an existing empty folder", () => {
    root = mkdtempSync(path.join(tmpdir(), "aica-git-folder-"));
    createGitFolder(path.join(root, "a", "b"), E2E_REMOTE);
    createGitFolder(root, "https://github.com/aica-e2e/other.git");
    expect(originOf(root)).toBe("https://github.com/aica-e2e/other.git");
  });

  it("names the repository the analyzer derives from that remote", () => {
    expect(E2E_REMOTE).toBe("https://github.com/aica-e2e/demo.git");
    expect(E2E_REPOSITORY).toEqual({ key: "github.com/aica-e2e/demo", name: "demo" });
  });
});
