// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { parseArgs } from "node:util";
import {
  MCP_CLIENT_IDS,
  supportedScopes,
  type McpClientId,
  type McpScope,
} from "../../../server/src/mcp/client-setup/client-setup.js";

export type ClientSelection =
  { kind: "detected" } | { kind: "all" } | { kind: "ids"; ids: readonly McpClientId[] };

export interface ConfigCommand {
  kind: "mcp-config";
  client: McpClientId;
  scope: McpScope;
  pin: boolean;
  projectBillingDetails: boolean;
}
export interface InstallCommand {
  kind: "mcp-install";
  clients: ClientSelection;
  scope: McpScope;
  pin: boolean;
  projectBillingDetails: boolean;
  dryRun: boolean;
  yes: boolean;
}
export interface UninstallCommand {
  kind: "mcp-uninstall";
  clients: ClientSelection;
  scope: McpScope;
  dryRun: boolean;
  yes: boolean;
}
export interface StatusCommand {
  kind: "mcp-status";
  scope: McpScope;
}
export type SetupCommand =
  ConfigCommand | InstallCommand | UninstallCommand | StatusCommand;
export type SetupParse = SetupCommand | { kind: "error"; message: string };

export const SETUP_SUBCOMMANDS = [
  "config",
  "install",
  "uninstall",
  "status",
] as const;
export type SetupSubcommand = (typeof SETUP_SUBCOMMANDS)[number];

export const isSetupSubcommand = (
  word: string | undefined,
): word is SetupSubcommand => SETUP_SUBCOMMANDS.some((name) => name === word);

const SCOPES: readonly McpScope[] = ["user", "project", "local"];
const CLIENT = { client: { type: "string" } } as const;
const SCOPE = { scope: { type: "string" } } as const;
const LAUNCH = {
  pin: { type: "boolean" },
  "project-billing-details": { type: "boolean" },
} as const;
const APPLY = {
  "dry-run": { type: "boolean" },
  yes: { type: "boolean" },
} as const;

const OPTIONS = {
  config: { ...CLIENT, ...SCOPE, ...LAUNCH },
  install: { ...CLIENT, ...SCOPE, ...LAUNCH, ...APPLY },
  uninstall: { ...CLIENT, ...SCOPE, ...APPLY },
  status: { ...SCOPE },
} as const;

type Values = Record<string, string | boolean | undefined>;

const fail = (message: string) => ({ kind: "error" as const, message });

function parseScope(text: string | undefined): McpScope | { error: string } {
  if (text === undefined) return "user";
  const scope = SCOPES.find((s) => s === text);
  return (
    scope ?? {
      error: `--scope needs one of ${SCOPES.join(", ")}, got "${text}"`,
    }
  );
}

function parseClientIds(text: string): McpClientId[] | { error: string } {
  const ids: McpClientId[] = [];
  for (const word of text.split(",")) {
    const id = MCP_CLIENT_IDS.find((candidate) => candidate === word);
    if (!id)
      return {
        error: `Unknown client "${word}"; use ${MCP_CLIENT_IDS.join(", ")} or all`,
      };
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function parseSelection(
  text: string | undefined,
  scope: McpScope,
): ClientSelection | { error: string } {
  if (text === undefined) return { kind: "detected" };
  if (text === "all") return { kind: "all" };
  const ids = parseClientIds(text);
  if ("error" in ids) return ids;
  const unsupported = ids.find((id) => !supportedScopes(id).includes(scope));
  if (unsupported)
    return { error: `${unsupported} does not support scope "${scope}"` };
  return { kind: "ids", ids };
}

function parseValues(
  sub: SetupSubcommand,
  argv: readonly string[],
): Values | { error: string } {
  try {
    return parseArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: OPTIONS[sub],
    }).values as Values;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const flag = (values: Values, name: string) => values[name] === true;
const text = (values: Values, name: string) =>
  typeof values[name] === "string" ? values[name] : undefined;

function buildConfig(values: Values, scope: McpScope): SetupParse {
  const client = text(values, "client");
  if (client === undefined) return fail("mcp config needs --client <id>");
  const ids = parseClientIds(client);
  if ("error" in ids) return fail(ids.error);
  const [only] = ids;
  if (ids.length !== 1 || !only)
    return fail("mcp config takes exactly one --client");
  if (!supportedScopes(only).includes(scope))
    return fail(`${only} does not support scope "${scope}"`);
  return {
    kind: "mcp-config",
    client: only,
    scope,
    pin: flag(values, "pin"),
    projectBillingDetails: flag(values, "project-billing-details"),
  };
}

function buildChange(
  sub: "install" | "uninstall",
  values: Values,
  scope: McpScope,
): SetupParse {
  const clients = parseSelection(text(values, "client"), scope);
  if ("error" in clients) return fail(clients.error);
  const dryRun = flag(values, "dry-run");
  const yes = flag(values, "yes");
  if (dryRun && yes) return fail("--yes and --dry-run cannot be combined");
  if (sub === "uninstall")
    return { kind: "mcp-uninstall", clients, scope, dryRun, yes };
  return {
    kind: "mcp-install",
    clients,
    scope,
    pin: flag(values, "pin"),
    projectBillingDetails: flag(values, "project-billing-details"),
    dryRun,
    yes,
  };
}

/** Parses what follows `mcp <sub>`; every unknown flag is an error. */
export function parseSetupArgs(
  sub: SetupSubcommand,
  argv: readonly string[],
): SetupParse {
  const values = parseValues(sub, argv);
  if ("error" in values) return fail(String(values.error));
  const scope = parseScope(text(values, "scope"));
  if (typeof scope === "object") return fail(scope.error);
  switch (sub) {
    case "config":
      return buildConfig(values, scope);
    case "status":
      return { kind: "mcp-status", scope };
    default:
      return buildChange(sub, values, scope);
  }
}
