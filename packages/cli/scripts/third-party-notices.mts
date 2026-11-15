// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm package's THIRD-PARTY-NOTICES.md (npm-package.md §4.9): each npm
// package esbuild bundled, found through the metafile, with its license
// files, plus the fonts section of the repository's own notices.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const LICENSE_ALLOW_LIST = ["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"] as const;

const allowed: ReadonlySet<string> = new Set(LICENSE_ALLOW_LIST);

// An SPDX expression: OR needs one allowed choice, AND needs all (AND binds
// tighter). Anything else, WITH exceptions included, is refused.
export function isAllowedLicense(expression: string | undefined): boolean {
  const tokens = (expression ?? "").replace(/[()]/g, " $& ").split(/\s+/).filter(Boolean);
  let at = 0;
  const atom = (): boolean => {
    const token = tokens[at++];
    if (token !== "(") return token !== undefined && allowed.has(token);
    const value = or();
    if (tokens[at++] !== ")") throw new SyntaxError("unbalanced");
    return value;
  };
  const and = (): boolean => {
    let value = atom();
    while (tokens[at] === "AND") {
      at++;
      value = atom() && value;
    }
    return value;
  };
  const or = (): boolean => {
    let value = and();
    while (tokens[at] === "OR") {
      at++;
      value = and() || value;
    }
    return value;
  };
  try {
    const value = or();
    return at === tokens.length && value;
  } catch {
    return false;
  }
}

export interface MetafileInputs {
  inputs: Record<string, unknown>;
}

// The folder of each npm package the bundle read a file from. Paths outside
// node_modules are this repository's own code; `(disabled):` inputs are
// files a browser field replaced with nothing.
export function bundledPackageDirs(metafile: MetafileInputs, workingDir: string): string[] {
  const dirs = new Set<string>();
  for (const input of Object.keys(metafile.inputs)) {
    if (/^\([a-z]+\):/.test(input)) continue;
    const parts = path.resolve(workingDir, input).split(path.sep);
    const at = parts.lastIndexOf("node_modules");
    if (at < 0 || at + 1 >= parts.length - 1) continue;
    const nameParts = parts[at + 1].startsWith("@") ? 2 : 1;
    dirs.add(parts.slice(0, at + 1 + nameParts).join(path.sep));
  }
  return [...dirs].sort();
}

export interface LicenseText {
  file: string;
  text: string;
}

export interface BundledPackage {
  name: string;
  version: string;
  license: string | undefined;
  licenseTexts: LicenseText[];
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;

export function readBundledPackage(dir: string): BundledPackage {
  const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
    name: string;
    version: string;
    license?: string | { type?: string };
  };
  const license = typeof manifest.license === "object" ? manifest.license.type : manifest.license;
  const licenseTexts = readdirSync(dir)
    .filter((file) => LICENSE_FILE.test(file) && statSync(path.join(dir, file)).isFile())
    .sort()
    .map((file) => ({ file, text: readFileSync(path.join(dir, file), "utf8") }));
  return { name: manifest.name, version: manifest.version, license, licenseTexts };
}

// The root THIRD-PARTY-NOTICES.md below its header line, headings one level
// down to sit under "## Fonts".
export function fontsSectionOf(rootNotices: string): string {
  const lines = rootNotices.split("\n");
  const header = lines.findIndex((line) => line.startsWith("**Last changed:**"));
  if (header < 0) throw new Error("the root THIRD-PARTY-NOTICES.md has no **Last changed:** header line");
  return lines
    .slice(header + 1)
    .join("\n")
    .trim()
    .replace(/^(#{1,5}) /gm, "#$1 ");
}

export interface NoticesInput {
  packageName: string;
  packageVersion: string;
  packages: BundledPackage[];
  fontsSection: string;
}

const byNameAndVersion = (a: BundledPackage, b: BundledPackage): number =>
  a.name === b.name ? a.version.localeCompare(b.version) : a.name < b.name ? -1 : 1;

// No date, so the same bundle always gives the same file.
export function renderNotices({ packageName, packageVersion, packages, fontsSection }: NoticesInput): string {
  const sorted = [...packages].sort(byNameAndVersion);
  const rows = sorted.map((p) => `| \`${p.name}\` | ${p.version} | ${p.license ?? "(none)"} |`);
  const texts = sorted.map((p) =>
    [`### ${p.name} ${p.version}`, ...p.licenseTexts.map((t) => `\`${t.file}\`:\n\n\`\`\`\`text\n${t.text.trimEnd()}\n\`\`\`\``)].join("\n\n"),
  );
  return [
    "# Third-party notices",
    `**Generated for:** ${packageName} ${packageVersion} · **Source:** https://github.com/raulkivi/agent-cost-analyzer`,
    "This package's own code is MIT-licensed (`LICENSE`). Its `dist/` bundles the npm packages below " +
      "(`packages/cli/scripts/build.mts` lists them from the bundle's esbuild metafile) and the web app's fonts.",
    "## Bundled npm packages",
    ["| Package | Version | License |", "|---|---|---|", ...rows].join("\n"),
    "## Fonts",
    fontsSection.trimEnd(),
    "## License texts",
    ...texts,
  ].join("\n\n") + "\n";
}

export interface GenerateNoticesInput {
  metafile: MetafileInputs;
  // The metafile's paths are relative to esbuild's absWorkingDir.
  workingDir: string;
  rootNotices: string;
  packageName: string;
  packageVersion: string;
}

// Fails the build on a license off the allow-list or a package without a
// license file, rather than shipping notices that miss one.
export function generateNotices({ metafile, workingDir, rootNotices, packageName, packageVersion }: GenerateNoticesInput): string {
  const unique = new Map<string, BundledPackage>();
  for (const dir of bundledPackageDirs(metafile, workingDir)) {
    const bundled = readBundledPackage(dir);
    unique.set(`${bundled.name}@${bundled.version}`, bundled);
  }
  const problems = [...unique].flatMap(([id, bundled]) => [
    ...(isAllowedLicense(bundled.license) ? [] : [`${id}: license ${bundled.license ?? "(none)"} is not allowed`]),
    ...(bundled.licenseTexts.length > 0 ? [] : [`${id}: no license file in its package folder`]),
  ]);
  if (problems.length > 0) throw new Error(`THIRD-PARTY-NOTICES.md can't be generated:\n${problems.join("\n")}`);
  return renderNotices({ packageName, packageVersion, packages: [...unique.values()], fontsSection: fontsSectionOf(rootNotices) });
}
