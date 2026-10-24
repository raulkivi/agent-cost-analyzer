import { describe, expect, it } from "vitest";
import { buildPanelHtml, type ViteManifest } from "./panel-html.js";

const NONCE = "r4nd0mN0nce+/=";
const CSP_SOURCE = "https://file+.vscode-resource.vscode-cdn.net";

const manifest: ViteManifest = {
  "index.html": {
    file: "assets/index-abc.js",
    src: "index.html",
    isEntry: true,
    css: ["assets/index-def.css"],
  },
};

// Stands in for webview.asWebviewUri(<media>/<path>).
const assetUri = (relativePath: string) => `${CSP_SOURCE}/ext/media/${relativePath}`;

function render(overrides: Partial<Parameters<typeof buildPanelHtml>[0]> = {}): string {
  return buildPanelHtml({ manifest, nonce: NONCE, cspSource: CSP_SOURCE, assetUri, ...overrides });
}

function cspOf(html: string): string {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html);
  if (!match) throw new Error("no CSP meta tag");
  return match[1];
}

describe("buildPanelHtml (vscode-extension.md §5)", () => {
  it("sets the plan's CSP: nothing by default, nonce scripts, no network from the UI", () => {
    expect(cspOf(render())).toBe(
      "default-src 'none'; " +
        `script-src 'nonce-${NONCE}'; ` +
        `style-src ${CSP_SOURCE} 'unsafe-inline'; ` +
        `img-src ${CSP_SOURCE} data:; ` +
        `font-src ${CSP_SOURCE}; ` +
        "connect-src 'none'",
    );
  });

  it("puts the nonce on every script tag", () => {
    const html = render();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];

    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toContain(`nonce="${NONCE}"`);
    }
  });

  it("loads the manifest entry's script as a module through the webview URI mapper", () => {
    expect(render()).toContain(`<script type="module" nonce="${NONCE}" src="${assetUri("assets/index-abc.js")}"></script>`);
  });

  it("links the entry's stylesheet", () => {
    expect(render()).toContain(`<link rel="stylesheet" href="${assetUri("assets/index-def.css")}">`);
  });

  it("also links the stylesheets of chunks the entry imports", () => {
    const html = render({
      manifest: {
        "index.html": { file: "assets/index.js", isEntry: true, imports: ["_shared.js"] },
        "_shared.js": { file: "assets/shared.js", css: ["assets/shared.css"] },
      },
    });

    expect(html).toContain(`<link rel="stylesheet" href="${assetUri("assets/shared.css")}">`);
  });

  it("never emits absolute /assets URLs, which a webview can't resolve", () => {
    expect(render()).not.toMatch(/(src|href)="\/assets/);
  });

  it("has the root element the web app mounts into", () => {
    expect(render()).toContain('<div id="root"></div>');
  });

  it("escapes attribute values", () => {
    const html = render({ assetUri: (relativePath) => `x"><script>alert(1)</script>/${relativePath}` });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("rejects a nonce that could break out of the CSP", () => {
    expect(() => render({ nonce: "abc'; script-src *" })).toThrow(/nonce/);
    expect(() => render({ nonce: "" })).toThrow(/nonce/);
  });

  it("fails clearly when the manifest has no index.html entry", () => {
    expect(() => render({ manifest: {} })).toThrow(/index\.html/);
  });
});
