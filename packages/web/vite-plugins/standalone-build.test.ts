// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Every file under a directory, as paths relative to it.
function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(path.join(dir, entry.name), path.join(prefix, entry.name))
      : [path.join(prefix, entry.name)],
  );
}

// Builds the standalone app (the default mode) into a temp dir: G12 and
// constraint 1 say it makes no network call, so Barlow ships with it
// instead of coming from Google Fonts.
describe("web build in standalone mode (vscode-extension.md G12)", () => {
  let outDir: string;
  let files: string[];

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), "web-standalone-build-"));
    await build({
      root: webDir,
      configFile: path.join(webDir, "vite.config.ts"),
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
    });
    files = listFiles(outDir);
  }, 60_000);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("references fonts.googleapis.com nowhere in its output", () => {
    for (const file of files.filter((name) => /\.(html|css|js)$/.test(name))) {
      expect(readFileSync(path.join(outDir, file), "utf-8")).not.toContain("fonts.googleapis.com");
    }
  });

  it("bundles Barlow and Barlow Condensed locally, in the weights theme.css uses", () => {
    const css = files
      .filter((name) => name.endsWith(".css"))
      .map((name) => readFileSync(path.join(outDir, name), "utf-8"))
      .join("\n");

    for (const [family, weight] of [
      ["Barlow", 400],
      ["Barlow", 500],
      ["Barlow", 700],
      ["Barlow Condensed", 400],
      ["Barlow Condensed", 600],
    ] as const) {
      expect(css).toMatch(new RegExp(`font-family:\\s*["']?${family}["']?;[^}]*font-weight:\\s*${weight}`));
    }
    expect(files.some((name) => /barlow-latin-400-normal.*\.woff2$/.test(name))).toBe(true);
    expect(files.some((name) => /barlow-condensed-latin-600-normal.*\.woff2$/.test(name))).toBe(true);
  });

  it("ships no Barlow weight that theme.css doesn't use", () => {
    expect(files.some((name) => /barlow-latin-(100|200|300|600|800|900)-/.test(name))).toBe(false);
    expect(files.some((name) => /barlow-condensed-latin-(100|200|300|500|700|800|900)-/.test(name))).toBe(false);
  });
});
