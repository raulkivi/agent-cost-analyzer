// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { serveStandaloneMcpStdio } from "./standalone-mcp-server.js";
import { parseStdioArgs } from "./stdio-args.js";

// stdio entry point for `claude mcp add` (see https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/tool-call-audit.md
// §10 and scripts/mcp-server.sh), over this package's own data: no package
// layout. stdout carries JSON-RPC only — anything diagnostic must go to
// stderr. The extension's Copilot-only entry point
// (packages/vscode-extension/src/mcp/stdio.ts) wires the same services
// over its own composition root.
serveStandaloneMcpStdio(parseStdioArgs(process.argv.slice(2)));
