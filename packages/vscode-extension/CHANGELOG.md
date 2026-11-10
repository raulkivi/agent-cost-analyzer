# Changelog

All notable changes to AI Credits Analyzer, the VS Code extension, are
documented in this file. The standalone app, Agent Cost Analyzer, has its
own changelog at the repository root.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Open Session… in the Command Palette.** **AI Credits Analyzer: Open
  Session…** now shows a picker of your sessions (newest first; title, start
  time, provider, AI Credits, and the id, all searchable) and opens the one
  you choose. The Sessions view's Open is unchanged. The cost view's copy
  button copies the session title to paste into this picker.
- **MCP server: interactive cost views.** In VS Code Copilot Chat, the MCP
  tools `get_session_cost`, `get_cost_rollup` and `list_findings` now show a
  branded, interactive view next to the text result (per-turn chart, top
  turns, spend by day, model and provider with a drill-down into a session,
  filterable findings). A session's view has a **Copy title to open in
  panel** button, because VS Code doesn't let a chat view open a link; run
  **AI Credits Analyzer: Open Session…** and paste the title. The views ship in the extension
  (`dist/mcp-apps/views.html`; without that file the server runs without
  them) and add one app-only tool, `get_turn_series`, to the server's 19. The
  tools keep their names, schemas and text, so Claude Code's output is
  unchanged.
- **Cost by repository.** The Sessions view can be grouped by repository
  (the new toggle in its title bar), each group with its AI Credits. The
  status bar shows today's AI Credits for the open folder's repository,
  with every repository's total in its tooltip. The panel's Dashboard
  gains the *Cost over time* and *Compare* tabs; billing and estimates stay
  in the standalone Agent Cost Analyzer app.
- **MCP server: cost by repository.** The server now has 17 read-only tools,
  up from nine. The new ones list the repositories your Copilot sessions
  ran in, give a repository's cost over time, compare repositories, explain
  why a cost changed (usage, price or model mix), and read the bundled price
  book and its price changes. There are no projects in the extension:
  `list_projects` says they are edited in the standalone app.
- **Replay a session on another model.** In Analyze, **Replay on** shows
  what a Copilot session would have cost about on another model, beside
  what it did cost: Simulated columns in the turns table, a summary with
  coverage, a self-check on the session's own model and the assumptions,
  and **Compare models** for up to 10 models. Priced at GitHub Copilot's
  prices by default, with a switch to the vendor's API prices. Nothing is
  stored.
- **MCP server: replay.** Two more read-only tools, `replay_session` and
  `compare_models_for_session`, for 19 in all.
- **MCP server: active sessions.** `get_session_cost` and `get_cost_rollup`
  mark a session as `active` when its latest turn started in the last 15
  minutes, with `lastTurnAt`, and add a sentence saying its figures may
  still change. A running chat's log is not complete yet (the latest turn
  is undercounted), so its figures are no longer presented as final.

### Fixed

- A turn's explanation now names cache-write tokens as well as new input and
  cache reads, and reads "1 token" / "18 tokens" instead of "token(s)".

## [0.2.1] - 2026-11-06

### Changed

- Maintenance release. The simulator was checked against real Claude Code and
  Copilot Chat session logs (no mismatch in Copilot's 39 requests), and a
  flaky internal test was fixed. Nothing changes in what the extension shows.

## [0.2.0] - 2026-11-06

### Changed

- **Requires VS Code 1.145 or later** (was 1.144).

### Added

- **Vendor-aware Learn.** Learn scenarios are now simulated on a vendor and
  model you pick (Anthropic, OpenAI, Google or xAI), using that vendor's
  documented caching rules and real prices instead of illustrative numbers.
  The turns table gains a Cache column (hit, partial, miss, unknown), each turn
  has a generated note, AI Credits show their USD equivalent on hover, and an
  assumptions popover and a sources footer say what the numbers rest on. The
  Learn view lists the 17 scenarios that apply to Copilot (the Claude-only
  1-hour cache scenario is hidden), and the `/clear` and `/rewind` scenarios use
  VS Code wording. The Learn numbers differ from earlier versions: cache
  misses are no longer billed twice, and 1-hour cache writes and images follow
  Anthropic's documented rules.
- **Agent Host sessions.** Chats from VS Code's default Copilot harness
  (VS Code 1.143 and later) are listed in the Sessions view with their turns,
  tokens and AI Credits.
- **Agent Host turn text and tool calls.** Prompt and response text, the turn
  inspector, tool calls with outcomes and the system prompt for these chats
  come from the Copilot CLI's event log, read locally. A session whose log is
  missing or unreadable shows these as not available, with the reason. The Tools tab stays
  unavailable, since the log records no tool definitions.
- **Agent Host cache-write and reasoning tokens.** For chats from the default
  harness, the Cache write and Reasoning columns come from the Copilot CLI's
  per-call usage records (Copilot CLI 1.0.95 and later). They're used only
  when the records add up to the turn's token totals; otherwise both show as
  unknown, with the reason. The optional
  `github.copilot.chat.otel.dbSpanExporter.enabled` setting doesn't apply to
  these chats.
- The MCP server shows as AI Credits Analyzer, with its author, a link
  to the GitHub repo and the extension's icon, in clients that display
  them.

### Changed

- **Setup.** The two debug-logging warnings are optional when VS Code's Agent
  Host store exists, since they only affect chats run with the Local harness.
- **Sessions order.** Sessions from the classic and Agent Host stores are
  listed together, newest start first.

### Fixed

- **The setup warning banner fits a narrow panel.** At 360 px (and 320 px)
  wide, long setting ids wrap and the fix and Dismiss buttons move under the
  text, so the page no longer scrolls sideways.
- **Debug logging switched on mid-session no longer shifts usage onto the
  wrong turns.** For a Local harness chat whose debug log starts after the
  chat's first turn, the panel showed later turns' tokens, AI Credits and
  tool calls on earlier turns. Turns are now matched on the prompt text; a
  turn that can't be matched with certainty shows its usage as unknown. The
  session's total stays unknown while some turns have no usage.
- **A session's AI Credits are the same in the Sessions view, the status bar,
  the panel and the MCP tools.** For a Local harness chat whose debug log has a
  turn that Copilot Chat's session store has no record of (an interrupted or
  still-running turn), the Sessions view counted that turn's AI Credits and
  the panel and `get_session_cost` did not. The panel now lists that turn, with
  its tokens and AI Credits and a note that its text isn't recorded, and every
  view counts it. When a turn in the session store has no usage in the debug
  log, the Sessions view now shows the session's AI Credits as unknown, as
  the panel does, instead of a partial total.
- The Setup view and the first walkthrough step no longer say Copilot Chat
  debug logging is needed for token data. It matters only for Local harness
  chats; Agent Host chats (the VS Code default) need no setting.

## [0.1.0]

The first release.

### Added

- **A panel that fits the editor:** it follows your VS Code theme (light,
  dark and high contrast) and any panel width, without cutting anything
  off; pick sessions in the side bar's Sessions view and Learn scenarios
  in its Learn view.
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
