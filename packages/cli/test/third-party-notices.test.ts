// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The generated THIRD-PARTY-NOTICES.md (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.9): every npm
// package in the bundle with its license text, plus the fonts section.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LICENSE_ALLOW_LIST,
  bundledPackageDirs,
  fontsSectionOf,
  generateNotices,
  isAllowedLicense,
  readBundledPackage,
  readBundledPackagesList,
  renderNotices,
} from "../../../scripts/third-party-notices.mts";

const ROOT_NOTICES = `# Third-party notices

**Last changed:** 2026-11-14 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

The web build bundles the fonts below.

| Font | Package |
|---|---|
| Commit Mono | \`@fontsource/commit-mono\` 5.3.0 |

## SIL Open Font License 1.1

\`\`\`text
OFL text
\`\`\`
`;

describe("isAllowedLicense", () => {
  it("allows exactly the plan's list", () => {
    expect([...LICENSE_ALLOW_LIST]).toEqual(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"]);
    for (const id of LICENSE_ALLOW_LIST) expect(isAllowedLicense(id)).toBe(true);
  });

  it("refuses other licenses, unknown and missing ones", () => {
    for (const id of ["GPL-3.0", "LGPL-2.1", "BlueOak-1.0.0", "CC-BY-4.0", "UNLICENSED", "SEE LICENSE IN LICENSE", "mit", ""]) {
      expect(isAllowedLicense(id), id).toBe(false);
    }
    expect(isAllowedLicense(undefined)).toBe(false);
  });

  it("allows an OR expression when one choice is allowed, an AND expression only when all are", () => {
    expect(isAllowedLicense("(MIT OR GPL-3.0)")).toBe(true);
    expect(isAllowedLicense("(GPL-3.0 OR LGPL-2.1)")).toBe(false);
    expect(isAllowedLicense("MIT AND ISC")).toBe(true);
    expect(isAllowedLicense("(MIT AND CC-BY-4.0)")).toBe(false);
  });
});

describe("bundledPackageDirs", () => {
  it("finds each npm package folder the bundle read from, scoped and nested ones included, first-party code left out", () => {
    const metafile = {
      inputs: {
        "src/cli.ts": {},
        "../server/src/app.ts": {},
        "../../node_modules/express/index.js": {},
        "../../node_modules/express/lib/express.js": {},
        "../../node_modules/@modelcontextprotocol/server/dist/index.mjs": {},
        "../../node_modules/body-parser/node_modules/debug/src/index.js": {},
        "../../node_modules/zod/v4/core/core.js": {},
        "(disabled):../../node_modules/ws/browser.js": {},
      },
    };
    expect(bundledPackageDirs(metafile, "/repo/packages/cli")).toEqual([
      "/repo/node_modules/@modelcontextprotocol/server",
      "/repo/node_modules/body-parser/node_modules/debug",
      "/repo/node_modules/express",
      "/repo/node_modules/zod",
    ]);
  });
});

describe("fontsSectionOf", () => {
  it("takes the root notices' body, below its header, with its headings one level down", () => {
    const section = fontsSectionOf(ROOT_NOTICES);
    expect(section.startsWith("The web build bundles the fonts below.")).toBe(true);
    expect(section).toContain("| Commit Mono | `@fontsource/commit-mono` 5.3.0 |");
    expect(section).toContain("\n### SIL Open Font License 1.1\n");
    expect(section).not.toContain("Last changed");
    expect(section).not.toMatch(/^#{1,2} /m);
  });

  it("fails on a root file without the document header", () => {
    expect(() => fontsSectionOf("# Third-party notices\n\nNo header.\n")).toThrow(/Last changed/);
  });
});

describe("renderNotices", () => {
  const notices = renderNotices({
    packageName: "agent-cost-analyzer",
    packageVersion: "1.2.3",
    packages: [
      {
        name: "zod",
        version: "4.6.7",
        license: "MIT",
        licenseTexts: [{ file: "LICENSE", text: "MIT License\n\nCopyright (c) Colin\n" }],
        parts: ["server", "web", "views"],
      },
      {
        name: "@scope/thing",
        version: "1.0.0",
        license: "Apache-2.0",
        licenseTexts: [
          { file: "LICENSE", text: "Apache text" },
          { file: "NOTICE", text: "Notice text" },
        ],
        parts: ["views"],
      },
    ],
    fontsSection: "The fonts.\n\n### SIL Open Font License 1.1\n",
  });

  it("names the package and version it was generated for and links the source", () => {
    expect(notices.startsWith("# Third-party notices\n\n")).toBe(true);
    expect(notices).toContain("agent-cost-analyzer 1.2.3");
    expect(notices).toContain("https://github.com/raulkivi/agent-cost-analyzer");
  });

  it("lists every bundled package, sorted, in a table row with its version, license and the parts that bundle it", () => {
    expect(notices).toContain("| `@scope/thing` | 1.0.0 | Apache-2.0 | views |\n| `zod` | 4.6.7 | MIT | server, web, views |");
  });

  it("includes each package's license files verbatim", () => {
    expect(notices).toContain("### zod 4.6.7\n\n`LICENSE`:\n\n````text\nMIT License\n\nCopyright (c) Colin\n````");
    expect(notices).toContain("`NOTICE`:\n\n````text\nNotice text\n````");
  });

  it("includes the fonts section", () => {
    expect(notices).toContain("## Fonts\n\nThe fonts.\n\n### SIL Open Font License 1.1\n");
  });

  it("is the same for the same input (reproducible builds)", () => {
    expect(notices).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("reading package folders", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "cli-notices-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function fakePackage(relative: string, manifest: Record<string, unknown>, files: Record<string, string>): string {
    const dir = path.join(root, "node_modules", relative);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
    return dir;
  }

  it("reads the name, version, license and license files (LICENSE, LICENCE, COPYING, NOTICE, any extension)", () => { // codespell:ignore licence
    const dir = fakePackage(
      "@scope/thing",
      { name: "@scope/thing", version: "1.0.0", license: "Apache-2.0" },
      { "LICENSE.txt": "Apache text", NOTICE: "Notice text", "README.md": "readme", "index.js": "" },
    );
    expect(readBundledPackage(dir)).toEqual({
      parts: [],
      name: "@scope/thing",
      version: "1.0.0",
      license: "Apache-2.0",
      licenseTexts: [
        { file: "LICENSE.txt", text: "Apache text" },
        { file: "NOTICE", text: "Notice text" },
      ],
    });
  });

  it("reads the old { type } license form", () => {
    const dir = fakePackage("old", { name: "old", version: "0.1.0", license: { type: "ISC" } }, { "license.md": "ISC text" });
    expect(readBundledPackage(dir)).toMatchObject({ license: "ISC", licenseTexts: [{ file: "license.md", text: "ISC text" }] });
  });

  describe("readBundledPackagesList", () => {
    it("reads the package folders a Vite build recorded", () => {
      const file = path.join(root, "list.json");
      writeFileSync(file, JSON.stringify({ packages: [{ name: "a", version: "1.0.0", dir: "/x/a" }, { name: "b", version: "2.0.0", dir: "/x/b" }] }));
      expect(readBundledPackagesList(file, "web")).toEqual(["/x/a", "/x/b"]);
    });

    it("fails, naming the part, when the list is missing or malformed", () => {
      expect(() => readBundledPackagesList(path.join(root, "none.json"), "web")).toThrow(/web.*none\.json/s);
      const bad = path.join(root, "bad.json");
      writeFileSync(bad, "{}");
      expect(() => readBundledPackagesList(bad, "views")).toThrow(/views/);
    });
  });

  describe("generateNotices", () => {
    const metafileFor = (...relative: string[]) => ({
      inputs: Object.fromEntries(relative.map((r) => [`../node_modules/${r}/index.js`, {}])),
    });
    const dirOf = (relative: string) => path.join(root, "node_modules", relative);
    const generate = (server: string[], extra: Record<string, string[]> = {}) =>
      generateNotices({
        metafile: metafileFor(...server),
        workingDir: path.join(root, "cli"),
        extraParts: Object.entries(extra).map(([label, relative]) => ({ label, dirs: relative.map(dirOf) })),
        rootNotices: ROOT_NOTICES,
        packageName: "agent-cost-analyzer",
        packageVersion: "1.2.3",
      });

    it("renders every package of the metafile and the fonts", () => {
      fakePackage("a", { name: "a", version: "1.0.0", license: "MIT" }, { LICENSE: "MIT a" });
      fakePackage("b", { name: "b", version: "2.0.0", license: "(MIT OR GPL-3.0)" }, { LICENCE: "MIT b" }); // codespell:ignore licence
      const notices = generate(["a", "b"]);
      expect(notices).toContain("| `a` | 1.0.0 | MIT | server |\n| `b` | 2.0.0 | (MIT OR GPL-3.0) | server |");
      expect(notices).toContain("The web build bundles the fonts below.");
    });

    it("merges the server, web and views lists into one entry per package@version, naming each part", () => {
      fakePackage("a", { name: "a", version: "1.0.0", license: "MIT" }, { LICENSE: "MIT a" });
      fakePackage("react", { name: "react", version: "19.0.0", license: "MIT" }, { LICENSE: "MIT react" });
      fakePackage("only-views", { name: "only-views", version: "3.0.0", license: "ISC" }, { LICENSE: "ISC v" });
      fakePackage("a/node_modules/react", { name: "react", version: "18.0.0", license: "MIT" }, { LICENSE: "MIT old react" });
      const notices = generate(["a"], { web: ["a", "react"], views: ["react", "only-views", "a/node_modules/react"] });
      expect(notices).toContain("| `a` | 1.0.0 | MIT | server, web |");
      expect(notices).toContain("| `only-views` | 3.0.0 | ISC | views |");
      expect(notices).toContain("| `react` | 18.0.0 | MIT | views |\n| `react` | 19.0.0 | MIT | web, views |");
      expect(notices.match(/### a 1\.0\.0/g)).toHaveLength(1);
    });

    it("merges further esbuild metafiles under their own labels, and leaves the fonts out when there are no root notices", () => {
      fakePackage("a", { name: "a", version: "1.0.0", license: "MIT" }, { LICENSE: "MIT a" });
      fakePackage("b", { name: "b", version: "2.0.0", license: "ISC" }, { LICENSE: "ISC b" });
      const notices = generateNotices({
        metafile: metafileFor("a"),
        metafileLabel: "host",
        extraMetafiles: [{ label: "mcp", metafile: metafileFor("a", "b") }],
        workingDir: path.join(root, "cli"),
        extraParts: [],
        packageName: "ext",
        packageVersion: "0.1.0",
      });
      expect(notices).toContain("| `a` | 1.0.0 | MIT | host, mcp |");
      expect(notices).toContain("| `b` | 2.0.0 | ISC | mcp |");
      expect(notices).not.toContain("## Fonts");
    });

    it("fails on a package only the web or views build bundles when its license is off the allow-list", () => {
      fakePackage("gpl", { name: "gpl", version: "1.0.0", license: "GPL-3.0" }, { LICENSE: "GPL" });
      expect(() => generate([], { web: ["gpl"] })).toThrow(/gpl@1\.0\.0: license GPL-3\.0 is not allowed/);
    });

    it("fails, naming each package, when a license is not on the allow-list or has no license file", () => {
      fakePackage("gpl", { name: "gpl", version: "1.0.0", license: "GPL-3.0" }, { LICENSE: "GPL" });
      fakePackage("bare", { name: "bare", version: "1.0.0", license: "MIT" }, {});
      expect(() => generate(["gpl", "bare"])).toThrow(/gpl@1\.0\.0: license GPL-3\.0 is not allowed/);
      expect(() => generate(["gpl", "bare"])).toThrow(/bare@1\.0\.0: no license file/);
    });
  });
});
