import { statSync } from "node:fs";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readAppVersion } from "@copilot-cost-analyzer/server/src/composition/app-version";
import { createCopilotMcpServer } from "./copilot-mcp-server.js";
import { parseMcpServerArgs } from "./mcp-server-args.js";

// Entry point of the extension's MCP child process (dist/mcp-stdio.js,
// vscode-extension.md D7, step 10.8). VS Code starts it from the
// extension's McpStdioServerDefinition with its own Electron as Node, and
// the host passes the user-data dir it derived from globalStorageUri (D4).
// stdout carries JSON-RPC only: every diagnostic goes to stderr, and a bad
// command line exits with 2 before anything is read.
const PREFIX = "AI Credits Analyzer MCP server:";

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseMcpServerArgs(process.argv.slice(2), { isDirectory });
  if (!args.ok) {
    process.stderr.write(`${PREFIX} ${args.error}\n`);
    process.exitCode = 2;
    return;
  }
  // The bundle is <extension>/dist/mcp-stdio.js, next to the extension's
  // own package.json (G4: no import.meta.url in a CJS bundle).
  const version = readAppVersion(path.join(__dirname, "..", "package.json"));
  const server = createCopilotMcpServer({ userDataDir: args.userDataDir, version });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`${PREFIX} ${version} ready on stdio (read-only, Copilot Chat logs only).\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${PREFIX} failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
