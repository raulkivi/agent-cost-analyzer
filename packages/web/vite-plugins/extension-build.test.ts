// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface ManifestChunk {
  file: string;
  css?: string[];
  isEntry?: boolean;
}

// Builds the web app the way the extension's build does (vite build --mode
// extension), into a temp dir instead of the extension's media/ folder.
describe("web build in extension mode (vscode-extension.md G7, G12)", () => {
  let outDir: string;
  let manifest: Record<string, ManifestChunk>;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), "web-extension-build-"));
    await build({
      root: webDir,
      configFile: path.join(webDir, "vite.config.ts"),
      mode: "extension",
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
    });
    manifest = JSON.parse(readFileSync(path.join(outDir, "manifest.json"), "utf-8")) as Record<
      string,
      ManifestChunk
    >;
  }, 60_000);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("writes a manifest whose index.html entry has a script and a stylesheet", () => {
    const entry = manifest["index.html"];

    expect(entry?.isEntry).toBe(true);
    expect(entry?.file).toMatch(/^assets\/.+\.js$/);
    expect(entry?.css?.length).toBeGreaterThan(0);
  });

  it("emits no Google Fonts (or any remote) @import in the CSS", () => {
    for (const cssFile of manifest["index.html"]?.css ?? []) {
      const css = readFileSync(path.join(outDir, cssFile), "utf-8");
      expect(css).not.toContain("fonts.googleapis.com");
      expect(css).not.toMatch(/@import[^;]*https?:/);
    }
  });

  it("uses relative asset URLs (base './'), since webviews can't resolve /assets", () => {
    const html = readFileSync(path.join(outDir, "index.html"), "utf-8");

    expect(html).not.toMatch(/(src|href)="\/assets\//);
    expect(html).toMatch(/(src|href)="\.\/assets\//);
  });
});
