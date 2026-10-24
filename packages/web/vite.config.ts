import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { omitModulesPlugin } from "./vite-plugins/omit-modules.js";
import { stripRemoteCssImportsPlugin } from "./vite-plugins/strip-remote-css-imports.js";

// `vite build --mode extension` builds the webview for the VS Code
// extension (vscode-extension.md G7, G12): relative asset URLs (webviews
// map them through asWebviewUri), a manifest the extension builds its
// CSP/nonce HTML from, output in the extension's media/ folder, no remote
// CSS imports, and none of the standalone app's bundled fonts (the webview
// uses the editor's). Every other mode is the standalone app, unchanged.
const extensionBuild = {
  base: "./",
  plugins: [stripRemoteCssImportsPlugin(), omitModulesPlugin(/^@fontsource\//)],
  build: {
    // At media/manifest.json rather than Vite's default .vite/, so the
    // .vsix packaging (step 10.9) needn't ship a dot-directory.
    manifest: "manifest.json",
    outDir: fileURLToPath(new URL("../vscode-extension/media", import.meta.url)),
    // outDir is outside this package's root, where Vite only empties it
    // when asked to.
    emptyOutDir: true,
  },
};

export default defineConfig(({ mode }) => {
  const extension = mode === "extension";
  return {
    plugins: [react(), ...(extension ? extensionBuild.plugins : [])],
    ...(extension ? { base: extensionBuild.base, build: extensionBuild.build } : {}),
    server: {
      host: "127.0.0.1",
      // Fixed port: the API server's Host-header guard allow-lists it, since
      // this proxy forwards the browser's Host unchanged (no changeOrigin).
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": "http://127.0.0.1:3001",
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/setupTests.ts"],
    },
  };
});
