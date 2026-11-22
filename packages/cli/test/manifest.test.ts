// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Manifest rules of the published package (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.1, §4.2, §4.7).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
const manifest = readJson(join(cliDir, "package.json"));
const root = readJson(join(cliDir, "..", "..", "package.json"));

describe("packages/cli manifest", () => {
  it("publishes as agent-cost-analyzer, an ESM package for Node 22.18+", () => {
    expect(manifest.name).toBe("agent-cost-analyzer");
    expect(manifest.type).toBe("module");
    expect(manifest.license).toBe("MIT");
    expect(manifest.engines).toEqual({ node: ">=22.18" });
  });

  it("has the exact repository url that trusted publishing matches", () => {
    expect(manifest.repository).toEqual({
      type: "git",
      url: "git+https://github.com/raulkivi/agent-cost-analyzer.git",
      directory: "packages/cli",
    });
  });

  it("ships only bin/, dist/ and the notices", () => {
    expect(manifest.files).toEqual(["bin/", "dist/", "THIRD-PARTY-NOTICES.md"]);
  });

  it("has no scripts, so no lifecycle script runs on install", () => {
    expect(manifest).not.toHaveProperty("scripts");
  });

  it("has no dependencies of any kind (the bundle carries them)", () => {
    for (const key of ["dependencies", "optionalDependencies", "peerDependencies", "bundledDependencies", "bundleDependencies"]) {
      expect(manifest[key] ?? {}).toEqual({});
    }
  });

  it("links the bin to a Node shim with an LF shebang", () => {
    expect(manifest.bin).toEqual({ "agent-cost-analyzer": "bin/agent-cost-analyzer.js" });
    const shim = join(cliDir, "bin", "agent-cost-analyzer.js");
    expect(existsSync(shim)).toBe(true);
    const text = readFileSync(shim, "utf-8");
    expect(text.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(text).not.toContain("\r");
  });

  it("names its MCP Registry server, which the registry checks against the published package", () => {
    expect(manifest.mcpName).toBe("io.github.raulkivi/agent-cost-analyzer");
  });

  it("has the app's version (the root package.json), so the npm version is the app version", () => {
    expect(manifest.version).toBe(root.version);
  });

  it("is a workspace of the private root, which isn't named like the package", () => {
    expect(root.private).toBe(true);
    expect(root.name).toBe("agent-cost-analyzer-monorepo");
    expect(root.workspaces).toContain("packages/cli");
  });
});
