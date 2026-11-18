// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The command line of scripts/mcp-setup-smoke.mts (MC7).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSetupSmokeArgs } from "../smoke/setup-options.mts";

describe("parseSetupSmokeArgs", () => {
  it("defaults to building and packing, with logs in smoke/out/mcp-setup", () => {
    expect(parseSetupSmokeArgs([], "/repo")).toEqual({
      kind: "run",
      tarball: undefined,
      outDir: path.resolve("/repo", "packages/cli/smoke/out/mcp-setup"),
      keepTemp: false,
    });
  });

  it("takes a packed tarball, an output folder and --keep-temp", () => {
    expect(parseSetupSmokeArgs(["--tarball", "p/a.tgz", "--out", "o", "--keep-temp"], "/repo")).toEqual({
      kind: "run",
      tarball: path.resolve("/repo", "p/a.tgz"),
      outDir: path.resolve("/repo", "o"),
      keepTemp: true,
    });
  });

  it("prints help, and rejects unknown flags and a tarball that is not .tgz", () => {
    expect(parseSetupSmokeArgs(["--help"], "/repo")).toMatchObject({ kind: "help", text: expect.stringContaining("smoke:mcp-setup") });
    expect(parseSetupSmokeArgs(["--alias-tarball", "x.tgz"], "/repo")).toMatchObject({ kind: "error" });
    expect(parseSetupSmokeArgs(["--tarball", "x.zip"], "/repo")).toEqual({ kind: "error", message: "--tarball must name a .tgz file: x.zip" });
  });
});
