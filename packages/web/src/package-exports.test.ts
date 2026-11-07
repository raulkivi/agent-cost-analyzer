// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
  private?: boolean;
  exports?: Record<string, string>;
};
const exportsMap = pkg.exports ?? {};

const REQUIRED = [
  "./theme.css",
  "./ui/Blueprint",
  "./ui/StatTile",
  "./ui/StatusTag",
  "./ui/Tag",
  "./ui/SegmentedControl",
  "./charts/TrendColumns",
  "./charts/HorizontalBars",
  "./charts/StackedColumns",
  "./charts/AiCreditsSparkline",
  "./insights/FindingsTable",
  "./lib/format-ai-credits",
];

const FORBIDDEN = /api-client|\/host\/|\bfetch\s*\(/;

/** Follows relative imports of a module and returns every file reached. */
function closure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:from|import)\s+["'](\.[^"']+)["']/g)) {
      const base = resolve(dirname(file), match[1]!.replace(/\.js$/, ""));
      const found = [".ts", ".tsx"].map((ext) => base + ext).find((p) => existsSync(p));
      if (found) queue.push(found);
    }
  }
  return [...seen];
}

describe("@agent-cost-analyzer/web package exports", () => {
  it("stays private and lists every required subpath", () => {
    expect(pkg.private).toBe(true);
    for (const key of REQUIRED) expect(Object.keys(exportsMap)).toContain(key);
  });

  it("points every subpath at an existing source file", () => {
    for (const [key, target] of Object.entries(exportsMap)) {
      expect(existsSync(resolve(packageRoot, target)), `${key} -> ${target}`).toBe(true);
    }
  });

  it("exports no module that reaches api-client, the host bridge or fetch", () => {
    for (const [key, target] of Object.entries(exportsMap)) {
      if (!/\.tsx?$/.test(target)) continue;
      for (const file of closure(resolve(packageRoot, target))) {
        expect(readFileSync(file, "utf8"), `${key} reaches ${file}`).not.toMatch(FORBIDDEN);
      }
    }
  });
});
