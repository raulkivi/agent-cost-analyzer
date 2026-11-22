// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The tarball's file list and size budget (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.2), checked on
// `npm pack --dry-run --json` output.
import { describe, expect, it } from "vitest";
import { PACK_BUDGET, packProblems, type PackReport } from "../scripts/pack-check.mts";

const REQUIRED = [
  "package.json",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
  "bin/agent-cost-analyzer.js",
  "bin/node-gate.js",
  "dist/cli.js",
  "dist/mcp-apps/views.html",
  "dist/web/index.html",
];

const report = (paths: string[], sizes: Partial<Pick<PackReport, "size" | "unpackedSize">> = {}): PackReport => ({
  size: 1_000_000,
  unpackedSize: 5_000_000,
  files: paths.map((path) => ({ path })),
  ...sizes,
});

const good = [
  ...REQUIRED,
  "README.md",
  "dist/chunk-ABC123.js",
  "dist/web/assets/index-1a2b.js",
  "dist/web/assets/commit-mono-latin-400-normal.woff2",
  "dist/data/learn-scripts/cache-basics.json",
  "dist/data/vendor-profiles/anthropic.json",
  "dist/data/price-book/price-book.json",
];

describe("packProblems", () => {
  it("passes a tarball of the expected files within budget", () => {
    expect(packProblems(report(good))).toEqual([]);
  });

  it("has the plan's budget: packed at most 4 MB, unpacked at most 12 MB", () => {
    expect(PACK_BUDGET).toEqual({ packedBytes: 4_000_000, unpackedBytes: 12_000_000 });
    expect(packProblems(report(good, { size: 4_000_000, unpackedSize: 12_000_000 }))).toEqual([]);
  });

  it("fails over budget, packed or unpacked", () => {
    expect(packProblems(report(good, { size: 4_000_001 }))).toEqual(["packed size 4000001 bytes is over the 4000000-byte budget"]);
    expect(packProblems(report(good, { unpackedSize: 12_000_001 }))).toEqual(["unpacked size 12000001 bytes is over the 12000000-byte budget"]);
  });

  it("fails when a file the package needs is missing", () => {
    for (const file of REQUIRED) {
      expect(packProblems(report(good.filter((path) => path !== file)))).toEqual([`missing ${file}`]);
    }
  });

  it("refuses anything outside bin/, dist/, the notices, package.json, README.md and LICENSE", () => {
    for (const path of ["src/cli.ts", "test/run.test.ts", "scripts/build.mts", "tsconfig.json", "vitest.config.ts", "build/meta.json"]) {
      expect(packProblems(report([...good, path]))).toEqual([`unexpected ${path}`]);
    }
  });

  it("refuses source maps, native addons, metafiles and test fixtures even inside dist/", () => {
    for (const path of [
      "dist/cli.js.map",
      "dist/web/assets/index.js.map",
      "dist/addon.node",
      "dist/binding.gyp",
      "dist/meta.json",
      "dist/data/vendor-profiles/copilot-price-table.snapshot.yml",
      "dist/data/jsonl/real-session.jsonl",
      "dist/data/claude-code/session.json",
      "bin/run.test.js",
    ]) {
      expect(packProblems(report([...good, path])), path).toEqual([`unexpected ${path}`]);
    }
  });
});
