// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm-package smoke's checks of the tarball itself (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.8
// step 2), read from the bytes users download: the file list and size
// budget (NP6's pack-check.mts), the manifest and the bin shim.
import { gunzipSync } from "node:zlib";
import { packProblems } from "../scripts/pack-check.mts";

export const PUBLISHED = {
  name: "agent-cost-analyzer",
  nodeEngine: ">=22.18",
  // npm provenance requires the manifest's url to match the repository exactly.
  repositoryUrl: "git+https://github.com/raulkivi/agent-cost-analyzer.git",
  bin: { "agent-cost-analyzer": "bin/agent-cost-analyzer.js" },
} as const;

export interface TarFile {
  path: string;
  content: Buffer;
}

const BLOCK = 512;

const field = (block: Buffer, start: number, length: number): string => {
  const raw = block.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString("utf8");
};

const octal = (block: Buffer, start: number, length: number): number => Number.parseInt(field(block, start, length).trim() || "0", 8);

// The `path` record of a pax extended header ("<length> path=<value>\n").
const paxPath = (body: Buffer): string | undefined => /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"))?.[1];

/** The regular files of a gzipped tar archive (ustar, with pax long paths), in order. */
export function readTarFiles(tgz: Uint8Array): TarFile[] {
  const tar = gunzipSync(tgz);
  const files: TarFile[] = [];
  let nextPath: string | undefined;
  for (let offset = 0; offset + BLOCK <= tar.length; ) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = octal(header, 124, 12);
    const start = offset + BLOCK;
    if (start + size > tar.length) throw new Error(`tar archive truncated at ${field(header, 0, 100)}`);
    const body = tar.subarray(start, start + size);
    const type = field(header, 156, 1);
    const prefix = field(header, 345, 155);
    const name = prefix === "" ? field(header, 0, 100) : `${prefix}/${field(header, 0, 100)}`;
    if (type === "x") {
      nextPath = paxPath(body);
    } else {
      if (type === "0" || type === "") files.push({ path: nextPath ?? name, content: Buffer.from(body) });
      nextPath = undefined;
    }
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

const isEmpty = (value: unknown): boolean =>
  value === undefined || (Array.isArray(value) ? value.length === 0 : typeof value === "object" && value !== null && Object.keys(value).length === 0);

function manifestProblems(manifest: Record<string, unknown>, version: string): string[] {
  const problems: string[] = [];
  const expect = (label: string, actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  };
  expect("name", manifest.name, PUBLISHED.name);
  expect("version", manifest.version, version);
  expect("engines.node", (manifest.engines as Record<string, unknown> | undefined)?.node, PUBLISHED.nodeEngine);
  const repository = manifest.repository;
  expect("repository.url", typeof repository === "object" && repository !== null ? (repository as Record<string, unknown>).url : undefined, PUBLISHED.repositoryUrl);
  if (manifest.scripts !== undefined) {
    const keys = typeof manifest.scripts === "object" && manifest.scripts !== null ? Object.keys(manifest.scripts) : [];
    problems.push(`has a scripts field (${keys.join(", ") || "empty"}); the published package must have none`);
  }
  if (manifest.gypfile !== undefined) problems.push("has gypfile; the published package must have no native build");
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"]) {
    if (!isEmpty(manifest[key])) problems.push(`${key} is not empty`);
  }
  expect("bin", manifest.bin, PUBLISHED.bin);
  return problems;
}

const SHEBANG = "#!/usr/bin/env node\n";

function binProblems(files: ReadonlyMap<string, Buffer>): string[] {
  const binPath = PUBLISHED.bin["agent-cost-analyzer"];
  const shim = files.get(binPath);
  if (shim === undefined) return [`${binPath} is not in the tarball`];
  const text = shim.toString("utf8");
  return [
    ...(text.startsWith(SHEBANG) ? [] : [`${binPath} does not start with #!/usr/bin/env node and LF`]),
    ...(text.includes("\r") ? [`${binPath} has CR line endings`] : []),
  ];
}

const NATIVE = [/\.node$/, /(^|\/)binding\.gyp$/];

/** Everything wrong with a packed `agent-cost-analyzer` tarball of `version`; empty when it may ship. */
export function tarballProblems(tgz: Buffer, version: string): string[] {
  const entries = readTarFiles(tgz);
  const outside = entries.filter((file) => !file.path.startsWith("package/")).map((file) => `entry outside package/: ${file.path}`);
  const files = new Map(entries.filter((file) => file.path.startsWith("package/")).map((file) => [file.path.slice("package/".length), file.content]));
  const report = {
    size: tgz.length,
    unpackedSize: [...files.values()].reduce((total, content) => total + content.length, 0),
    files: [...files.keys()].map((path) => ({ path })),
  };
  const native = [...files.keys()].filter((path) => NATIVE.some((pattern) => pattern.test(path))).map((path) => `native code: ${path}`);

  let manifest: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(files.get("package.json")?.toString("utf8") ?? "");
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) manifest = parsed as Record<string, unknown>;
  } catch {
    manifest = undefined;
  }
  return [
    ...packProblems(report),
    ...outside,
    ...native,
    ...(manifest === undefined ? ["package.json is missing or not JSON"] : manifestProblems(manifest, version)),
    ...binProblems(files),
  ];
}
