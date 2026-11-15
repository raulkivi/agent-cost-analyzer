// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bundledPackageDirsOf, packageDirOfModuleId } from "./bundled-packages.js";

describe("packageDirOfModuleId", () => {
  it("returns the package folder under node_modules, scoped packages included", () => {
    expect(packageDirOfModuleId("/repo/node_modules/react/index.js")).toBe("/repo/node_modules/react");
    expect(packageDirOfModuleId("/repo/node_modules/d3-scale/src/linear.js")).toBe("/repo/node_modules/d3-scale");
    expect(packageDirOfModuleId("/repo/node_modules/@modelcontextprotocol/ext-apps/dist/src/app.js")).toBe(
      "/repo/node_modules/@modelcontextprotocol/ext-apps",
    );
  });

  it("uses the innermost node_modules for a nested package", () => {
    expect(packageDirOfModuleId("/repo/node_modules/a/node_modules/@s/b/lib/x.js")).toBe("/repo/node_modules/a/node_modules/@s/b");
  });

  it("ignores a query string and a Windows separator", () => {
    expect(packageDirOfModuleId("/repo/node_modules/foo/style.css?inline")).toBe("/repo/node_modules/foo");
    expect(packageDirOfModuleId("C:\\repo\\node_modules\\foo\\index.js")).toBe("C:/repo/node_modules/foo");
  });

  it("returns undefined for this repository's code, virtual modules and a bare node_modules file", () => {
    expect(packageDirOfModuleId("/repo/packages/domain/src/index.ts")).toBeUndefined();
    expect(packageDirOfModuleId("/repo/packages/web/src/main.tsx")).toBeUndefined();
    expect(packageDirOfModuleId("\0vite/preload-helper.js")).toBeUndefined();
    expect(packageDirOfModuleId("\0/repo/node_modules/foo/index.js?commonjs-proxy")).toBeUndefined();
    expect(packageDirOfModuleId("/repo/node_modules/.package-lock.json")).toBeUndefined();
  });
});

describe("bundledPackageDirsOf", () => {
  it("lists each package folder once, sorted, skipping a workspace link to this repository's own code", () => {
    const ids = [
      "/repo/node_modules/b/index.js",
      "/repo/node_modules/a/one.js",
      "/repo/node_modules/a/two.js",
      "/repo/packages/web/src/x.ts",
      "/repo/node_modules/@agent/domain/src/index.ts",
    ];
    const real = (dir: string) => (dir.endsWith("@agent/domain") ? "/repo/packages/domain" : dir);
    expect(bundledPackageDirsOf(ids, real)).toEqual(["/repo/node_modules/a", "/repo/node_modules/b"]);
  });
});
