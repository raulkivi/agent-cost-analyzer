#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Raul Kivi
# SPDX-License-Identifier: MIT
# Launches the read-only tool-call audit MCP server over stdio, for
# `claude mcp add agent-cost-analyzer -- /abs/path/to/scripts/mcp-server.sh`
# (or any MCP-capable harness). Run `npm install` in the repo first.
# stdout is reserved for JSON-RPC; the server logs to stderr only.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Phase 12: serve the branded interactive views (MCP Apps) when `npm run build`
# produced them; without the file the server starts as before, without views.
# A caller's own --app-views-html comes later in the arguments and wins.
VIEWS="$ROOT/packages/mcp-apps/dist/views.html"
VIEW_ARGS=()
if [ -f "$VIEWS" ]; then
  VIEW_ARGS=(--app-views-html "$VIEWS")
fi
exec "$ROOT/node_modules/.bin/tsx" "$ROOT/packages/server/src/mcp/stdio.ts" ${VIEW_ARGS[@]+"${VIEW_ARGS[@]}"} "$@"
