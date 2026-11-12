// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// The standalone stdio MCP server, started as a client starts it, over a
// fixture home. Kept here (not shared with packages/web's mcp-stdio.ts) so
// this package's fake host talks through the v2 client while web stays on
// SDK 1.x until M3; the process boundary makes the mix safe.

const serverDir = path.resolve(import.meta.dirname, "../../../server");
const webDir = path.resolve(import.meta.dirname, "../../../web");
const tsx = path.resolve(webDir, "../../node_modules/.bin/tsx");
const stdioEntry = path.resolve(serverDir, "src/mcp/stdio.ts");

// Variables that would point a provider or the app's settings outside the fixture home.
const OUTSIDE_HOME = ["XDG_CONFIG_HOME", "APPDATA", "COPILOT_HOME", "CLAUDE_CONFIG_DIR", "PI_CODING_AGENT_DIR"];

export async function connectStdioMcp(home: string, options: { args?: string[]; clientName?: string } = {}): Promise<Client> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined && !OUTSIDE_HOME.includes(name)) env[name] = value;
  Object.assign(env, { HOME: home, USERPROFILE: home });
  const client = new Client({ name: options.clientName ?? "fake-mcp-apps-host", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: tsx, args: [stdioEntry, ...(options.args ?? [])], env, cwd: webDir, stderr: "ignore" }));
  return client;
}
