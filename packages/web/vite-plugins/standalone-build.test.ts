// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
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
// constraint 1 say it makes no network call, so its fonts ship with it
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

  // Phase 17 D3: the ledger theme's fonts, Commit Mono for the UI and
  // Source Serif 4 for prose, each in the weights it uses and the Latin
  // subset only. Barlow is gone from the standalone build.
  it("bundles Commit Mono and Source Serif 4 locally, in the weights the ledger theme uses", () => {
    const css = files
      .filter((name) => name.endsWith(".css"))
      .map((name) => readFileSync(path.join(outDir, name), "utf-8"))
      .join("\n");

    for (const [family, weight] of [
      ["Commit Mono", 400],
      ["Commit Mono", 700],
      ["Source Serif 4", 400],
      ["Source Serif 4", 600],
    ] as const) {
      expect(css).toMatch(new RegExp(`font-family:\\s*["']?${family}["']?;[^}]*font-weight:\\s*${weight}`));
    }
    for (const file of [
      "commit-mono-latin-400-normal",
      "commit-mono-latin-700-normal",
      "source-serif-4-latin-400-normal",
      "source-serif-4-latin-600-normal",
    ]) {
      expect(files.some((name) => name.includes(file) && name.endsWith(".woff2")), file).toBe(true);
    }
  });

  it("ships no font weight, style or subset the ledger theme doesn't use, and no Barlow", () => {
    const fonts = files.filter((name) => /\.woff2?$/.test(name));

    expect(fonts.filter((name) => /barlow/i.test(name))).toEqual([]);
    expect(fonts.filter((name) => /commit-mono-latin-(200|300|500|600)-|commit-mono-.*-italic/.test(name))).toEqual([]);
    expect(fonts.filter((name) => /source-serif-4-latin-(200|300|500|700|800|900)-|source-serif-4-.*-italic/.test(name))).toEqual([]);
    expect(fonts.filter((name) => /source-serif-4-(cyrillic|greek|latin-ext|vietnamese)/.test(name))).toEqual([]);
  });
});
