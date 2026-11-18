// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What the Claude Desktop bundle holds and says (mcp-client-setup.md §5.7, MC15).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectedMcpSurface } from "../smoke/checks.mts";
import { bundleListProblems, mcpbFileName, mcpbManifest, mcpbProblems, parseMcpbArgs, stagedPaths } from "../scripts/mcpb-plan.mts";

const cliDir = path.join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(cliDir, "package.json"), "utf8")) as { name: string; version: string; engines: { node: string } };
const snapshot: unknown = JSON.parse(
  readFileSync(path.join(cliDir, "..", "server", "src", "mcp", "__snapshots__", "tool-list-standalone.json"), "utf8"),
);
const toolEntries = (snapshot as { withViews: { tools: { name: string; title: string }[] } }).withViews.tools;

const tarball = [
  "package/package.json",
  "package/README.md",
  "package/LICENSE",
  "package/THIRD-PARTY-NOTICES.md",
  "package/bin/agent-cost-analyzer.js",
  "package/bin/node-gate.js",
  "package/dist/cli.js",
  "package/dist/web/index.html",
];

describe("stagedPaths", () => {
  it("is the tarball's file list without the package/ prefix, plus manifest.json, sorted", () => {
    expect(stagedPaths(tarball)).toEqual([
      "LICENSE",
      "README.md",
      "THIRD-PARTY-NOTICES.md",
      "bin/agent-cost-analyzer.js",
      "bin/node-gate.js",
      "dist/cli.js",
      "dist/web/index.html",
      "manifest.json",
      "package.json",
    ]);
  });

  it("refuses a tarball entry outside package/", () => {
    expect(() => stagedPaths(["evil/x.js"])).toThrow(/outside package\//);
  });

  it("refuses a path that climbs out of the bundle", () => {
    expect(() => stagedPaths(["package/../x.js"])).toThrow(/unsafe/);
  });
});

describe("mcpbManifest", () => {
  const manifest = mcpbManifest(pkg, toolEntries);

  it("carries the package's version and the bundle's identity", () => {
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.name).toBe("agent-cost-analyzer");
    expect(manifest.display_name).toBe("Agent Cost Analyzer");
    expect(manifest.manifest_version).toBe("0.3");
    expect(manifest.license).toBe("MIT");
    expect(manifest.author).toEqual({ name: "Raul Kivi" });
  });

  it("starts the gated bin with the mcp subcommand through node", () => {
    expect(manifest.server).toEqual({
      type: "node",
      entry_point: "bin/agent-cost-analyzer.js",
      mcp_config: { command: "node", args: ["${__dirname}/bin/agent-cost-analyzer.js", "mcp"] },
    });
  });

  it("asks for the package's Node engine range", () => {
    expect(manifest.compatibility).toEqual({ runtimes: { node: pkg.engines.node } });
  });

  it("lists exactly the server's tools", () => {
    expect(manifest.tools.map((tool) => tool.name).sort()).toEqual(expectedMcpSurface(snapshot).tools);
    expect(manifest.tools_generated).toBe(false);
  });

  it("points at this repository and needs no network", () => {
    expect(manifest.repository).toEqual({ type: "git", url: "https://github.com/raulkivi/agent-cost-analyzer" });
    expect(manifest.homepage).toBe("https://github.com/raulkivi/agent-cost-analyzer#readme");
    expect(JSON.stringify(manifest.server)).not.toMatch(/npx|https?:/);
  });

  it("has no user_config, so Desktop asks the user for nothing", () => {
    expect(manifest).not.toHaveProperty("user_config");
  });
});

describe("mcpbProblems", () => {
  const manifest = mcpbManifest(pkg, toolEntries);
  const staged = stagedPaths(tarball);

  it("passes the manifest built for the staged files", () => {
    expect(mcpbProblems(manifest, staged, pkg.version)).toEqual([]);
  });

  it("fails when the version differs from the package's", () => {
    expect(mcpbProblems({ ...manifest, version: "0.0.1" }, staged, pkg.version)).toContain(`version is "0.0.1", expected "${pkg.version}"`);
  });

  it("fails when the entry point is not in the staged files", () => {
    const without = staged.filter((file) => file !== "bin/agent-cost-analyzer.js");
    expect(mcpbProblems(manifest, without, pkg.version).join("\n")).toMatch(/entry_point bin\/agent-cost-analyzer\.js is not staged/);
  });

  it("fails when the launch args do not end with mcp or do not start at the entry", () => {
    const bad = { ...manifest, server: { ...manifest.server, mcp_config: { command: "node", args: ["${__dirname}/dist/cli.js"] } } };
    const text = mcpbProblems(bad, staged, pkg.version).join("\n");
    expect(text).toMatch(/must end with "mcp"/);
    expect(text).toMatch(/must start with \$\{__dirname\}\/bin\/agent-cost-analyzer\.js/);
  });

  it("fails when a required file is missing", () => {
    expect(
      mcpbProblems(
        manifest,
        staged.filter((file) => file !== "LICENSE"),
        pkg.version,
      ),
    ).toContain("LICENSE is not staged");
  });
});

describe("bundleListProblems", () => {
  const bundle = stagedPaths(tarball);

  it("passes when the bundle holds the tarball's files plus manifest.json", () => {
    expect(bundleListProblems(tarball, bundle)).toEqual([]);
  });

  it("names a file the bundle lacks and one it adds", () => {
    expect(bundleListProblems(tarball, [...bundle.filter((file) => file !== "dist/cli.js"), "extra.js"])).toEqual([
      "the bundle lacks dist/cli.js",
      "the bundle holds extra.js, which the tarball does not",
    ]);
  });
});

describe("mcpbFileName", () => {
  it("is agent-cost-analyzer-<version>.mcpb", () => {
    expect(mcpbFileName("1.2.3")).toBe("agent-cost-analyzer-1.2.3.mcpb");
  });
});

describe("parseMcpbArgs", () => {
  it("defaults to packing the current build into mcpb-release", () => {
    expect(parseMcpbArgs([], "/w")).toEqual({ kind: "run", tarball: undefined, outDir: path.resolve("/w", "mcpb-release") });
  });

  it("takes the release workflow's tarball and an output folder", () => {
    expect(parseMcpbArgs(["--tarball", "t.tgz", "--out", "o"], "/w")).toEqual({
      kind: "run",
      tarball: path.resolve("/w", "t.tgz"),
      outDir: path.resolve("/w", "o"),
    });
  });

  it("reports an unknown option", () => {
    expect(parseMcpbArgs(["--nope"], "/w").kind).toBe("error");
  });
});
