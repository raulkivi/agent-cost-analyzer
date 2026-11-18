// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The command line of scripts/mcp-setup-smoke.mts (MC7).
import path from "node:path";
import { parseArgs } from "node:util";

export type SetupSmokeArgs =
  | { kind: "run"; tarball: string | undefined; outDir: string; keepTemp: boolean }
  | { kind: "help"; text: string }
  | { kind: "error"; message: string };

const USAGE = [
  "Usage: npm run smoke:mcp-setup -- [--tarball <path>] [--out <dir>] [--keep-temp]",
  "",
  "  --tarball <path>  Check this packed tarball; without it, npm run build and npm pack first",
  "  --out <dir>       Logs (default packages/cli/smoke/out/mcp-setup)",
  "  --keep-temp       Keep the temporary home, project, stubs and npm cache",
  "",
].join("\n");

export function parseSetupSmokeArgs(argv: readonly string[], cwd: string): SetupSmokeArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        tarball: { type: "string" },
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
  return {
    kind: "run",
    tarball: values.tarball === undefined ? undefined : path.resolve(cwd, values.tarball),
    outDir: path.resolve(cwd, values.out ?? path.join("packages", "cli", "smoke", "out", "mcp-setup")),
    keepTemp: values["keep-temp"],
  };
}
