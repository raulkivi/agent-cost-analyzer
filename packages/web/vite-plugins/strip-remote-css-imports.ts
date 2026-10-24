import type { Plugin } from "vite";

// An `@import` of an http(s) or protocol-relative URL, bare or in url(),
// with any media query, up to its semicolon and trailing whitespace.
const REMOTE_CSS_IMPORT = /@import\s+(?:url\(\s*)?(["']?)(?:https?:)?\/\/[^"')\s]+\1\s*\)?[^;]*;\s*/g;

// Removes remote @imports from a stylesheet (G12, vscode-extension.md
// §2.2): the webview CSP blocks them, and constraint 1 forbids the network
// call. Fonts then fall back to the rest of each font stack.
export function stripRemoteCssImports(css: string): string {
  return css.replace(REMOTE_CSS_IMPORT, "");
}

// Applied only by the extension build mode (vite.config.ts), so the
// standalone app's CSS is unchanged.
export function stripRemoteCssImportsPlugin(): Plugin {
  return {
    name: "strip-remote-css-imports",
    enforce: "pre",
    transform(code, id) {
      if (!/\.css(?:$|\?)/.test(id)) return null;
      const stripped = stripRemoteCssImports(code);
      return stripped === code ? null : { code: stripped, map: null };
    },
  };
}
