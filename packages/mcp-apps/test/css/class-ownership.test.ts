// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// All views ship in one bundle, so a class name is global. U10 and U11 once
// collided on cc-total, cc-sub and cc-note. Each view's stylesheet may only
// define classes with its own prefix, and no class may be defined by two
// views. Shared styles live in theme/ and are exempt.

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

const VIEW_PREFIXES: Record<string, readonly string[]> = {
  "views/audit/audit.css": ["au-"],
  "views/cost-compare/cost-compare.css": ["cc-"],
  "views/cost-change/cost-change.css": ["cv-"],
  "views/cost-over-time/cost-over-time.css": ["ct-"],
  "views/cost-rollup/cost-rollup.css": ["rv-"],
  "views/findings/findings.css": ["fv-", "findings-"],
  "views/price-changes/price-changes.css": ["pc-"],
  "views/statement/statement.css": ["stm-"],
  "views/estimate/estimate.css": ["est-"],
  "views/session-picker/session-picker.css": ["sp-"],
};

// Classes a view's CSS may mention but another module owns: web's shared
// components and state modifiers it styles in context (e.g. `.ct-tiles .stat-tile`).
const EXTERNAL = new Set(["stat-tile", "seg", "seg-opt", "is-dim", "is-expanded"]);
const EXTERNAL_PREFIXES = ["waterfall-"];

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    return entry.name.endsWith(".css") ? [path.relative(src, full).split(path.sep).join("/")] : [];
  });
}

// Class names that appear in selectors only (not in comments or declarations).
function selectorClasses(css: string): Set<string> {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const preludes: string[] = [];
  let start = 0;
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i];
    if (ch === "{") {
      const text = noComments.slice(start, i).trim();
      if (!text.startsWith("@")) preludes.push(text);
      start = i + 1;
    } else if (ch === "}" || ch === ";") {
      start = i + 1;
    }
  }
  const classes = new Set<string>();
  for (const prelude of preludes) {
    for (const match of prelude.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(match[1]!);
  }
  return classes;
}

const files = cssFiles(src);
const read = (file: string) => selectorClasses(readFileSync(path.join(src, file), "utf8"));
const shared = new Set(files.filter((file) => file.startsWith("theme/")).flatMap((file) => [...read(file)]));
const isOwnedElsewhere = (name: string) => EXTERNAL.has(name) || EXTERNAL_PREFIXES.some((prefix) => name.startsWith(prefix)) || shared.has(name);

describe("selectorClasses", () => {
  it("ignores comments, declarations and at-rule preludes", () => {
    const css = "/* .in-comment */ .a, .b > .c { background: url(x.png); margin: 0.5px } @media (min-width: 1px) { .d:hover { color: red } }";
    expect([...selectorClasses(css)].sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("view stylesheet class ownership", () => {
  it("lists every stylesheet outside theme/ in the prefix map", () => {
    const views = files.filter((file) => !file.startsWith("theme/"));
    expect(views.sort()).toEqual(Object.keys(VIEW_PREFIXES).sort());
  });

  it("gives each view prefixes no other view's prefix starts with", () => {
    const all = Object.values(VIEW_PREFIXES).flat();
    for (const prefix of all) expect(all.filter((other) => other.startsWith(prefix) || prefix.startsWith(other))).toEqual([prefix]);
  });

  for (const [file, prefixes] of Object.entries(VIEW_PREFIXES)) {
    it(`${file} defines only ${prefixes.join(" / ")} classes`, () => {
      const violations = [...read(file)].filter((name) => !prefixes.some((prefix) => name.startsWith(prefix)) && !isOwnedElsewhere(name));
      expect(violations.sort()).toEqual([]);
    });
  }

  it("defines no class in two view stylesheets", () => {
    const owners = new Map<string, string[]>();
    for (const file of Object.keys(VIEW_PREFIXES)) {
      for (const name of read(file)) {
        if (isOwnedElsewhere(name)) continue;
        owners.set(name, [...(owners.get(name) ?? []), file]);
      }
    }
    const shadowed = [...owners].filter(([, list]) => list.length > 1).map(([name, list]) => `${name}: ${list.join(", ")}`);
    expect(shadowed).toEqual([]);
  });
});
