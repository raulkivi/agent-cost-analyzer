import path from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { extensionBundleOptions } from "../scripts/esbuild-options.mts";

// What the extension must never ship (vscode-extension.md §3.1): another
// agent's provider or paths, or the standalone app's HTTP server.
const FORBIDDEN_INPUTS = [
  /data-sources\/(claude-code|pi-agent|log-providers\/mitmproxy)\//,
  /platform\/(claude-code|pi-agent)-paths\//,
  /(^|\/)express(\/|$)/,
];

// Builds dist/extension.js in memory with the build's own options and
// reads esbuild's metafile, so `npm test` alone is enough and the result
// doesn't depend on whether, or when, the build last ran.
describe("extension bundle boundary (vscode-extension.md §3.1)", () => {
  let inputs: string[];

  beforeAll(async () => {
    const result = await build({
      ...extensionBundleOptions(path.join(tmpdir(), "ai-credits-analyzer-boundary")),
      write: false,
      logLevel: "silent",
    });
    inputs = Object.keys(result.metafile.inputs);
  }, 60_000);

  it("bundles the VS Code / Copilot Chat provider", () => {
    expect(inputs.some((input) => input.includes("data-sources/log-providers/vscode/"))).toBe(true);
  });

  it("contains no Claude Code, pi or mitmproxy code, and no Express", () => {
    const leaks = inputs.filter((input) => FORBIDDEN_INPUTS.some((pattern) => pattern.test(input)));

    expect(leaks).toEqual([]);
  });
});
