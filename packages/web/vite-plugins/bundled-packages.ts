// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

// The folder of the npm package a module id belongs to, or undefined for
// this repository's own code, virtual modules (a "\0" id) and files that
// sit in node_modules outside a package.
export function packageDirOfModuleId(id: string): string | undefined {
  if (id.includes("\0")) return undefined;
  const parts = id.split("?")[0].replaceAll("\\", "/").split("/");
  const at = parts.lastIndexOf("node_modules");
  if (at < 0) return undefined;
  const nameParts = parts[at + 1]?.startsWith("@") ? 2 : 1;
  if (at + 1 + nameParts >= parts.length) return undefined;
  return parts.slice(0, at + 1 + nameParts).join("/");
}

// Sorted package folders for a set of module ids. A workspace package is a
// symlink in node_modules to this repository's own code: `realDir` resolves
// it, and a result outside node_modules is not an npm package.
export function bundledPackageDirsOf(ids: Iterable<string>, realDir: (dir: string) => string = realpathSync): string[] {
  const dirs = new Set<string>();
  for (const id of ids) {
    const dir = packageDirOfModuleId(id);
    if (dir !== undefined && realDir(dir).split(path.sep).join("/").includes("/node_modules/")) dirs.add(dir);
  }
  return [...dirs].sort();
}

export interface BundledPackageRecord {
  name: string;
  version: string;
  // Absolute folder, for the notices generator to read the license files from.
  dir: string;
}

// Writes the npm packages whose code ends up in the build to `outFile`, a
// path outside the shipped output (packages/cli's notices generator reads
// it, https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/npm-package.md §4.9). A module counts when it renders code into a
// chunk, or is a stylesheet a chunk imported (Vite lifts the CSS out into an
// asset). Tree-shaken modules don't count.
export function bundledPackagesPlugin(outFile: string): Plugin {
  return {
    name: "bundled-packages",
    apply: "build",
    generateBundle(_options, bundle) {
      const ids = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const [id, rendered] of Object.entries(output.modules)) {
          if (rendered.renderedLength > 0 || /\.css$/.test(id.split("?")[0])) ids.add(id);
        }
      }
      const packages: BundledPackageRecord[] = bundledPackageDirsOf(ids).map((dir) => {
        const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { name: string; version: string };
        return { name: manifest.name, version: manifest.version, dir };
      });
      mkdirSync(path.dirname(outFile), { recursive: true });
      writeFileSync(outFile, `${JSON.stringify({ packages }, null, 2)}\n`);
    },
  };
}
