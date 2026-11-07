// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RepositoryResolver } from "../../services/cost-attribution/repository-resolver.js";
import { NodeReadOnlyFileSystem } from "./node-read-only-file-system.js";

describe("NodeReadOnlyFileSystem", () => {
  let dir: string;
  const fs = new NodeReadOnlyFileSystem();

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ro-fs-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("tells files from directories and missing paths", () => {
    writeFileSync(path.join(dir, "a.txt"), "x");

    expect(fs.kindOf(path.join(dir, "a.txt"))).toBe("file");
    expect(fs.kindOf(dir)).toBe("directory");
    expect(fs.kindOf(path.join(dir, "missing"))).toBeNull();
  });

  it("reads a small text file and refuses one over the limit", () => {
    writeFileSync(path.join(dir, "small"), "hello");
    writeFileSync(path.join(dir, "big"), "x".repeat(2048));

    expect(fs.readText(path.join(dir, "small"), 1024)).toBe("hello");
    expect(fs.readText(path.join(dir, "big"), 1024)).toBeNull();
  });

  it("returns null for a missing file or a directory", () => {
    expect(fs.readText(path.join(dir, "missing"), 1024)).toBeNull();
    expect(fs.readText(dir, 1024)).toBeNull();
  });

  it("lets the resolver find a real repository's remote on disk", () => {
    mkdirSync(path.join(dir, "app", ".git"), { recursive: true });
    mkdirSync(path.join(dir, "app", "src"));
    writeFileSync(path.join(dir, "app", ".git", "config"), '[remote "origin"]\n\turl = git@github.com:org/app.git\n');

    expect(new RepositoryResolver(fs).resolve({ known: true, cwd: path.join(dir, "app", "src") })).toEqual({
      attributed: true,
      repository: { key: "github.com/org/app", source: "git-remote", rootPath: path.join(dir, "app"), pathInRepo: "src" },
    });
  });
});
