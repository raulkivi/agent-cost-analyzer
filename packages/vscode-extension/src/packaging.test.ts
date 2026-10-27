import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf-8")) as Record<string, unknown>;
const nls = JSON.parse(readFileSync(path.join(packageDir, "package.nls.json"), "utf-8")) as Record<string, string>;

// Listing prerequisites that vsce or the Marketplace check before the first
// publish (vscode-extension.md §7.0). The icon is owed by the owner, so
// it isn't asserted until a real one exists.
describe("Marketplace listing prerequisites (step 10.9, §7.0)", () => {
  it("is published by raulkivi under the id ai-credits-analyzer", () => {
    expect(manifest.publisher).toBe("raulkivi");
    expect(manifest.name).toBe("ai-credits-analyzer");
  });

  it("links the repository, issues and homepage, and is MIT licensed", () => {
    expect(manifest.repository).toEqual({ type: "git", url: expect.stringMatching(/^git\+https:\/\/github\.com\/raulkivi\/.+\.git$/) });
    expect(manifest.bugs).toEqual({ url: expect.stringMatching(/^https:\/\/github\.com\/raulkivi\/.+\/issues$/) });
    expect(manifest.homepage).toMatch(/^https:\/\/github\.com\/raulkivi\//);
    expect(manifest.license).toBe("MIT");
  });

  it("names the extension without 'Copilot' (§3.4)", () => {
    const displayName = String(manifest.displayName).replace(/^%(.+)%$/, (_match, key: string) => nls[key] ?? "");

    expect(displayName).toBe("AI Credits Analyzer");
    expect(displayName).not.toMatch(/copilot/i);
  });
});

// `vsce ls` reads the manifest and .vscodeignore and walks the folder; it
// needs no network. The folder here is a stand-in with one file of every
// kind the real one can hold, so the result doesn't depend on whether
// `npm run build` ran, and it fails if anything else would ship.
describe(".vscodeignore (step 10.9)", () => {
  const SHIPPED = [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "dist/extension.js",
    "dist/mcp-stdio.js",
    "icon.png",
    "media/assets/index.js",
    "media/index.html",
    "media/learn-scenarios/cache-hit.json",
    "package.json",
    "package.nls.json",
    "resources/activity-bar.svg",
    "resources/walkthrough/mcp.md",
  ];
  const KEPT_OUT = [
    "dist/meta.json",
    "dist/meta-mcp-stdio.json",
    "dist/extension.js.map",
    "dist/mcp-stdio.js.map",
    "src/extension.ts",
    "src/extension.test.ts",
    "scripts/build.mts",
    "node_modules/zod/index.js",
    "tsconfig.json",
    "vitest.config.mts",
    "package-lock.json",
    "ai-credits-analyzer-0.1.0.vsix",
    ".gitignore",
    "icon.svg",
  ];
  let dir: string;
  let listed: string[];

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ai-credits-analyzer-vsce-"));
    cpSync(path.join(packageDir, "package.json"), path.join(dir, "package.json"));
    cpSync(path.join(packageDir, ".vscodeignore"), path.join(dir, ".vscodeignore"));
    for (const file of [...SHIPPED.filter((file) => file !== "package.json"), ...KEPT_OUT]) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), "x");
    }
    const vsce = path.join(path.dirname(createRequire(import.meta.url).resolve("@vscode/vsce/package.json")), "vsce");
    listed = execFileSync(process.execPath, [vsce, "ls", "--no-dependencies"], { cwd: dir, encoding: "utf-8" })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }, 60_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("ships the bundles, webview build, resources, manifest and listing files, and nothing else", () => {
    expect([...listed].sort()).toEqual([...SHIPPED].sort());
  });

  it("keeps sources, tests, build scripts, dependencies, metafiles and sourcemaps out", () => {
    for (const file of KEPT_OUT) expect(listed, file).not.toContain(file);
  });

  // vsce lets "!media/**" win over any exclusion, so the webview build must
  // not produce maps in the first place. Checked when it has been built.
  it.skipIf(!existsSync(path.join(packageDir, "media")))("finds no sourcemap in the built webview", () => {
    const files = readdirSync(path.join(packageDir, "media"), { recursive: true, encoding: "utf-8" });

    expect(files.filter((file) => file.endsWith(".map"))).toEqual([]);
  });
});
