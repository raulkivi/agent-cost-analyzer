// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Manifest rules of the `agent-cost-analyser` alias (npm-package.md D3, §4.1,
// §4.2, §4.7). The name's British spelling is the point of the package.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const aliasDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
const manifest = readJson(join(aliasDir, "package.json"));
const root = readJson(join(aliasDir, "..", "..", "package.json"));

describe("packages/cli-alias manifest", () => {
  it("publishes as agent-cost-analyser, an ESM package for Node 22.18+", () => {
    expect(manifest.name).toBe("agent-cost-analyser"); // codespell:ignore analyser
    expect(manifest.type).toBe("module");
    expect(manifest.license).toBe("MIT");
    expect(manifest.engines).toEqual({ node: ">=22.18" });
  });

  it("has the exact repository url that trusted publishing matches", () => {
    expect(manifest.repository).toEqual({
      type: "git",
      url: "git+https://github.com/raulkivi/agent-cost-analyzer.git",
      directory: "packages/cli-alias",
    });
    expect(manifest.homepage).toBe("https://github.com/raulkivi/agent-cost-analyzer#readme");
  });

  it("ships only bin/", () => {
    expect(manifest.files).toEqual(["bin/"]);
  });

  it("has no scripts and no lifecycle keys, so nothing runs on install", () => {
    expect(manifest).not.toHaveProperty("scripts");
    expect(manifest).not.toHaveProperty("gypfile");
  });

  it("depends on exactly one package, agent-cost-analyzer, by a range", () => {
    expect(manifest.dependencies).toEqual({ "agent-cost-analyzer": ">=0.16.0 <2" });
    for (const key of ["optionalDependencies", "peerDependencies", "bundledDependencies", "bundleDependencies", "devDependencies"]) {
      expect(manifest[key] ?? {}).toEqual({});
    }
  });

  it("links the bin to a Node shim with an LF shebang that runs the real launcher", () => {
    expect(manifest.bin).toEqual({ "agent-cost-analyser": "bin/run.js" }); // codespell:ignore analyser
    const shim = join(aliasDir, "bin", "run.js");
    expect(existsSync(shim)).toBe(true);
    const text = readFileSync(shim, "utf-8");
    expect(text.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(text).not.toContain("\r");
    expect(text).toContain('import "agent-cost-analyzer/bin/agent-cost-analyzer.js";');
  });

  it("is a workspace of the private root and carries the root's LICENSE", () => {
    expect(root.workspaces).toContain("packages/cli-alias");
    expect(readFileSync(join(aliasDir, "LICENSE"), "utf-8")).toBe(readFileSync(join(aliasDir, "..", "..", "LICENSE"), "utf-8"));
  });

  it("has a README for the npm page", () => {
    expect(readFileSync(join(aliasDir, "README.md"), "utf-8")).toContain("agent-cost-analyzer");
  });

  it("is versioned on its own: 0.16.0 or later, inside the dependency's range", () => {
    const [major, minor] = String(manifest.version).split(".").map(Number);
    expect(major === 1 || (major === 0 && minor! >= 16)).toBe(true);
  });
});
