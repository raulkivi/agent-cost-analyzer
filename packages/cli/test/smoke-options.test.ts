// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm-package smoke's command line (scripts/npm-package-smoke.mts).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSmokeArgs } from "../smoke/options.mts";

const cwd = path.resolve("/work/repo");

describe("parseSmokeArgs", () => {
  it("builds and packs by default, with logs in packages/cli/smoke/out", () => {
    expect(parseSmokeArgs([], cwd)).toEqual({ kind: "run", tarball: undefined, outDir: path.join(cwd, "packages", "cli", "smoke", "out"), keepTemp: false });
  });

  it("takes an already packed tarball (the release workflow's), a log folder and --keep-temp", () => {
    expect(parseSmokeArgs(["--tarball", "pack/agent-cost-analyzer-1.0.0.tgz", "--out", "logs", "--keep-temp"], cwd)).toEqual({
      kind: "run",
      tarball: path.join(cwd, "pack", "agent-cost-analyzer-1.0.0.tgz"),
      outDir: path.join(cwd, "logs"),
      keepTemp: true,
    });
    expect(parseSmokeArgs(["--tarball=/abs/x.tgz"], cwd)).toMatchObject({ tarball: path.resolve("/abs/x.tgz") });
  });

  it("prints usage for --help", () => {
    expect(parseSmokeArgs(["--help"], cwd)).toEqual({ kind: "help", text: expect.stringContaining("--tarball <path>") });
  });

  it("refuses unknown options, positionals and a tarball that is not a .tgz", () => {
    expect(parseSmokeArgs(["--port", "1"], cwd)).toMatchObject({ kind: "error" });
    expect(parseSmokeArgs(["x.tgz"], cwd)).toMatchObject({ kind: "error" });
    expect(parseSmokeArgs(["--tarball", "x.zip"], cwd)).toEqual({ kind: "error", message: "--tarball must name a .tgz file: x.zip" });
  });
});
