// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

import { MCP_SERVER_NAME, buildLaunchSpec, type McpLaunchSpec } from "./launch-spec.js";
import { mcpServerToml } from "./toml.js";

export type McpClientId =
  | "claude-code"
  | "claude-desktop"
  | "cursor"
  | "vscode"
  | "vscode-insiders"
  | "codex"
  | "gemini";

export const MCP_CLIENT_IDS: readonly McpClientId[] = [
  "claude-code",
  "claude-desktop",
  "cursor",
  "vscode",
  "vscode-insiders",
  "codex",
  "gemini",
];

export type McpScope = "user" | "project" | "local";

const SCOPES: Record<McpClientId, readonly McpScope[]> = {
  "claude-code": ["user", "project", "local"],
  "claude-desktop": ["user"],
  cursor: ["user", "project"],
  vscode: ["user"],
  "vscode-insiders": ["user"],
  codex: ["user"],
  gemini: ["user", "project"],
};

export function supportedScopes(client: McpClientId): readonly McpScope[] {
  return SCOPES[client];
}

export interface JsonEntryPlan {
  readonly keyPath: readonly string[];
  readonly name: string;
  readonly entry: Readonly<Record<string, unknown>>;
}

/** What to run, merge or print to register the server with one client. */
export interface ClientSetup {
  readonly client: McpClientId;
  readonly scope: McpScope;
  readonly launch: McpLaunchSpec;
  /** argv for execFile, never a shell. */
  readonly command?: readonly string[];
  readonly remove?: readonly string[];
  readonly json?: JsonEntryPlan;
  readonly toml?: string;
  readonly installLink?: string;
}

export interface ClientSetupOptions {
  readonly version: string;
  readonly pin: boolean;
  readonly projectBillingDetails: boolean;
  readonly platform: NodeJS.Platform;
  readonly scope: McpScope;
}

const NAME = MCP_SERVER_NAME;

type Builder = (launch: McpLaunchSpec, scope: McpScope) => Omit<ClientSetup, "client" | "scope" | "launch">;

const argv = (l: McpLaunchSpec) => [l.command, ...l.args];
const plainEntry = (l: McpLaunchSpec) => ({ command: l.command, args: l.args });

// Stable and Insiders differ only in the CLI that `mcp config` prints.
const vscodeFamily = (cli: string, l: McpLaunchSpec) => ({
  command: [
    cli,
    "--add-mcp",
    JSON.stringify({ name: NAME, type: "stdio", ...plainEntry(l) }),
  ],
  json: { keyPath: ["servers"], name: NAME, entry: { type: "stdio", ...plainEntry(l) } },
});

const BUILDERS: Record<McpClientId, Builder> = {
  "claude-code": (l, scope) => ({
    command: ["claude", "mcp", "add", "--scope", scope, NAME, "--", ...argv(l)],
    remove: ["claude", "mcp", "remove", "--scope", scope, NAME],
    // Only project scope lives in a file the user can read and commit.
    ...(scope === "project" && {
      json: {
        keyPath: ["mcpServers"],
        name: NAME,
        entry: { type: "stdio", ...plainEntry(l), env: {} },
      },
    }),
  }),
  "claude-desktop": (l) => ({
    json: { keyPath: ["mcpServers"], name: NAME, entry: plainEntry(l) },
  }),
  cursor: (l) => ({
    json: { keyPath: ["mcpServers"], name: NAME, entry: plainEntry(l) },
    installLink:
      `cursor://anysphere.cursor-deeplink/mcp/install?name=${NAME}&config=` +
      encodeURIComponent(Buffer.from(JSON.stringify(plainEntry(l))).toString("base64")),
  }),
  vscode: (l) => vscodeFamily("code", l),
  "vscode-insiders": (l) => vscodeFamily("code-insiders", l),
  codex: (l) => ({
    command: ["codex", "mcp", "add", NAME, "--", ...argv(l)],
    toml: mcpServerToml(NAME, l),
  }),
  gemini: (l, scope) => ({
    command: ["gemini", "mcp", "add", "-s", scope, NAME, ...argv(l)],
    remove: ["gemini", "mcp", "remove", "-s", scope, NAME],
  }),
};

export function clientSetup(client: McpClientId, o: ClientSetupOptions): ClientSetup {
  if (!SCOPES[client].includes(o.scope)) {
    throw new Error(`${client} does not support scope "${o.scope}"`);
  }
  const launch = buildLaunchSpec({
    version: o.version,
    pin: o.pin,
    projectBillingDetails: o.projectBillingDetails,
    platform: o.platform,
    windowsCmdWrap: client === "claude-code",
  });
  return { client, scope: o.scope, launch, ...BUILDERS[client](launch, o.scope) };
}
