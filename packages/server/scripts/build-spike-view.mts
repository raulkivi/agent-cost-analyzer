// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Phase 12 task A0 (docs/plans/mcp-apps-spike.md): bundles the spike view's
// script with the ext-apps client and inlines it into the HTML template, so
// the result is one self-contained file with no external resources.
//   npm run spike:build --workspace=packages/server
// Output: packages/server/src/mcp/apps/spike/dist/spike-view.html (git-ignored).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const spikeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/mcp/apps/spike");
const marker = "<!--SPIKE_SCRIPT-->";

const result = await build({
  entryPoints: [path.join(spikeDir, "spike-main.ts")],
  bundle: true,
  write: false,
  format: "esm",
  target: "es2022",
  platform: "browser",
  minify: true,
  // ASCII only, so no raw non-ASCII or "</script" can end the inline script early.
  charset: "ascii",
  legalComments: "none",
});

const script = result.outputFiles[0]!.text.replaceAll("</script", "<\\/script").replaceAll("<!--", "<\\!--");
const template = readFileSync(path.join(spikeDir, "spike-view.template.html"), "utf8");
if (template.split(marker).length !== 2) throw new Error(`The template must contain ${marker} exactly once`);
const html = template.replace(marker, () => `<script type="module">${script}</script>`);

mkdirSync(path.join(spikeDir, "dist"), { recursive: true });
const out = path.join(spikeDir, "dist", "spike-view.html");
writeFileSync(out, html);
console.log(`${out} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
