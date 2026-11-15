// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm-package smoke's tarball checks (npm-package.md §4.8 step 2), on
// tarballs built here byte by byte.
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PUBLISHED, readTarFiles, tarballProblems } from "../smoke/tarball.mts";

function header(name: string, size: number, type: string, prefix = ""): Buffer {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, "utf8");
  block.write("0000644\0", 100);
  block.write("0000000\0", 108);
  block.write("0000000\0", 116);
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  block.write("00000000000\0", 136);
  block.write("        ", 148);
  block.write(type, 156);
  block.write("ustar\0", 257);
  block.write("00", 263);
  block.write(prefix, 345, 155, "utf8");
  const sum = block.reduce((total, byte) => total + byte, 0);
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return block;
}

const padded = (body: Buffer): Buffer => Buffer.concat([body, Buffer.alloc((512 - (body.length % 512)) % 512)]);

interface Entry {
  name: string;
  content?: string | Buffer;
  type?: string;
  prefix?: string;
}

function entry({ name, content = "", type = "0", prefix }: Entry): Buffer {
  const body = Buffer.from(content);
  return Buffer.concat([header(name, body.length, type, prefix), padded(body)]);
}

// A pax extended header naming the next entry's path.
function paxPath(path: string): Buffer {
  const record = (length: number) => `${length} path=${path}\n`;
  let length = record(0).length;
  while (record(length).length !== length) length = record(length).length;
  return entry({ name: "PaxHeader/long", content: record(length), type: "x" });
}

const tgz = (...entries: Buffer[]): Buffer => gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));

const VERSION = "1.2.3";
const SHIM = "#!/usr/bin/env node\n// shim\nimport('../dist/cli.js');\n";

const manifest = (overrides: Record<string, unknown> = {}) => ({
  name: "agent-cost-analyzer",
  version: VERSION,
  type: "module",
  bin: { "agent-cost-analyzer": "bin/agent-cost-analyzer.js" },
  files: ["bin/", "dist/", "THIRD-PARTY-NOTICES.md"],
  engines: { node: ">=22.18" },
  repository: { type: "git", url: "git+https://github.com/raulkivi/agent-cost-analyzer.git", directory: "packages/cli" },
  ...overrides,
});

function packageTarball(options: { manifest?: Record<string, unknown>; shim?: string; extra?: Entry[]; omit?: string[] } = {}): Buffer {
  const files: Entry[] = [
    { name: "package/package.json", content: JSON.stringify(options.manifest ?? manifest()) },
    { name: "package/LICENSE", content: "MIT" },
    { name: "package/README.md", content: "# agent-cost-analyzer" },
    { name: "package/THIRD-PARTY-NOTICES.md", content: "notices" },
    { name: "package/bin/agent-cost-analyzer.js", content: options.shim ?? SHIM },
    { name: "package/bin/node-gate.js", content: "export {};" },
    { name: "package/dist/cli.js", content: "export {};" },
    { name: "package/dist/mcp-apps/views.html", content: "<html></html>" },
    { name: "package/dist/web/index.html", content: "<html></html>" },
    ...(options.extra ?? []),
  ];
  return tgz(...files.filter((file) => !(options.omit ?? []).includes(file.name)).map(entry));
}

describe("readTarFiles", () => {
  it("reads each regular file's path and bytes from a gzipped ustar archive", () => {
    const files = readTarFiles(tgz(entry({ name: "package/a.txt", content: "alpha" }), entry({ name: "package/b/c.json", content: "{}" })));
    expect(files.map((file) => [file.path, file.content.toString("utf8")])).toEqual([
      ["package/a.txt", "alpha"],
      ["package/b/c.json", "{}"],
    ]);
  });

  it("reads a file that ends exactly on a block boundary, and an empty one", () => {
    const files = readTarFiles(tgz(entry({ name: "package/full", content: Buffer.alloc(512, 1) }), entry({ name: "package/empty" })));
    expect(files.map((file) => [file.path, file.content.length])).toEqual([
      ["package/full", 512],
      ["package/empty", 0],
    ]);
  });

  it("joins the ustar prefix to the name, and takes a pax header's path for the next entry only", () => {
    const long = `package/dist/web/assets/${"x".repeat(120)}.woff2`;
    const files = readTarFiles(
      tgz(entry({ name: "c.json", prefix: "package/dist/data", content: "{}" }), paxPath(long), entry({ name: "truncated", content: "font" }), entry({ name: "package/after" })),
    );
    expect(files.map((file) => file.path)).toEqual(["package/dist/data/c.json", long, "package/after"]);
  });

  it("skips directories and links", () => {
    const files = readTarFiles(tgz(entry({ name: "package/dir/", type: "5" }), entry({ name: "package/link", type: "2" }), entry({ name: "package/file", content: "1" })));
    expect(files.map((file) => file.path)).toEqual(["package/file"]);
  });

  it("refuses a truncated archive", () => {
    const whole = Buffer.concat([entry({ name: "package/a.txt", content: "x".repeat(2000) })]);
    expect(() => readTarFiles(gzipSync(whole.subarray(0, 1024)))).toThrow(/truncated/);
  });
});

describe("tarballProblems", () => {
  it("names the package the plan publishes", () => {
    expect(PUBLISHED).toEqual({
      name: "agent-cost-analyzer",
      nodeEngine: ">=22.18",
      repositoryUrl: "git+https://github.com/raulkivi/agent-cost-analyzer.git",
      bin: { "agent-cost-analyzer": "bin/agent-cost-analyzer.js" },
    });
  });

  it("passes a tarball with the expected files, manifest and shim", () => {
    expect(tarballProblems(packageTarball(), VERSION)).toEqual([]);
  });

  it("reuses NP6's file list and size budget (pack-check.mts)", () => {
    expect(tarballProblems(packageTarball({ omit: ["package/dist/cli.js"], extra: [{ name: "package/src/cli.ts" }] }), VERSION)).toEqual([
      "missing dist/cli.js",
      "unexpected src/cli.ts",
    ]);
    const big = packageTarball({ extra: [{ name: "package/dist/web/assets/big.bin", content: Buffer.alloc(12_000_001) }] });
    expect(tarballProblems(big, VERSION)).toEqual([expect.stringMatching(/^unpacked size \d+ bytes is over the 12000000-byte budget$/)]);
  });

  it("refuses native code: a .node file or a binding.gyp anywhere", () => {
    const problems = tarballProblems(packageTarball({ extra: [{ name: "package/dist/addon.node" }, { name: "package/binding.gyp" }] }), VERSION);
    expect(problems).toEqual(["unexpected dist/addon.node", "unexpected binding.gyp", "native code: dist/addon.node", "native code: binding.gyp"]);
  });

  it("refuses an entry outside package/", () => {
    expect(tarballProblems(tgz(entry({ name: "other/x" }), ...readTarFilesAsEntries(packageTarball())), VERSION)).toContain("entry outside package/: other/x");
  });

  it("refuses a tarball without package.json", () => {
    expect(tarballProblems(packageTarball({ omit: ["package/package.json"] }), VERSION)).toContain("package.json is missing or not JSON");
  });

  it("checks the name, version, engine and exact repository url", () => {
    const problems = tarballProblems(
      packageTarball({
        manifest: manifest({
          name: "agent-cost-analyser",
          version: "1.2.4",
          engines: { node: ">=22" },
          repository: { type: "git", url: "https://github.com/raulkivi/agent-cost-analyzer" },
        }),
      }),
      VERSION,
    );
    expect(problems).toEqual([
      'name is "agent-cost-analyser", expected "agent-cost-analyzer"',
      'version is "1.2.4", expected "1.2.3"',
      'engines.node is ">=22", expected ">=22.18"',
      'repository.url is "https://github.com/raulkivi/agent-cost-analyzer", expected "git+https://github.com/raulkivi/agent-cost-analyzer.git"',
    ]);
  });

  it("refuses a repository given as a string, as provenance needs the exact url", () => {
    expect(tarballProblems(packageTarball({ manifest: manifest({ repository: "github:raulkivi/agent-cost-analyzer" }) }), VERSION)).toEqual([
      'repository.url is undefined, expected "git+https://github.com/raulkivi/agent-cost-analyzer.git"',
    ]);
  });

  it("refuses any scripts field, so no lifecycle script can run on install", () => {
    for (const scripts of [{ postinstall: "node x.js" }, { prepare: "tsc" }, { test: "vitest" }, {}]) {
      expect(tarballProblems(packageTarball({ manifest: manifest({ scripts }) }), VERSION)).toEqual([
        `has a scripts field (${Object.keys(scripts).join(", ") || "empty"}); the published package must have none`,
      ]);
    }
    expect(tarballProblems(packageTarball({ manifest: manifest({ gypfile: true }) }), VERSION)).toEqual(["has gypfile; the published package must have no native build"]);
  });

  it("refuses dependencies of any kind", () => {
    for (const key of ["dependencies", "optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"]) {
      const value = key.startsWith("bundle") ? ["express"] : { express: "^5.0.0" };
      expect(tarballProblems(packageTarball({ manifest: manifest({ [key]: value }) }), VERSION), key).toEqual([`${key} is not empty`]);
    }
    expect(tarballProblems(packageTarball({ manifest: manifest({ dependencies: {}, bundleDependencies: [] }) }), VERSION)).toEqual([]);
  });

  it("checks the bin: the one entry, a #!/usr/bin/env node line, LF endings", () => {
    expect(tarballProblems(packageTarball({ manifest: manifest({ bin: { other: "bin/agent-cost-analyzer.js" } }) }), VERSION)).toEqual([
      'bin is {"other":"bin/agent-cost-analyzer.js"}, expected {"agent-cost-analyzer":"bin/agent-cost-analyzer.js"}',
    ]);
    expect(tarballProblems(packageTarball({ shim: "// no shebang\n" }), VERSION)).toEqual(["bin/agent-cost-analyzer.js does not start with #!/usr/bin/env node and LF"]);
    expect(tarballProblems(packageTarball({ shim: "#!/usr/bin/env node\r\nimport('x');\r\n" }), VERSION)).toEqual([
      "bin/agent-cost-analyzer.js does not start with #!/usr/bin/env node and LF",
      "bin/agent-cost-analyzer.js has CR line endings",
    ]);
    expect(tarballProblems(packageTarball({ omit: ["package/bin/agent-cost-analyzer.js"] }), VERSION)).toEqual([
      "missing bin/agent-cost-analyzer.js",
      "bin/agent-cost-analyzer.js is not in the tarball",
    ]);
  });
});

// The entries of a tarball, re-encoded, to put another entry before them.
function readTarFilesAsEntries(tarball: Buffer): Buffer[] {
  return readTarFiles(tarball).map((file) => entry({ name: file.path, content: file.content }));
}
