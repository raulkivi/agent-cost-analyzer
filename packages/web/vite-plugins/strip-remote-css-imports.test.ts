import { describe, expect, it } from "vitest";
import { stripRemoteCssImports, stripRemoteCssImportsPlugin } from "./strip-remote-css-imports.js";

const GOOGLE_FONTS_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;700&family=Barlow+Condensed:wght@400;600&display=swap');";

describe("stripRemoteCssImports (G12: the webview CSP and constraint 1 forbid remote CSS)", () => {
  it("removes theme.css's Google Fonts @import and keeps the rest", () => {
    const css = `/* header */\n${GOOGLE_FONTS_IMPORT}\n\n:root { --a: 1; }\n`;

    expect(stripRemoteCssImports(css)).toBe("/* header */\n:root { --a: 1; }\n");
  });

  it.each([
    '@import "https://example.com/a.css";',
    "@import url(https://example.com/a.css) screen;",
    '@import url("http://example.com/a.css");',
    "@import url(//example.com/a.css);",
  ])("removes the remote import %s", (statement) => {
    expect(stripRemoteCssImports(`${statement}\nbody { color: red; }`)).toBe("body { color: red; }");
  });

  it("keeps local imports", () => {
    const css = '@import "./local.css";\n@import url(./other.css);\n';

    expect(stripRemoteCssImports(css)).toBe(css);
  });
});

describe("stripRemoteCssImportsPlugin", () => {
  const plugin = stripRemoteCssImportsPlugin();
  const transform = plugin.transform as (code: string, id: string) => { code: string } | null;

  it("runs before Vite's own CSS handling", () => {
    expect(plugin.enforce).toBe("pre");
  });

  it("strips remote imports from CSS modules only", () => {
    expect(transform(`${GOOGLE_FONTS_IMPORT}\nbody {}`, "/src/theme.css")?.code).toBe("body {}");
    expect(transform(`const s = "${GOOGLE_FONTS_IMPORT}";`, "/src/main.tsx")).toBeNull();
  });

  it("leaves CSS without remote imports untouched", () => {
    expect(transform("body {}", "/src/theme.css")).toBeNull();
  });
});
