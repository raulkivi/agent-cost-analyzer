import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { composeLogProviders } from "../composition/compose-log-providers.js";
import { createMcpServices } from "../composition/mcp-services.js";
import { readAppVersion } from "../composition/app-version.js";
import { createMcpServer } from "./mcp-server.js";

// stdio entry point for `claude mcp add` (see docs/plans/tool-call-audit.md
// §10 and scripts/mcp-server.sh). stdout carries JSON-RPC only — anything
// diagnostic must go to stderr. The extension's Copilot-only entry point
// (packages/vscode-extension/src/mcp/stdio.ts) wires the same services
// over its own composition root.
const version = readAppVersion();

const { registry } = composeLogProviders();
const server = createMcpServer(createMcpServices(registry, version));

await server.connect(new StdioServerTransport());
console.error(`copilot-cost-analyzer MCP server ${version} ready on stdio (read-only, local logs only).`);
