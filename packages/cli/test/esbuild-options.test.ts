// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm package's bundle options (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/npm-package.md §4.2): ESM with code
// splitting, a `require` for CommonJS dependencies, readable output.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { cliBundleOptions, cliMetafilePath, cliPackageDir } from "../scripts/esbuild-options.mts";

describe("cliBundleOptions", () => {
  const options = cliBundleOptions("/pkg");

  it("bundles src/cli.ts into dist/cli.js as an ES module for Node 22.18", () => {
    expect(options.absWorkingDir).toBe("/pkg");
    expect(options.entryPoints).toEqual([path.join("/pkg", "src", "cli.ts")]);
    expect(options.outdir).toBe(path.join("/pkg", "dist"));
    expect(options.entryNames).toBe("[name]");
    expect(options).toMatchObject({ bundle: true, format: "esm", platform: "node", target: "node22.18" });
  });

  it("splits shared code into chunk-*.js files beside the entry, so every file finds the package root one level up", () => {
    expect(options.splitting).toBe(true);
    expect(options.chunkNames).toBe("chunk-[hash]");
  });

  it("ships readable code: no minification, legal comments kept, no source maps", () => {
    expect(options.minify).toBe(false);
    expect(options.legalComments).toBe("inline");
    expect(options.sourcemap).toBe(false);
  });

  it("defines require through createRequire(import.meta.url) and states the license at the top of every file", () => {
    const banner = options.banner.js;
    expect(banner.startsWith("// SPDX-FileCopyrightText: 2026 Raul Kivi\n// SPDX-License-Identifier: MIT\n")).toBe(true);
    expect(banner).toContain('from "node:module"');
    expect(banner).toMatch(/const require = \w+\(import\.meta\.url\);/);
  });

  it("leaves node: builtins to the user's Node, so node:sqlite is never bundled", () => {
    expect(options.external).toEqual(["node:*"]);
  });

  it("prefers each dependency's ESM build (jsonc-parser's UMD main loads its parts with a require esbuild can't follow)", () => {
    expect(options.mainFields).toEqual(["module", "main"]);
  });

  it("returns the metafile for the notices and writes it outside dist/, which ships", () => {
    expect(options.metafile).toBe(true);
    expect(cliMetafilePath("/pkg")).toBe(path.join("/pkg", "build", "meta.json"));
  });

  it("defaults to this package's own folder", () => {
    expect(cliBundleOptions().absWorkingDir).toBe(cliPackageDir);
    expect(path.relative(path.join(cliPackageDir, "..", ".."), cliPackageDir)).toBe(path.join("packages", "cli"));
  });
});

describe("a bundle built with these options", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  // A CommonJS dependency that requires a builtin, as express does, and a
  // lazily loaded module that becomes a chunk.
  function writeFakePackage(): string {
    const root = mkdtempSync(path.join(tmpdir(), "cli-bundle-options-"));
    mkdirSync(path.join(root, "src"));
    mkdirSync(path.join(root, "node_modules", "fake-cjs"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", "fake-cjs", "package.json"), JSON.stringify({ name: "fake-cjs", main: "index.js" }));
    writeFileSync(path.join(root, "node_modules", "fake-cjs", "index.js"), 'module.exports = require("node:path").basename("/a/b.txt");\n');
    writeFileSync(path.join(root, "src", "lazy.ts"), 'export const lazy = "lazy";\n');
    writeFileSync(
      path.join(root, "src", "cli.ts"),
      'import name from "fake-cjs";\nconst { lazy } = await import("./lazy.js");\nprocess.stdout.write(`${name} ${lazy}\\n`);\n',
    );
    return root;
  }

  it("runs a CommonJS dependency's require() and loads its chunk", async () => {
    dir = writeFakePackage();
    await build({ ...cliBundleOptions(dir), logLevel: "silent" });
    const [entry, ...chunks] = readdirSync(path.join(dir, "dist")).sort((a, b) => (a === "cli.js" ? -1 : b === "cli.js" ? 1 : 0));
    expect(entry).toBe("cli.js");
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) expect(chunk).toMatch(/^chunk-[A-Z0-9]+\.js$/);
    expect(execFileSync(process.execPath, [path.join(dir, "dist", "cli.js")], { encoding: "utf8" })).toBe("b.txt lazy\n");
  });
});
