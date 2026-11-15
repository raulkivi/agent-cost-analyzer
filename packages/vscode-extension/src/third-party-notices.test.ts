// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The .vsix ships THIRD-PARTY-NOTICES.md: every npm package the extension's
// bundles, webview and MCP App views carry, with its license text. Checked
// when the extension has been built (`npm run build`).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bundledPackageDirs, isAllowedLicense, readBundledPackage, readBundledPackagesList } from "../../../scripts/third-party-notices.mts";
import { extensionNoticesPlan } from "../scripts/notices-plan.mts";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plan = extensionNoticesPlan(packageDir);
const built = existsSync(plan.hostMetafilePath);

describe.skipIf(!built)("the extension's third-party notices", () => {
  const readMetafile = (file: string) => JSON.parse(readFileSync(file, "utf8")) as { inputs: Record<string, unknown> };
  const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")) as { name: string; version: string };

  const parts = () => [
    { part: "host", dirs: bundledPackageDirs(readMetafile(plan.hostMetafilePath), packageDir) },
    { part: "mcp", dirs: bundledPackageDirs(readMetafile(plan.mcpMetafilePath), packageDir) },
    { part: "webview", dirs: readBundledPackagesList(plan.webviewPackagesPath, "webview") },
    { part: "views", dirs: readBundledPackagesList(plan.viewsPackagesPath, "views") },
  ];

  it("names every npm package of each bundle, each under an allowed license, with the parts that bundle it", () => {
    const notices = readFileSync(plan.noticesPath, "utf8");
    for (const { part, dirs } of parts()) {
      expect(dirs.length, part).toBeGreaterThan(0);
      for (const bundled of dirs.map(readBundledPackage)) {
        const row = notices.split("\n").find((line) => line.startsWith(`| \`${bundled.name}\` | ${bundled.version} | `));
        expect(row, `${part}: ${bundled.name}@${bundled.version}`).toBeDefined();
        expect(row, `${part}: ${bundled.name}`).toContain(`| ${bundled.license} |`);
        expect(row?.split("|")[4], `${bundled.name} lists ${part}`).toContain(part);
        expect(isAllowedLicense(bundled.license), `${bundled.name}: ${bundled.license}`).toBe(true);
        expect(bundled.licenseTexts.length, `${bundled.name} has a license file`).toBeGreaterThan(0);
      }
    }
  });

  it("names the extension and version, and bundles no fonts", () => {
    const notices = readFileSync(plan.noticesPath, "utf8");
    expect(notices).toContain(`${manifest.name} ${manifest.version}`);
    expect(notices).not.toContain("## Fonts");
  });

  // `vsce ls` applies .vscodeignore to the real folder, so this is what
  // `npm run package` puts in the .vsix.
  it("is part of the .vsix and lists a host, a webview and a views package", () => {
    const vsce = path.join(path.dirname(createRequire(import.meta.url).resolve("@vscode/vsce/package.json")), "vsce");
    const listed = execFileSync(process.execPath, [vsce, "ls", "--no-dependencies"], { cwd: packageDir, encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim());
    expect(listed).toContain("THIRD-PARTY-NOTICES.md");

    const notices = readFileSync(plan.noticesPath, "utf8");
    for (const name of ["jsonc-parser", "react", "zod"]) expect(notices, name).toMatch(new RegExp(`^\\| \`${name}\` \\| `, "m"));
  }, 60_000);
});
