// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

// Plan §7 A5: the single-file bundle stays within its size budget, uncompressed, and
// is self-contained (constraint 1: no network, no external resources).
// The owner raised this from 450 KB on 2026-11-07 because ext-apps pulls in all of zod via a dynamic import; no third-party patching.
const BUDGET_BYTES = 1.2 * 1024 * 1024;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("views.html bundle", () => {
  let outDir: string;
  let html: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(os.tmpdir(), "aca-views-"));
    // The real production build in its own process: vitest sets NODE_ENV=test,
    // which would bundle React's development build.
    const vite = path.join(path.dirname(fileURLToPath(import.meta.resolve("vite/package.json"))), "bin", "vite.js");
    execFileSync(process.execPath, [vite, "build", "--outDir", outDir, "--emptyOutDir"], {
      cwd: root,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "pipe",
    });
    html = readFileSync(path.join(outDir, "views.html"), "utf8");
  }, 180_000);

  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  it("is at most 1.2 MiB uncompressed", () => {
    const size = Buffer.byteLength(html);
    console.info(`views.html: ${(size / 1024).toFixed(1)} KB`);
    expect(size).toBeLessThanOrEqual(BUDGET_BYTES);
  });

  it("keeps exactly one empty brand placeholder for the server to fill", () => {
    expect(html.match(/<meta name="aca-brand" content="">/g)).toHaveLength(1);
  });

  it("loads and renders without error", async () => {
    const dom = new JSDOM(html.replace(/<script type="module"[^>]*>/, "<script>"), { runScripts: "dangerously", pretendToBeVisual: true });
    const errors: unknown[] = [];
    dom.window.addEventListener("error", (event) => errors.push(event.error ?? event.message));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(errors).toEqual([]);
    expect(dom.window.document.getElementById("root")).not.toBeNull();
    dom.window.close();
  });

  it("inlines everything: no external script, stylesheet or font", () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+(stylesheet|modulepreload|preload)/i);
    expect(html).not.toMatch(/@font-face/);
    expect(html).not.toMatch(/url\(\s*["']?https?:/i);
  });
});
