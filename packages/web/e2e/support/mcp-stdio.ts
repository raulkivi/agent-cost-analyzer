// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Phase 15 step 15.13 (plan §10.1.6, §12.4.2 S10): the standalone stdio MCP
// server (packages/server/src/mcp/stdio.ts, what scripts/mcp-server.sh
// runs), started as a client starts it, over a scenario's fixture home: the
// same HOME as the app fixture's server, so both read the same logs,
// projects file and price book. Nothing on this machine is read.

const webDir = path.resolve(import.meta.dirname, "../..");
const tsx = path.resolve(webDir, "../../node_modules/.bin/tsx");
const stdioEntry = path.resolve(webDir, "../server/src/mcp/stdio.ts");

// Variables that would point a provider or the app's settings outside the fixture home.
const OUTSIDE_HOME = ["XDG_CONFIG_HOME", "APPDATA", "COPILOT_HOME", "CLAUDE_CONFIG_DIR", "PI_CODING_AGENT_DIR"];

// `args`: the entry point's own flags, such as --app-views-html for the MCP
// Apps suite (packages/mcp-apps/e2e), which reads the views resource too.
export async function connectStdioMcp(home: string, options: { args?: string[]; clientName?: string } = {}): Promise<Client> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined && !OUTSIDE_HOME.includes(name)) env[name] = value;
  Object.assign(env, { HOME: home, USERPROFILE: home });
  const client = new Client({ name: options.clientName ?? "usage-scenario", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: tsx, args: [stdioEntry, ...(options.args ?? [])], env, cwd: webDir, stderr: "ignore" }));
  return client;
}

export function structured<T>(result: Awaited<ReturnType<Client["callTool"]>>): T {
  if (result.isError) throw new Error(`MCP tool error: ${JSON.stringify(result.content)}`);
  return result.structuredContent as T;
}
