// One chunk of Vite's build manifest (media/manifest.json, written by
// `vite build --mode extension`); only the fields the panel reads.
export interface ViteManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  css?: string[];
  imports?: string[];
}

export type ViteManifest = Record<string, ViteManifestChunk>;

export interface PanelHtmlInput {
  manifest: ViteManifest;
  nonce: string;
  // webview.cspSource: the origin the webview serves local resources from.
  cspSource: string;
  // Maps a path relative to media/ to its webview URI (asWebviewUri).
  assetUri(relativePath: string): string;
}

const ENTRY = "index.html";
const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// The plan's webview CSP (vscode-extension.md §5). connect-src 'none' makes
// "no network from the UI" (constraint 1) enforced rather than a convention.
function contentSecurityPolicy(nonce: string, cspSource: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
    "connect-src 'none'",
  ].join("; ");
}

// The entry's stylesheets plus those of every chunk it imports, in order,
// each once.
function collectCss(manifest: ViteManifest, key: string, seen = new Set<string>()): string[] {
  if (seen.has(key)) return [];
  seen.add(key);
  const chunk = manifest[key];
  if (!chunk) return [];
  return [...(chunk.imports ?? []).flatMap((imported) => collectCss(manifest, imported, seen)), ...(chunk.css ?? [])];
}

// The webview's HTML, built from the Vite manifest rather than Vite's own
// index.html: every asset goes through the webview URI mapper (no absolute
// /assets URLs), and every script carries this render's nonce.
export function buildPanelHtml({ manifest, nonce, cspSource, assetUri }: PanelHtmlInput): string {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error("The CSP nonce must be a non-empty base64 string.");
  }
  const entry = manifest[ENTRY];
  if (!entry) {
    throw new Error(`The webview build manifest has no "${ENTRY}" entry; run the extension build.`);
  }
  const stylesheets = [...new Set(collectCss(manifest, ENTRY))]
    .map((file) => `    <link rel="stylesheet" href="${escapeAttribute(assetUri(file))}">`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(contentSecurityPolicy(nonce, cspSource))}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Credits Analyzer</title>
${stylesheets}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${escapeAttribute(assetUri(entry.file))}"></script>
  </body>
</html>
`;
}
