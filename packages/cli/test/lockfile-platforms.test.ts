// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// A lockfile written on Linux can omit the native packages of other
// platforms, and `npm ci` on macOS or Windows then installs none (the
// lightningcss binary was missing there, NP8). Every optional dependency of
// a locked package must have its own entry.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface LockPackage {
  optionalDependencies?: Record<string, string>;
}

const lockPath = new URL("../../../package-lock.json", import.meta.url);

/** Optional dependencies with no lockfile entry at or above the package that lists them. */
function missingOptional(packages: Readonly<Record<string, LockPackage>>): string[] {
  const missing: string[] = [];
  for (const [location, entry] of Object.entries(packages)) {
    for (const name of Object.keys(entry.optionalDependencies ?? {})) {
      let base = location;
      let found = false;
      for (;;) {
        if (`${base === "" ? "" : `${base}/`}node_modules/${name}` in packages) {
          found = true;
          break;
        }
        if (base === "") break;
        const cut = base.lastIndexOf("/node_modules/");
        base = cut < 0 ? "" : base.slice(0, cut);
      }
      if (!found) missing.push(`${name} (optional dependency of ${location || "the root"})`);
    }
  }
  return missing;
}

describe("missingOptional", () => {
  it("reports an optional dependency that has no entry", () => {
    const packages = {
      "node_modules/a": { optionalDependencies: { "a-darwin": "1.0.0", "a-linux": "1.0.0" } },
      "node_modules/a-linux": {},
    };
    expect(missingOptional(packages)).toEqual(["a-darwin (optional dependency of node_modules/a)"]);
  });

  it("finds an entry hoisted above a nested package", () => {
    const packages = {
      "node_modules/x/node_modules/a": { optionalDependencies: { "a-win": "1.0.0" } },
      "node_modules/a-win": {},
    };
    expect(missingOptional(packages)).toEqual([]);
  });
});

describe("package-lock.json", () => {
  it("has an entry for every optional platform package", () => {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { packages: Record<string, LockPackage> };
    expect(missingOptional(lock.packages)).toEqual([]);
  });
});
