import type { Plugin } from "vite";

// Virtual id prefix ("\0" keeps other plugins off it); the extension of the
// original import is kept, so an omitted stylesheet still goes through
// Vite's CSS pipeline as an empty one.
const EMPTY_PREFIX = "\0omitted:";

// Replaces every import whose specifier matches `pattern` with an empty
// module. The extension build uses it to leave out the standalone app's
// bundled fonts (G12): the webview uses --vscode-font-family instead, so
// they'd only add weight to the .vsix.
export function omitModulesPlugin(pattern: RegExp): Plugin {
  return {
    name: "omit-modules",
    enforce: "pre",
    resolveId(source) {
      return pattern.test(source) ? `${EMPTY_PREFIX}${source}` : null;
    },
    load(id) {
      return id.startsWith(EMPTY_PREFIX) ? "" : null;
    },
  };
}
