# AI Credits Analyzer

See where your GitHub Copilot Chat tokens and AI Credits go. AI Credits
Analyzer reads the logs Copilot Chat writes on your machine and shows each
session turn by turn: what each turn cost, how much prompt caching saved,
which tool calls failed and why, and what changed over time. Learn mode
explains caching and AI Credits with sample sessions, so it's useful before
you have any data of your own.

Independent project; not affiliated with or endorsed by GitHub or
Microsoft.

<!-- screenshot: panel-dark.png -->

## Features

- **Analyzer panel.** Each session's turns in a table: uncached input,
  cache read and write, tool, vision, reasoning and output tokens, AI
  Credits per turn and a running total. A plain-language explanation of
  each turn, the system prompt broken into its parts, the tools that were
  loaded and used, and a request/response inspector per turn.
- **Sessions, Learn and Setup side bar.** Your Copilot Chat sessions
  grouped by day with their AI Credits totals, and the Learn scenarios
  grouped by topic; pick one to open it in the panel. Setup lists any
  Copilot Chat logging setting that needs changing, with a Fix button that
  opens it.
- **Status bar.** Today's AI Credits, with how many of today's sessions
  have cost data.
- **Insights dashboard.** Spend by day and model, cache hit ratio, tool
  calls and failures, and signals to review: risky commands, unusual
  sessions and first-time use of a tool or model.
- **Tool audit.** Every tool call in a session, why failed calls failed,
  and retried commands, plus a roll-up across sessions.
- **Learn mode.** 18 sample sessions, in the Learn view, that show how
  prompt caching, context compaction, model switches and other events
  change what a turn costs.
- **MCP server for Copilot agent mode** (off by default). Ask Copilot Chat
  "what did my last session cost?" and it answers from the same local logs
  through nine read-only tools.

An unknown figure is shown as unknown, never as 0.

<!-- screenshot: dashboard.png -->

## Getting started

1. Install **AI Credits Analyzer** from the Extensions view.
2. The **Get Started** walkthrough opens once. It walks you through the
   steps below. Reopen it any time with **AI Credits Analyzer: Open Get
   Started Walkthrough**.
3. Turn on Copilot Chat's debug file logging. Copilot Chat records token
   and AI Credits data only while it's on, and it's off by default. Open
   the **Setup** view in the AI Credits Analyzer side bar and select
   **Fix** on the debug-logging row. It opens
   `github.copilot.chat.agentDebugLog.fileLogging.enabled` in Settings;
   turn it on. Also set
   `github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs`
   to 200 or more, so older logs aren't deleted. Reload the window.
4. Chat with Copilot as usual, then select **Refresh** in the **Sessions**
   view and pick a session.

Logging isn't retroactive: sessions from before you turned it on show
their figures as unknown.

<!-- screenshot: walkthrough.png -->

<!-- screenshot: sidebar.png -->

## Commands

All commands are in the **AI Credits Analyzer** category.

| Command | What it does |
|---|---|
| Open | Opens the analyzer panel |
| Refresh | Reloads the Sessions and Setup views and the status bar |
| Open Learn Mode | Opens the panel in Learn mode |
| Open Get Started Walkthrough | Opens the walkthrough |
| Open Session, Show Tool Audit, Copy Advice Bundle | On a session in the Sessions view |
| Open Scenario | On a scenario in the Learn view |
| Fix Setting | On a row in the Setup view: opens that setting |

## Settings

| Setting | Default | What it does |
|---|---|---|
| `aiCreditsAnalyzer.mcp.enabled` | `false` | Offers Copilot Chat agent mode a read-only MCP server over your Copilot Chat sessions |

## Privacy

- AI Credits Analyzer reads only Copilot Chat's log files on your machine
  (or on the remote host, in a remote window).
- It makes no network requests and sends no telemetry.
- It never writes, moves or deletes your logs or Copilot Chat's settings.
  Fix buttons only open a setting; you make the change.
- The MCP server is off until you turn on `aiCreditsAnalyzer.mcp.enabled`.
  When it's on, what its tools return goes to whichever model you chat
  with: costs, tool calls and their outcomes, findings with excerpts, and
  your prompts and the model's responses. Secrets in that text are
  redacted and the text is truncated first. The server is read-only and
  doesn't reach the network. In Restricted Mode, an untrusted workspace's
  settings can't turn it on.

[What the extension reads, file by file](https://github.com/raulkivi/agent-cost-analyzer/blob/main/docs/vscode-extension-guide.md#privacy-and-what-the-extension-reads).

## Requirements

- The current stable release of VS Code. Each release of the extension
  requires the VS Code version that was stable when it was published.
- GitHub Copilot Chat, with debug file logging turned on (see above).

## Documentation

- [Extension guide](https://github.com/raulkivi/agent-cost-analyzer/blob/main/docs/vscode-extension-guide.md):
  installing, every command and setting, the MCP server, remote windows,
  accessibility and troubleshooting.
- [User Guide](https://github.com/raulkivi/agent-cost-analyzer/blob/main/docs/UserGuide.md):
  the analysis views in detail.
- [Changelog](https://github.com/raulkivi/agent-cost-analyzer/blob/main/packages/vscode-extension/CHANGELOG.md)
- [Report an issue](https://github.com/raulkivi/agent-cost-analyzer/issues)

## Using Claude Code, pi or mitmproxy?

This extension reads GitHub Copilot Chat's logs only. For Claude Code CLI
sessions, pi coding agent sessions or mitmproxy captures of LLM API
traffic, use
[Agent Cost Analyzer](https://github.com/raulkivi/agent-cost-analyzer#readme),
the standalone app from the same repository. It has the same views and
reads VS Code Copilot Chat sessions too.

## License

[MIT](https://github.com/raulkivi/agent-cost-analyzer/blob/main/LICENSE)
