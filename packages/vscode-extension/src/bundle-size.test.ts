import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { build, type BuildOptions } from "esbuild";
import { extensionBundleOptions, extensionPackageDir, mcpServerBundleOptions } from "../scripts/esbuild-options.mts";

const MB = 1024 * 1024;

// The Marketplace has no hard limit, but the .vsix is downloaded by every
// user and installed into every remote host, so it stays small
// (vscode-extension.md step 10.9). Per-bundle budgets are raw (minified)
// sizes with headroom over today's: a new dependency that doubles one
// fails here instead of surprising the .vsix.
const BUNDLE_BUDGETS: [name: string, options: BuildOptions, maxBytes: number][] = [
  ["dist/extension.js", extensionBundleOptions(), 4 * MB],
  ["dist/mcp-stdio.js", mcpServerBundleOptions(), 4.25 * MB],
];
const VSIX_BUDGET_BYTES = 5 * MB;

async function bundle(options: BuildOptions): Promise<Uint8Array> {
  const result = await build({ ...options, write: false, logLevel: "silent" });
  return result.outputFiles!.find((file) => file.path.endsWith(".js"))!.contents;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("bundle size budgets (step 10.9)", () => {
  it.each(BUNDLE_BUDGETS)("%s stays within its budget and ships no sourcemap", async (name, options, maxBytes) => {
    const result = await build({ ...options, write: false, logLevel: "silent" });

    expect(result.outputFiles!.map((file) => path.extname(file.path)), name).toEqual([".js"]);
    expect(result.outputFiles![0]!.contents.byteLength, name).toBeLessThan(maxBytes);
  }, 60_000);

  // A .vsix is a zip of deflated files, so deflating each file estimates it
  // without needing vsce or the network. media/ is counted when the web
  // build has filled it; `npm run package` checks the real file as well.
  it("estimates a packaged size under the .vsix budget", async () => {
    let estimate = 0;
    for (const [, options] of BUNDLE_BUDGETS) estimate += deflateRawSync(await bundle(options)).byteLength;
    const mediaDir = path.join(extensionPackageDir, "media");
    if (existsSync(mediaDir)) {
      for (const file of filesUnder(mediaDir)) if (statSync(file).isFile()) estimate += deflateRawSync(readFileSync(file)).byteLength;
    }

    expect(estimate).toBeLessThan(VSIX_BUDGET_BYTES);
  }, 60_000);
});
