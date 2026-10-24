# Changelog

All notable changes to AI Credits Analyzer, the VS Code extension, are
documented in this file. The standalone app, Agent Cost Analyzer, has its
own changelog at the repository root.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0]

The first release.

### Added

- **Analyzer panel** for your GitHub Copilot Chat sessions, read from the
  logs on your machine: a per-turn table of uncached input, cache read and
  write, tool, vision, reasoning and output tokens, AI Credits and a
  running total; a plain-language explanation of each turn; the system
  prompt broken into its parts, which can also be opened as a read-only
  editor tab; the tools loaded and used; and a request/response inspector
  per turn. Unknown figures are shown as unknown, never as 0.
- **Learn mode** with 18 sample sessions on prompt caching, compaction,
  model switches and other events that change what a turn costs.
- **Tool audit** for a session and across sessions: outcomes, why calls
  failed and retried commands.
- **Insights dashboard** over your Copilot Chat sessions: spend by day and
  model, cache hit ratio, tool-call failures, and signals to review
  (risky commands, anomalies and behaviour changes).
- **AI-advice export**: a metadata-only bundle (never chat message text)
  to paste into a chat for advice.
- **Sessions** and **Setup** views in an Activity Bar side bar. Sessions
  are grouped by day with their AI Credits totals; Setup lists Copilot
  Chat logging settings that need changing, with Fix buttons that open
  them.
- **Status bar** item with today's AI Credits and how many of today's
  sessions have cost data.
- **Get Started walkthrough** in five steps, opened once on first run.
- **MCP server** for Copilot Chat agent mode with nine read-only tools,
  off until you turn on `aiCreditsAnalyzer.mcp.enabled`. An untrusted
  workspace's settings can't turn it on.
- Follows the VS Code color theme, including high contrast; works by
  keyboard; "View as table" for every chart; layouts for narrow panels;
  respects reduced motion.
- In Remote-SSH, WSL and Dev Container windows, installs on the remote
  side, where Copilot Chat writes its logs.
- No network requests and no telemetry.
