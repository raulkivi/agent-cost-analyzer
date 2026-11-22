// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { parseArgs } from "node:util";
// One source of truth for the mcp flags; esbuild follows the relative import
// into the bundle (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.3).
import { parseStdioArgs } from "../../server/src/mcp/stdio-args.js";
import { isSetupSubcommand, parseSetupArgs, type SetupCommand } from "./mcp-setup/setup-args.js";

export type { SetupCommand } from "./mcp-setup/setup-args.js";

export interface ServeCommand {
  kind: "serve";
  /** Absent: the default port with fallbacks. 0: any free port. */
  port?: number;
  open: boolean;
}
export interface McpCommand {
  kind: "mcp";
  projectBillingDetails: boolean;
  appViewsHtml?: string;
}
export type CliCommand = ServeCommand | McpCommand | SetupCommand | { kind: "help" } | { kind: "version" } | { kind: "error"; message: string };

const BILLING_FLAG = "--project-billing-details";
const VIEWS_FLAG = "--app-views-html";

// Only the views path takes an inline `=value`; parseStdioArgs reads the
// billing switch bare, so `--project-billing-details=true` would be dropped.
const isMcpArg = (arg: string): boolean => arg === BILLING_FLAG || arg === VIEWS_FLAG || arg.startsWith(`${VIEWS_FLAG}=`);

function parseMcp(argv: readonly string[]): CliCommand {
  // parseStdioArgs ignores unknown input, so reject it here first.
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!isMcpArg(arg)) return { kind: "error", message: `Unknown argument for mcp: ${arg}` };
    if (arg === VIEWS_FLAG) i++; // its value, validated by parseStdioArgs
  }
  try {
    return { kind: "mcp", ...parseStdioArgs(argv) };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

function parsePort(text: string): number | undefined {
  if (!/^\d{1,5}$/.test(text)) return undefined;
  const port = Number(text);
  return port <= 65535 ? port : undefined;
}

export function parseCliArgs(argv: readonly string[]): CliCommand {
  if (argv[0] === "mcp") {
    const sub = argv[1];
    // Only the four subcommand words leave the server parsing, which stays strict.
    return isSetupSubcommand(sub) ? parseSetupArgs(sub, argv.slice(2)) : parseMcp(argv.slice(1));
  }
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: {
        port: { type: "string" },
        "no-open": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    }));
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };
  const open = !values["no-open"];
  if (values.port === undefined) return { kind: "serve", open };
  const port = parsePort(values.port);
  if (port === undefined) return { kind: "error", message: `--port needs an integer from 0 to 65535, got "${values.port}"` };
  return { kind: "serve", port, open };
}
