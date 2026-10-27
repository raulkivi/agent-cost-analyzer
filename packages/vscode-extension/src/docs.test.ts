import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { headingAnchors, isAbsoluteUrl, markdownLinks, splitTarget } from "./docs/markdown.js";

// Doc checks for step 10.10 (vscode-extension.md): the Marketplace README,
// the extension guide and the repo's main docs stay complete, linkable and
// correctly named. Docs aren't test-driven; these checks are.

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageDir, "..", "..");

const EXTENSION_README = "packages/vscode-extension/README.md";
const EXTENSION_CHANGELOG = "packages/vscode-extension/CHANGELOG.md";
const GUIDE = "docs/vscode-extension-guide.md";
// Every doc whose relative links and anchors must resolve.
const LINKED_DOCS = ["README.md", "docs/UserGuide.md", GUIDE, "CONTRIBUTING.md", "docs/threat-model.md", EXTENSION_CHANGELOG];

// Absolute URLs into this repo's main branch, which must name files that exist.
const REPO_URL = /^https:\/\/github\.com\/raulkivi\/agent-cost-analyzer\/(?:blob|tree)\/main\/([^#?]*)(?:[?#].*)?$/;
const RAW_URL = /^https:\/\/raw\.githubusercontent\.com\/raulkivi\/agent-cost-analyzer\/(?:refs\/heads\/)?main\/([^#?]*)/;

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf-8")) as {
  engines: { vscode: string };
  contributes: {
    commands: { command: string; title: string }[];
    views: Record<string, { id: string }[]>;
    configuration: { properties: Record<string, unknown> };
  };
};
const nls = JSON.parse(readFileSync(path.join(packageDir, "package.nls.json"), "utf-8")) as Record<string, string>;

function localized(value: string): string {
  return value.replace(/^%(.+)%$/, (_match, key: string) => nls[key] ?? value);
}

const anchorCache = new Map<string, Set<string>>();
function anchorsOf(absolutePath: string): Set<string> {
  let anchors = anchorCache.get(absolutePath);
  if (!anchors) {
    anchors = headingAnchors(readFileSync(absolutePath, "utf-8"));
    anchorCache.set(absolutePath, anchors);
  }
  return anchors;
}

// Why a file path (plus optional anchor) doesn't resolve, or null if it does.
function unresolved(absolutePath: string, anchor: string | undefined): string | null {
  if (!existsSync(absolutePath)) {
    return "no such file";
  }
  if (anchor === undefined || anchor === "" || statSync(absolutePath).isDirectory() || !absolutePath.endsWith(".md")) {
    return null;
  }
  return anchorsOf(absolutePath).has(anchor) ? null : `no heading #${anchor}`;
}

describe("the extension guide covers every contribution (step 10.10)", () => {
  // Read in each test, so a missing doc fails the tests, not the file.
  const guide = (): string => read(GUIDE);

  it.each(manifest.contributes.commands.map((command) => [command.command, localized(command.title)]))(
    "command %s (%s)",
    (id, title) => {
      expect(guide().includes(`\`${id}\``) || guide().includes(title), `${id} or "${title}" in ${GUIDE}`).toBe(true);
    },
  );

  it.each(Object.keys(manifest.contributes.configuration.properties))("setting %s", (id) => {
    expect(guide()).toContain(id);
  });

  it.each(Object.values(manifest.contributes.views).flatMap((views) => views.map((view) => view.id)))("view %s", (id) => {
    expect(guide()).toContain(id);
  });
});

describe("the extension README works on the Marketplace and Open VSX (§7.0)", () => {
  const links = (): ReturnType<typeof markdownLinks> => markdownLinks(read(EXTENSION_README));

  it("has links to check", () => {
    expect(links().length).toBeGreaterThan(0);
  });

  it("uses only absolute HTTPS URLs for links and images", () => {
    const notHttps = links().filter((link) => !link.target.startsWith("https://")).map((link) => `line ${link.line}: ${link.target}`);

    expect(notHttps).toEqual([]);
  });

  it("uses no SVG images", () => {
    const svgs = links().filter((link) => link.image && /\.svg$/i.test(link.target.split(/[?#]/)[0])).map((link) => link.target);

    expect(svgs).toEqual([]);
  });

  it("names files that exist when it links into this repo's main branch", () => {
    const missing = links().flatMap((link) => {
      const match = REPO_URL.exec(link.target) ?? RAW_URL.exec(link.target);
      if (!match) {
        return [];
      }
      const anchor = REPO_URL.test(link.target) ? splitTarget(link.target).anchor : undefined;
      const problem = unresolved(path.join(repoRoot, decodeURIComponent(match[1])), anchor);
      return problem === null ? [] : [`line ${link.line}: ${link.target} (${problem})`];
    });

    expect(missing).toEqual([]);
  });

  // The engine is bumped every release (D9), so a stale minimum would turn
  // away users the listing says are supported, or the reverse.
  it("names the minimum VS Code version that engines.vscode requires", () => {
    const [, major, minor] = /^\^(\d+)\.(\d+)\.\d+$/.exec(manifest.engines.vscode) ?? [];

    expect(read(EXTENSION_README)).toContain(`VS Code ${major}.${minor} or later`);
  });
});

describe("the product name never includes Copilot (§3.4)", () => {
  // "Copilot" plus up to two words before "Analyzer", or "Analyzer for/with
  // Copilot". Repo and package names use hyphens, so they don't match.
  const COPILOT_IN_NAME = [/\bCopilot\s+(?:[\w-]+\s+){0,2}Analy[sz]er\b/i, /\bAnaly[sz]er\s+(?:for|with|by)\s+(?:GitHub\s+)?Copilot\b/i];

  it.each([EXTENSION_README, GUIDE, EXTENSION_CHANGELOG])("%s", (file) => {
    const text = read(file);

    expect(text).toContain("AI Credits Analyzer");
    for (const pattern of COPILOT_IN_NAME) {
      expect(text.match(pattern)?.[0] ?? null, `${file} matches ${pattern}`).toBeNull();
    }
  });
});

describe("relative links resolve to files and headings", () => {
  it.each(LINKED_DOCS)("%s", (file) => {
    const fileDir = path.dirname(path.join(repoRoot, file));
    const broken = markdownLinks(read(file)).flatMap((link) => {
      const rawMatch = RAW_URL.exec(link.target);
      if (rawMatch) {
        const problem = unresolved(path.join(repoRoot, decodeURIComponent(rawMatch[1])), undefined);
        return problem === null ? [] : [`line ${link.line}: ${link.target} (${problem})`];
      }
      if (isAbsoluteUrl(link.target)) {
        return [];
      }
      const { path: targetPath, anchor } = splitTarget(link.target);
      const absolutePath = targetPath === "" ? path.join(repoRoot, file) : path.resolve(fileDir, targetPath);
      const problem = unresolved(absolutePath, anchor);
      return problem === null ? [] : [`line ${link.line}: ${link.target} (${problem})`];
    });

    expect(broken).toEqual([]);
  });
});
