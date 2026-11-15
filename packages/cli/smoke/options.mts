// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The command line of scripts/npm-package-smoke.mts.
import path from "node:path";
import { parseArgs } from "node:util";

export type SmokeArgs =
  | { kind: "run"; tarball: string | undefined; aliasTarball: string | undefined; outDir: string; keepTemp: boolean }
  | { kind: "help"; text: string }
  | { kind: "error"; message: string };

const USAGE = [
  "Usage: npm run smoke:npm-package -- [--tarball <path>] [--alias-tarball <path>] [--out <dir>] [--keep-temp]",
  "",
  "  --tarball <path>  Check this packed tarball; without it, npm run build and npm pack first",
  "  --alias-tarball <path>  Check this packed agent-cost-analyser tarball; without it, pack the alias workspace", // codespell:ignore analyser
  "  --out <dir>       Logs and Playwright output (default packages/cli/smoke/out)",
  "  --keep-temp       Keep the temporary home, project and npm cache",
  "",
].join("\n");

export function parseSmokeArgs(argv: readonly string[], cwd: string): SmokeArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        tarball: { type: "string" },
        "alias-tarball": { type: "string" },
        out: { type: "string" },
        "keep-temp": { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
  if (values.help) return { kind: "help", text: USAGE };
  if (values.tarball !== undefined && !values.tarball.endsWith(".tgz")) return { kind: "error", message: `--tarball must name a .tgz file: ${values.tarball}` };
  const alias = values["alias-tarball"];
  if (alias !== undefined && !alias.endsWith(".tgz")) return { kind: "error", message: `--alias-tarball must name a .tgz file: ${alias}` };
  return {
    kind: "run",
    tarball: values.tarball === undefined ? undefined : path.resolve(cwd, values.tarball),
    aliasTarball: alias === undefined ? undefined : path.resolve(cwd, alias),
    outDir: path.resolve(cwd, values.out ?? path.join("packages", "cli", "smoke", "out")),
    keepTemp: values["keep-temp"],
  };
}
