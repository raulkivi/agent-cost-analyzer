import path from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { build, type BuildOptions } from "esbuild";
import { extensionBundleOptions, mcpServerBundleOptions } from "../scripts/esbuild-options.mts";

// What the extension must never ship (vscode-extension.md §3.1): another
// agent's provider or paths, or the standalone app's HTTP server.
const FORBIDDEN_INPUTS = [
  /data-sources\/(claude-code|pi-agent|log-providers\/mitmproxy)\//,
  /platform\/(claude-code|pi-agent)-paths\//,
  /(^|\/)express(\/|$)/,
];

const outDir = path.join(tmpdir(), "ai-credits-analyzer-boundary");

// Both bundles the extension ships: the extension host's, and the MCP
// child process's (step 10.8, D7).
const BUNDLES: [name: string, options: BuildOptions][] = [
  ["dist/extension.js", extensionBundleOptions(outDir)],
  ["dist/mcp-stdio.js", mcpServerBundleOptions(outDir)],
];

// Builds each bundle in memory with the build's own options and reads
// esbuild's metafile, so `npm test` alone is enough and the result doesn't
// depend on whether, or when, the build last ran.
describe.each(BUNDLES)("extension bundle boundary: %s (vscode-extension.md §3.1)", (_name, options) => {
  let inputs: string[];

  beforeAll(async () => {
    const result = await build({ ...options, write: false, logLevel: "silent" });
    inputs = Object.keys(result.metafile!.inputs);
  }, 60_000);

  it("bundles the VS Code / Copilot Chat provider", () => {
    expect(inputs.some((input) => input.includes("data-sources/log-providers/vscode/"))).toBe(true);
  });

  it("contains no Claude Code, pi or mitmproxy code, and no Express", () => {
    const leaks = inputs.filter((input) => FORBIDDEN_INPUTS.some((pattern) => pattern.test(input)));

    expect(leaks).toEqual([]);
  });
});

describe("MCP child process bundle (dist/mcp-stdio.js)", () => {
  let inputs: string[];

  beforeAll(async () => {
    const result = await build({ ...mcpServerBundleOptions(outDir), write: false, logLevel: "silent" });
    inputs = Object.keys(result.metafile.inputs);
  }, 60_000);

  it("bundles the shared MCP server, and none of the extension host's code (it runs without the vscode API)", () => {
    expect(inputs.some((input) => input.endsWith("server/src/mcp/mcp-server.ts"))).toBe(true);
    expect(inputs.filter((input) => /vscode-extension\/src\/(vscode|panel|sidebar|rpc)\/|extension\.ts$/.test(input))).toEqual([]);
  });
});
