// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cascadeVars, normalizeColorFunctions, parseRules, resolveColor } from "./css-vars.js";

// The test-side CSS reader the contrast tests stand on: it must read the
// real stylesheets the way a browser would for custom properties on <html>.

describe("parseRules", () => {
  it("reads flat rules, drops comments and keeps declaration order", () => {
    const rules = parseRules(`
      /* a; comment { with: braces } */
      :root, html[data-host="mcp-app"] { --a: 1; --b: color-mix(in srgb, #000 10%, transparent); }
      .card { color: red }
    `);
    expect(rules).toHaveLength(2);
    expect(rules[0]!.selectors).toEqual([":root", 'html[data-host="mcp-app"]']);
    expect(rules[0]!.declarations).toEqual([
      ["--a", "1"],
      ["--b", "color-mix(in srgb, #000 10%, transparent)"],
    ]);
  });
});

describe("cascadeVars", () => {
  const css = `
    :root { --x: root; --y: root; }
    html[data-host="mcp-app"] { --x: host; }
    html[data-host="mcp-app"][data-theme="dark"] { --x: dark; }
    body { --x: body; }
  `;

  it("applies :root, then the more specific attribute rules", () => {
    expect(cascadeVars([css], { theme: "light", hostVars: {} })).toMatchObject({ "--x": "host", "--y": "root" });
    expect(cascadeVars([css], { theme: "dark", hostVars: {} })).toMatchObject({ "--x": "dark", "--y": "root" });
  });

  it("lets a later rule of equal specificity win, and ignores non-root selectors", () => {
    const vars = cascadeVars([':root { --x: 1 }', ':root { --x: 2 }', ".card { --x: 3 }"], { theme: "light", hostVars: {} });
    expect(vars["--x"]).toBe("2");
  });

  it("lets the host's inline variables beat every stylesheet rule", () => {
    const vars = cascadeVars([css], { theme: "dark", hostVars: { "--x": "inline" } });
    expect(vars["--x"]).toBe("inline");
  });

  it("does not apply data-host rules when the page is not marked as an MCP App", () => {
    const vars = cascadeVars([css], { theme: "light", hostVars: {}, markedAsApp: false });
    expect(vars["--x"]).toBe("root");
  });
});

describe("normalizeColorFunctions", () => {
  it("picks the branch light-dark() would use for the document theme", () => {
    const value = "light-dark(rgba(20, 20, 19, 1), rgba(250, 249, 245, 1))";
    expect(normalizeColorFunctions(value, "light")).toBe("#141413");
    expect(normalizeColorFunctions(value, "dark")).toBe("#faf9f5");
  });

  it("handles nesting and leaves other text alone", () => {
    expect(normalizeColorFunctions("color-mix(in srgb, light-dark(#111, #eee) 40%, transparent)", "dark")).toBe(
      "color-mix(in srgb, #eee 40%, transparent)",
    );
    expect(normalizeColorFunctions("ui-sans-serif, system-ui", "dark")).toBe("ui-sans-serif, system-ui");
  });

  it("keeps a partly transparent rgba() as a mix with transparent", () => {
    expect(normalizeColorFunctions("rgba(31, 30, 29, 0.4)", "light")).toBe("color-mix(in srgb, #1f1e1d 40%, transparent)");
  });
});

describe("resolveColor", () => {
  it("resolves var() chains, fallbacks and light-dark() through the cascade", () => {
    const vars = { "--a": "var(--b)", "--b": "light-dark(#ffffff, #000000)" };
    expect(resolveColor("var(--a)", vars, "light")).toEqual([255, 255, 255]);
    expect(resolveColor("var(--a)", vars, "dark")).toEqual([0, 0, 0]);
    expect(resolveColor("var(--missing, #336699)", vars, "dark")).toEqual([0x33, 0x66, 0x99]);
  });

  it("paints a mix with transparent over the given backdrop", () => {
    expect(resolveColor("color-mix(in srgb, #000000 50%, transparent)", {}, "light", [255, 255, 255])).toEqual([127.5, 127.5, 127.5]);
  });

  it("throws on a variable that is undefined and has no fallback", () => {
    expect(() => resolveColor("var(--nope)", {}, "light")).toThrow(/--nope/);
  });
});
