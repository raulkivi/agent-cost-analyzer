# Agent Cost Analyzer Claude Code plugin

**Last changed:** 2026-11-19 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

This plugin registers the Agent Cost Analyzer MCP server with Claude Code. The
server reads your local coding-agent logs and answers questions about cost,
tool-call failures and allowance. It is read-only.

## Install

In Claude Code, run:

```text
/plugin marketplace add raulkivi/agent-cost-analyzer
/plugin install agent-cost-analyzer@agent-cost-analyzer
```

Restart the session, or run `/reload-plugins`, so the server starts.

## What it registers

The plugin's `.mcp.json` adds one stdio server, `agent-cost-analyzer`:

```json
{
  "mcpServers": {
    "agent-cost-analyzer": {
      "command": "npx",
      "args": ["-y", "--prefer-offline", "agent-cost-analyzer", "mcp"]
    }
  }
}
```

Each start runs the latest `agent-cost-analyzer` release from npm through
`npx`. `--prefer-offline` reuses the npm cache when it holds that release.

## Requirements

- Node.js 22.18 or later, on the `PATH` that Claude Code uses.
- An npm registry reachable at first start, or a cached release.

## Scope

The plugin only registers the server. The analysis runs in the server, on
your machine. For the app's features, see the
[User Guide](https://github.com/raulkivi/agent-cost-analyzer/blob/main/docs/UserGuide.md).
