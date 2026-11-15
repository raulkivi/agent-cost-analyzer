// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What the tarball may hold and how big it may be (npm-package.md §4.2),
// checked on one entry of `npm pack --dry-run --json`.

export interface PackReport {
  size: number;
  unpackedSize: number;
  files: { path: string }[];
}

export const PACK_BUDGET = { packedBytes: 4_000_000, unpackedBytes: 12_000_000 } as const;

const REQUIRED = [
  "package.json",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
  "bin/agent-cost-analyzer.js",
  "bin/node-gate.js",
  "dist/cli.js",
  "dist/mcp-apps/views.html",
  "dist/web/index.html",
];

// npm adds package.json, README.md and LICENSE to the `files` allow-list.
const TOP_LEVEL = new Set(["package.json", "README.md", "LICENSE", "THIRD-PARTY-NOTICES.md"]);

const SHIPPED = [
  /^bin\/[^/]+\.js$/,
  // The entry and its chunks, beside each other.
  /^dist\/[^/]+\.js$/,
  /^dist\/web\/.+$/,
  /^dist\/mcp-apps\/views\.html$/,
  /^dist\/data\/(learn-scripts|vendor-profiles|price-book)\/.+\.json$/,
];

// Never shipped, even where the patterns above would allow them.
const REFUSED = [/\.map$/, /\.node$/, /(^|\/)binding\.gyp$/, /\.test\./];

const isShipped = (file: string): boolean =>
  (TOP_LEVEL.has(file) || SHIPPED.some((pattern) => pattern.test(file))) && !REFUSED.some((pattern) => pattern.test(file));

export function packProblems(report: PackReport): string[] {
  const paths = report.files.map((file) => file.path);
  const present = new Set(paths);
  return [
    ...REQUIRED.filter((file) => !present.has(file)).map((file) => `missing ${file}`),
    ...paths.filter((file) => !isShipped(file)).map((file) => `unexpected ${file}`),
    ...(report.size > PACK_BUDGET.packedBytes ? [`packed size ${report.size} bytes is over the ${PACK_BUDGET.packedBytes}-byte budget`] : []),
    ...(report.unpackedSize > PACK_BUDGET.unpackedBytes
      ? [`unpacked size ${report.unpackedSize} bytes is over the ${PACK_BUDGET.unpackedBytes}-byte budget`]
      : []),
  ];
}
