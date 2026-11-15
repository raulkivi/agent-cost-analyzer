// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createWarningFilter, isSupportedNode, unsupportedNodeMessage } from "../bin/node-gate.js";

const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("isSupportedNode", () => {
  it.each(["21.7.3", "20.19.0", "22.0.0", "22.17.0", "22.17.9", "18.20.4", "8.0.0"])("refuses %s", (v) => {
    expect(isSupportedNode(v)).toBe(false);
  });
  it.each(["22.18.0", "22.18.1", "22.19.0", "24.0.0", "24.15.0", "100.0.0"])("accepts %s", (v) => {
    expect(isSupportedNode(v)).toBe(true);
  });
  it("refuses a version it cannot read", () => {
    expect(isSupportedNode("")).toBe(false);
    expect(isSupportedNode("nonsense")).toBe(false);
  });
});

describe("unsupportedNodeMessage", () => {
  it("names the required and the running version", () => {
    expect(unsupportedNodeMessage("21.7.3")).toBe("Agent Cost Analyzer needs Node.js 22.18 or newer; this is 21.7.3");
  });
});

describe("createWarningFilter", () => {
  const sqlite = "SQLite is an experimental feature and might change at any time";
  function setup() {
    const seen: unknown[][] = [];
    const filtered = createWarningFilter((...args: unknown[]) => void seen.push(args));
    return { seen, filtered };
  }

  it("drops the node:sqlite ExperimentalWarning given as a string plus type", () => {
    const { seen, filtered } = setup();
    filtered(sqlite, "ExperimentalWarning");
    expect(seen).toEqual([]);
  });

  it("drops it given as a warning object", () => {
    const { seen, filtered } = setup();
    filtered(Object.assign(new Error(sqlite), { name: "ExperimentalWarning" }));
    expect(seen).toEqual([]);
  });

  it("drops it given as a type option object", () => {
    const { seen, filtered } = setup();
    filtered(sqlite, { type: "ExperimentalWarning" });
    expect(seen).toEqual([]);
  });

  it("passes other experimental warnings through unchanged", () => {
    const { seen, filtered } = setup();
    filtered("Type stripping is an experimental feature", "ExperimentalWarning");
    expect(seen).toEqual([["Type stripping is an experimental feature", "ExperimentalWarning"]]);
  });

  it("passes a non-experimental warning that mentions SQLite", () => {
    const { seen, filtered } = setup();
    filtered(sqlite, "DeprecationWarning");
    expect(seen).toHaveLength(1);
  });

  it("passes ordinary warnings through", () => {
    const { seen, filtered } = setup();
    const warning = new Error("careful");
    filtered(warning);
    expect(seen).toEqual([[warning]]);
  });
});

describe("the bin shim", () => {
  const shim = join(cliDir, "bin", "agent-cost-analyzer.js");

  it("uses no syntax newer than ES2017", () => {
    for (const file of [shim, join(cliDir, "bin", "node-gate.js")]) {
      const text = readFileSync(file, "utf-8");
      expect(text, file).not.toMatch(/\?\.|\?\?|\bawait\b/);
    }
  });

  // A copy of bin/ beside no dist/, so this runs after `npm run build` too.
  it("says clearly that the package is not built when dist/cli.js is missing", () => {
    const unbuilt = mkdtempSync(join(tmpdir(), "cli-unbuilt-"));
    try {
      cpSync(join(cliDir, "bin"), join(unbuilt, "bin"), { recursive: true });
      writeFileSync(join(unbuilt, "package.json"), JSON.stringify({ type: "module" }));
      const result = spawnSync(process.execPath, [join(unbuilt, "bin", "agent-cost-analyzer.js")], { encoding: "utf-8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe("agent-cost-analyzer: dist/cli.js is missing; this package is not built.\n");
    } finally {
      rmSync(unbuilt, { recursive: true, force: true });
    }
  });
});
