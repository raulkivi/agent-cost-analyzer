# Changelog

**Last changed:** 2026-11-14 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Light and dark colour themes with an Auto/Light/Dark switch in the header; Auto follows the OS setting.

### Changed

- New look: monospace interface and numbers (Commit Mono), serif explanations (Source Serif 4), square hairline panels; Barlow is no longer bundled.

- Denser layout: smaller spacing and type, 28px table rows, one toolbar row on the Dashboard, compact session and scenario lists that fill the column, 80px KPI tiles with the cost explanation in a footnote, a trend chart that fills its panel, one-line empty charts and a collapsed Learn sources list. The Dashboard is about 40% shorter.
- The server status and version moved into the header.

### Fixed

- Claude Code sessions whose log holds the characters U+2028 or U+2029 inside a message no longer lose the lines around them: the reader splits records at line feeds only, so those sessions' requests, costs and savings figures are complete (found by the savings real-data check; one session had lost a third of its requests).
- The MCP server (insights, cost analyses, prices, `estimate_cost`, `get_statement`) now follows `AGENT_COST_ANALYZER_NOW` like the web app; it used the real date before, which only differed when the clock is fixed (tests and demos).
- `compare_models_for_session` and the Replay view no longer label a session that switched models (e.g. Sonnet, then Opus) as measured on its first model alone: the result lists `measuredModels` in order, flags the first-model entry `isMixedSessionModel` instead of `isMeasuredModel`, the view says "measured on A, then B" and makes no own-model check; `replay_session`'s `selfCheck` gains `models`, and the self-check line (in the Replay view and the web app) names every model it ran.
- On a narrow screen the All sessions audit's tables scroll inside their panels instead of making the page wider.
- The replay coverage line now lists the subagent runs it leaves out, as the 0.12.0 notes said: "N subagent runs not replayed: replay covers the main agent only" in the web app, the VS Code panel and the Replay view; the summary panel adds their AI Credits (or "unknown"), and `compare_models_for_session` gains an optional `subagentRuns`.

## [0.14.0] - 2026-11-13

### Added
- **Savings tab.** A ranked list of changes that would cost less: tools loaded but never used, cache lost
  after an idle gap or with no idle gap, a model switched mid-session, repeated failed tool calls. Each row
  shows a range or an "up to" figure per week, its coverage and the fixed action text with Copy (one line,
  at most 600 characters); one list per currency (AI Credits, US dollars), never converted, and no total,
  because the opportunities overlap. Rows carry "estimate", "inferred" or "Not priced" where they apply.
  A Simulated section holds replays on a cheaper model, apart and unranked and off until "Include
  simulated" is ticked, and "Not analysed" lists what could not be checked and why. Pick the last 7, 30
  or 90 days. In the app it follows Billing on the Dashboard; in the extension it follows Dashboard in the
  panel (GitHub Copilot sessions only). The report changes no setting or file. "Open in Analyze" on
  another provider's session switches the selected provider, as the Provider select does. API:
  `GET /api/savings`. See the User Guide's "The savings report".
- **A subagent marker, block and tile line in the panel.** The turns table marks AI Credits that
  include subagent runs, the Explanation tab lists the runs with turn totals, and the session tile says
  "incl. X from N subagent runs". The MCP App turn detail lists the runs too.

### Changed
- **Totals now include classic Copilot Chat subagent runs.** A classic chat that called a subagent
  (`runSubagent`, `searchSubagent`) wrote the run to its own debug log, which the analyzer left out.
  Each run's AI Credits are now added to the turn that started it, in the turns table, the session
  total, the dashboard and the MCP tools. Some totals rise. Some become unknown, with a reason: a
  run's log is missing or can't be read, a run can't be matched to a turn, or a session has more than
  200 subagent logs. A run whose log no event names is matched by time and labelled so.
- **Per-model figures, statements and price-change findings credit each run's model.** A turn that
  ran subagents on another model now counts under each model it used. Statements issued earlier may
  show a diff when re-run, because the re-run includes the runs.
- **Replay compares the main agent.** A replayed turn is compared on the main agent's own usage; the
  coverage line lists the subagent runs it left out.
- Savings action text now writes numbers with thousands separators ("5,400 tokens").

### Fixed
- **Opened-turn detail text contrast in VS Code Dark Modern.** The opened-turn detail in the MCP App
  view now sits on a neutral row background, so its text is readable.

## [0.13.0] - 2026-11-12

### Changed
- **The MCP server speaks the MCP 2026-07-28 protocol too.** The MCP server now also serves clients on
  the MCP 2026-07-28 protocol, alongside today's clients, and a call to a tool it doesn't have is
  answered with a protocol error instead of a tool error. Tool schemas are now advertised as JSON
  Schema 2020-12; the tools, their arguments and results are unchanged.

### Fixed
- **Keyboard focus after a drill-down loads.** In the MCP App views, when a drill-down finished
  loading, its Back button was replaced and focus was restored only after the next paint, so an
  Enter pressed in that moment did nothing. Focus now moves to the new control in the same render.

## [0.12.0] - 2026-11-12
### Added
- **Fullscreen for the cost rollup and cost-over-time views.** In MCP App hosts that offer fullscreen
  (Claude Desktop), the cost rollup (`get_cost_rollup`) and cost-over-time views (`get_repository_cost`,
  `get_project_cost`) show a Fullscreen control. In fullscreen the charts and tables use the wider
  window. VS Code offers only the inline view, so the control does not appear there.
- **MCP App price changes view (`get_price_changes`).** A timeline of when prices changed. Documented changes (from the price book: a solid diamond and rail, % per token type, sources) and observed ones (inferred from billed against priced figures: a dashed hollow diamond and rail, the "inferred" tag, a weekly billed-vs-priced table) stay apart. A rise is written in red and a fall in green (the host's danger and success colours, drawn towards the text colour so they stay readable), each with its sign.
- **"Price changes" in the cost-change view now works.** It opens the price timeline in place for the cost change's period, filtered to the (up to three) models with the largest price effect, with a Back control that restores the cost change without a new call.
- **MCP App billing views (`get_statement`, `estimate_cost`; standalone app only, the extension has none).**
  `get_statement` shows a project's statement per currency with its totals, coverage, turns of unknown
  cost and, for an issued period, how a re-run today differs from the issued copy; `estimate_cost`
  shows the p50 to p90 range tagged "estimate", labelled "Simulated" on another model, or the reason
  when there is too little history. Both are read-only.
- **Tool-call audit and session picker in the chat (MCP Apps).** `get_session_audit` and
  `get_audit_rollup` show a visual view: the failure rate over calls with a known outcome (calls with
  an unknown outcome are counted apart, never as success or failure), failure categories, the tokens
  spent recovering from failures (tokens, not AI Credits), retried commands and calls by tool; the
  date-range version adds failed calls per day (also as a table), top failing commands and the sessions, and names the
  sessions left out because their tool calls are not recorded. `list_sessions` shows a session picker
  whose "Analyse" button sends exactly "Analyse session <id>" to the chat and never a title. If the
  host declines or fails the message, that row shows "Ask in the chat: Analyse session <id>" in place
  of its button. The text answers are unchanged.
- **Replay view in the chat.** `compare_models_for_session` shows each model's simulated total beside the measured one; click a model to replay it turn by turn with a chart (also as a table), the self-check result and the turns not replayed, as `replay_session` shows directly. Every simulated figure says Simulated and an unknown one says Unknown.

### Changed
- **"Ask about this session" falls back to the text to type.** When the host declines or fails the
  message, the session view shows "Ask in the chat: Analyse session <id>" in place of the button,
  instead of saying the host did not accept it.

### Fixed
- **Falls are readable where a light host's success colour is pale.** On a light theme, a fall in
  the cost-change waterfall and its key are now drawn in the host's success colour mixed towards the
  text colour (3:1 or more), and a fall written as text in the replay and price changes views is
  mixed further (4.5:1 or more). Both stay green; dark themes are unchanged. Found in VS Code Light
  Modern (#73c991, 2.0:1 on its background).

## [0.11.0] - 2026-11-11
### Fixed
- **Charts are readable in High Contrast and light themes.** The "AI Credits by day" columns were
  invisible in High Contrast, and several chart colours were too faint on a light background (tokens
  by model, tool-call status, the orange, aqua, yellow and magenta series). Every chart mark now
  reaches 3:1 against its background.
- **Succeeded and failed tool calls are told apart without colour.** Stacked tool-call outcomes and
  tokens by model carry a fill pattern (hatching, dots) as well as a colour, in the charts and their
  legends.
- Copilot Chat sessions from a window with no folder open now appear. Their debug logs are
  under Copilot Chat's `globalStorage`, which was not read, so those sessions showed no tokens or
  AI Credits. They show as "No repository".
- MCP App cost-change view (`explain_cost_change`): the "Not explained" reasons no longer widen
  the view past the chat, so nothing scrolls sideways; a long unbroken word in a reason (a
  setting id) now wraps.

### Added
- Interactive views for the cost-analysis MCP tools in MCP Apps hosts:
  - `get_repository_cost` and `get_project_cost` show cost over time by basis
    (billed, reported, priced and the preferred total) with documented and
    inferred price-change markers; for a project also vendor then model,
    tokens by type, and top sessions that open the session view in place. A
    repository has no session drill-down.
  - `compare_costs` shows a comparison table whose rows open the cost-over-time
    view in place, with a Back control at each level (comparison, cost over
    time, session cost).
  - `explain_cost_change` shows a waterfall of usage, price and mix effects (a
    rise in the host's danger colour, a fall in its success colour, each with
    its sign), a
    per-model table, the documented price changes and a **Not explained** tile
    for turns with no price ("3 turns", "no price for these turns; not counted
    as 0").
  - Every figure names its basis and currency, AI Credits and USD stay apart
    (AI Credits first, also in the cost-over-time currency control),
    partial coverage reads "known for N of M turns", and a change with no
    earlier figure says so instead of "from 0". The tools' text output is
    unchanged.

## [0.10.0] - 2026-11-10
### Added
- Interactive cost views for MCP Apps hosts such as Claude Desktop: the MCP
  tools `get_session_cost`, `get_cost_rollup` and `list_findings` show a
  branded view next to the text result (per-turn chart and turn drill-down,
  spend by day, model and provider with a drill-down into a session,
  filterable findings, **Ask about this session**). Run `npm run build`;
  `scripts/mcp-server.sh` then serves the views (`--app-views-html` names
  another file), and without the build the server runs as before. Unknown
  figures read "Unknown", never 0. The tools keep their names, schemas and
  text, so Claude Code's output is unchanged; one app-only tool,
  `get_turn_series`, feeds the chart. See the User Guide's
  [Interactive views in the chat](docs/UserGuide.md#interactive-views-in-the-chat).
- MCP tools `get_session_cost` and `get_cost_rollup` mark a session as
  `active` when its latest turn started in the last 15 minutes, with
  `lastTurnAt`, and add a sentence saying its figures may still change. A
  running chat's log is not complete yet (the latest turn is undercounted),
  so its figures are no longer presented as final.

### Security
- The MCP server no longer hands local folder paths to the chat model:
  `list_repositories` has no `includePaths` argument any more (an old one is
  ignored), so instructions hidden in a logged session can't make the model
  ask for them. Paths are still in the app (`GET /api/repositories`).
- `list_projects` no longer returns client names and billing codes unless you
  start the MCP server with `--project-billing-details`; `get_statement` still
  carries them. (threat-model.md §5.6)
- The server refuses to start if it is ever set to listen on anything but a
  loopback address (127.0.0.1, ::1 or localhost), since it has no
  authentication (threat-model.md §5.1).
- Tests now show that traversal-shaped ids on the Learn routes are treated as
  unknown and never read a file (threat-model.md §5.7).
- The code-review workflow pins its plugin to a commit instead of running
  whatever that repository's default branch holds (threat-model.md §5.5). The
  pin now goes on the plugin itself, through a one-plugin marketplace the
  workflow writes; the first attempt pinned only Anthropic's marketplace,
  which can't be added from a local copy and still pointed the plugin at
  `main`.

### Fixed
- A turn's explanation now names cache-write tokens as well as new input and
  cache reads, and reads "1 token" / "18 tokens" instead of "token(s)".
- Claude Code sessions that were compacted (`/compact` or automatic) now
  show and cost every turn, not only those after the latest compaction; the
  turn after a compaction is marked as one.
- Claude Code turns are no longer split by lines the CLI writes itself
  (`isMeta`), which could count one response twice, and the CLI's
  `<synthetic>` lines after an interruption are no longer taken as a request
  or as the session's model.
- Dashboard list-box values meet the 24 px minimum target size, and a chart's
  table view can be scrolled from the keyboard (found by the new
  real-browser accessibility check).

### Changed
- Learn on the Claude Code harness uses the 1-hour cache lifetime Claude Code
  requests (its own logs show it), so a short break no longer expires the
  cache there; the TTL scenarios use a break longer than an hour. Copilot is
  unchanged.

### Added
- Replay a session on another model (Phase 14, first part): the MCP tools
  `replay_session` and `compare_models_for_session`, in both the app's and
  the extension's MCP server, say what a real Claude Code or Copilot session
  would have cost on another model, turn by turn, beside what it did cost,
  with coverage, a self-check on the session's own model and the
  assumptions. Every figure is labelled Simulated. `estimate_cost` takes a
  `model` to estimate planned work on it. The same answers are at
  `GET /api/sessions/:id/replay` and `/replay/compare`.
- Replay on and Compare models in Analyze, in the app and the extension:
  pick a model to see Simulated columns beside the measured ones, a summary
  with coverage, the self-check and the assumptions, and the session's
  total on up to 10 models side by side.
- Vendor-aware Learn (Phase 13): scenarios are simulated on a vendor and
  model you pick, with real prices and documented cache rules, a Cache column,
  per-turn notes, an assumptions popover and a sources footer. Learn numbers
  change accordingly.
- Cost by repository and project (Phase 15 step 15.4): Dashboard rows are
  attributed to a repository, project, vendor and channel, with Project,
  Repository, Vendor and Channel list boxes (Unattributed and unknown
  values keep their reasons). mitmproxy capture rules now apply. New MCP
  tools `list_repositories` and `list_projects`, and `list_sessions`
  filters by repository and project; MCP output gives local repositories
  by folder name only unless `includePaths` is set.
- Price book with history (Phase 15 step 15.5): sourced, dated price
  versions per channel and model (`fixtures/price-book/`, starting with
  GitHub Copilot's table from 2026-10-01 and the Anthropic, OpenAI and Google APIs'), the user's own contract or list prices in
  `projects.json` (`channels.priceVersions`), `GET /api/price-book` and the
  read-only `get_price_book` MCP tool. Learn simulation prices now come
  from the price book. A price not in the book is unknown with a reason,
  never zero.
- Cost basis (Phase 15 step 15.6): every Dashboard turn now carries three
  cost figures, each labelled with how it was obtained: billed (Copilot's
  AI Credits), reported (pi's own USD cost) and priced (tokens times the
  price in force on the turn's channel when it ran, naming the price
  version). Totals use billed, else reported, else priced, show how many
  turns each covers, and keep AI Credits and USD apart (converted only at
  1 AI Credit = $0.01). A Cost basis list box and a Cost tile with a
  Preferred / Billed / Reported / Priced switch are on the Dashboard.
  Claude Code's priced figures are labelled API-equivalent; Claude Code and
  pi 1-hour cache writes are priced at the 1-hour rate. `get_session_cost`,
  `get_cost_rollup` and `get_turn` return the cost basis; `get_cost_rollup`
  adds repository and project filters, breakdowns by repository, project,
  vendor and channel, and a reconciliation of Copilot's billed AI Credits
  against the price book per model and month. A turn that can't be priced
  is unknown with a reason, never zero.
- Cost over time, compare and inside a project (Phase 15 step 15.7):
  `GET /api/cost/timeseries` gives cost per day, ISO week or month (UTC)
  for the whole selection or per repository, project, vendor or model,
  with coverage per basis on every bucket, a running total, a vendor and
  model breakdown and the documented price changes in the range;
  `GET /api/cost/compare` compares 2 to 20 repositories or projects (total,
  change against the previous period or last year, per session, per active
  day, per turn, share, cache-hit ratio, output share). Both take a basis,
  "as of use" or "today's" prices, and native currencies or USD at
  1 AI Credit = $0.01. New MCP tools `get_repository_cost`,
  `get_project_cost` (adds breakdowns by repository, token type and the top
  sessions) and `compare_costs`; `review_costs` now groups its findings by
  project. A bucket whose cost is all unknown is a gap, never zero.
- Dashboard tabs Cost over time and Compare (Phase 15 step 15.9, standalone
  app): a view switch beside the Dashboard's list boxes, whose Project,
  Repository and Provider selections the tabs follow. Cost over time has
  date presets, day/week/month buckets, AI Credits or USD (converted at
  1 AI Credit = $0.01, stated) and as-of-use or today's prices; KPI tiles
  with coverage; one series as columns plus a separate running total, two
  to four as labelled lines, five or more as small multiples; unknown cost
  as a visible gap, never zero; and documented price changes as focusable
  markers with the old and new unit prices and the source. Compare shows
  the measures table (priority columns and a Details drawer on narrow
  screens), indexed growth and share of total. Every chart has "View as
  table". Series keep their colour as filters change; High Contrast adds
  dash patterns. Hidden in the VS Code extension until it gets its own cost
  data. A local repository is shown by its folder name in the list boxes.
- A usage-scenario test suite for the standalone app (Playwright, the real
  server over a seeded fixture home at a fixed clock), run by a new
  required `web-e2e` CI job.
- Cost by repository in the VS Code extension (Phase 15 step 15.14): the
  Sessions view can be grouped by repository (a title-bar toggle, kept
  across workspaces), the status bar shows today's AI Credits for the open
  folder's repository with every repository's total in its tooltip, and
  the panel's Dashboard has the Cost over time and Compare tabs. A new
  product flag, `projectsAndBilling`, keeps Project and Billing in this app
  only; the extension's view switch says where they are. Scenario S9 runs
  in the `extension-ui` job.
- MCP across both products (Phase 15 step 15.13): the server's
  instructions now explain the cost workflow (repositories and projects,
  then project cost or a comparison, then why it changed), what billed,
  reported and priced figures are, as-of-use versus today's prices, and the
  one conversion (1 AI Credit = $0.01). The VS Code extension's MCP server
  gains the repository, price-book and cost tools (17 tools, no billing);
  its `list_projects` says projects are edited in this app. New tests run
  every tool over generated folders and remote credentials and check that
  none leaks a credential or a local path, and a usage scenario checks
  that the Dashboard, the HTTP API and MCP give the same total.
- Estimates (Phase 15 step 15.12): the Billing tab's "Next piece of work"
  panel estimates planned work for a project as a range, never one number:
  the median and 90th-percentile cost per active day over the last 4 or 12
  weeks, at today's prices, times the planned active days, with the inputs
  it used. With fewer than 5 active days of known cost it gives the reason
  instead of a range. `GET /api/estimates` (active days or sessions), MCP
  `estimate_cost` and an `estimate_work` prompt.
- Billing statements and a Projects editor (Phase 15 step 15.11): a Billing
  tab on the Dashboard shows one project's statement for a month, in this
  machine's time zone: lines per channel, model and price version, turns
  with unknown cost listed (never counted as zero), subscription use left
  off unless the project includes it, the project's markup, fixed lines
  and own currency at a fixed rate, totals per currency, coverage and
  provenance. "Issue statement" (after a confirmation, and only once the
  month has ended) freezes it as a file that never changes; a later re-run
  that differs (late logs, a price change) shows "Differs from issued" and
  the exact diff. Export as CSV, JSON or Markdown (no message text, session
  titles optional). The Projects editor assigns repositories to projects
  with a select (keyboard only), edits members, rates and capture rules,
  and shows problems such as two projects claiming the same scope inline,
  with Save disabled until they're fixed. `GET /api/statements`,
  `POST /api/statements/:projectId/:period/issue` (JSON only), MCP
  `get_statement` (read-only) and a `prepare_statement` prompt.
- Price changes and why cost changed (Phase 15 step 15.10): a Project tab on
  the Dashboard, inside the selected project: cost by vendor (click one for
  its models, with tokens by type beside them), a waterfall from one month's
  cost to another's split into usage, price and mix effects that add up
  exactly to the change (on the priced basis, as of use, with "View as
  table"), and Copilot's billed minus priced AI Credits per model and month.
  An observed price change (Copilot billing a model more than 5% away from
  the price book, the same way, two weeks in a row) is an inferred
  "price-change" finding and a dashed marker on Cost over time.
  `GET /api/cost/variance`, `GET /api/cost/project` and
  `GET /api/price-book/changes`; MCP tools `explain_cost_change` and
  `get_price_changes`, an `explain_cost_change` prompt, and `list_findings`
  kind `price-change`. A turn that can't be priced is counted as not
  explained, never as zero. Fixed: a selected bar's value was below the
  4.5:1 contrast minimum in Light Modern.
- Web and VS Code themes: eight categorical series colours
  (`--color-series-1` to `-8`, light and dark steps), a diverging pair for
  waterfalls, and dash patterns in High Contrast, ready for the
  cost-by-project charts (Phase 15 step 15.8).
- Session working folders (Phase 15 step 15.1): every Analyze session
  reports the folder it ran in, and its branch and repository where the log
  records them, or why it is unknown (mitmproxy captures record none); each
  turn reports when it started. This is the groundwork for cost by
  repository and project.
- Repository resolution (Phase 15 step 15.2): a session's folder maps to
  its repository from the folder's git files alone (no `git` process, no
  network). Clones, worktrees and subfolders of one remote get one key, and
  credentials in remote URLs never reach it. Not shown in the app yet.
- Projects file (Phase 15 step 15.3): `projects.json` in the app's settings
  folder groups repositories into projects (with optional path and branch
  scopes and aliases). `GET`/`PUT /api/projects` read and validate-then-write
  it, `GET /api/repositories` lists the repositories your sessions ran in,
  and a broken file shows an optional warning.
- VS Code Agent Host sessions (step 10.13): Copilot chats that VS Code 1.143
  and later run through the Agent Host are listed with their turns, tokens and
  AI Credits, beside the classic Copilot Chat sessions.
- VS Code Agent Host turn text, tool calls and system prompt (step 10.14):
  prompt and response text, turn inspector rounds, tool calls with outcomes
  and the system prompt come from the Copilot CLI's event log
  (`<COPILOT_HOME or ~/.copilot>/session-state/<sdkSessionId>/events.jsonl`), read
  locally. Tool calls then count in the tool audit and rollups. A session
  whose log is missing or unreadable shows these as unavailable, with the
  reason, and stays out of the audit counts. The Tools tab stays unavailable,
  since the log records no tool definitions.
- VS Code Agent Host cache-write and reasoning tokens (step 10.15): per turn,
  from the Copilot CLI's per-call usage records in its event log (Copilot CLI
  1.0.95 and later). The records are used only when they add up to the
  turn's token totals in `session.db`; otherwise both figures are unknown,
  with the reason. Uncached input, cache write and cache read still add up
  to `session.db`'s input total.
- `.github/CODEOWNERS`: every change needs the maintainer's review, and
  security-sensitive paths (workflows, dependencies, release scripts, agent
  instructions, redaction and MCP code) are listed explicitly.
- Learn scenarios fact-check (`docs/learn-scenarios-fact-check.md`): every
  scenario claim checked against Anthropic, Claude Code, OpenAI, Google, xAI,
  GitHub and VS Code docs, with verdicts and sources. Each scenario doc ends
  with a Sources list. A new test recomputes every Learn turn's AI Credits
  from its scenario's stated rates.
- Plan for Phase 13, vendor-aware Learn simulation (VS Code first), and
  Phase 14, replaying Analyze sessions on another vendor.
### Fixed
- The setup warning banner fits a 360 px (or 320 px) wide panel: long setting
  ids wrap, and the fix and Dismiss buttons move under the text instead of
  pushing the page sideways.
- VS Code Local harness sessions where debug logging was switched on
  mid-session: the log's turns were matched to the session store's turns by
  position, so earlier turns showed later turns' tokens, AI Credits and tool
  calls. They are now matched on the user's message text; where no unique
  match exists the turn's usage is unknown, never a guess. The session's
  total stays unknown while some turns have no usage.
- VS Code Local harness sessions: the session list and the session detail
  (turns table, `get_session_cost`, `get_cost_rollup`, insights) now report the
  same AI Credits, turn count, model and usage availability, from one shared
  computation (`summarizeSessionUsage`). A `main.jsonl` turn with no
  session-store row (interrupted or still running) was counted by the list but
  dropped by the detail; it is now a turn of the session, with its usage and a
  `textUnavailableReason`, and its inspector opens. A store turn with no usage
  in `main.jsonl` now makes the list's total unknown, as it already made the
  detail's. The `LogProvider` contract checks list-vs-detail agreement for
  every provider.
- Learn scenarios: five AI Credits arithmetic slips (scenarios 10, 12, 13,
  15 and 18) and one wrong cross-scenario total (scenario 14).
- Learn scenarios and docs: the cache prefix order is tools → system →
  messages, so a tool change invalidates the whole cache (the text had it
  reversed). A 5-minute break exceeds Anthropic's default cache lifetime,
  not "every provider's". The provider cache-lifetime table and the
  Copilot billing description (per-token AI credits) are brought up to
  date.
- VS Code Agent Host sessions (step 10.13): a session whose `session.db` is
  missing or unreadable stays listed with unknown usage; only chats that were
  opened but never sent are hidden.
- The cross-session tool-call audit, the insights detectors and the MCP
  rollup tools no longer count Agent Host sessions as having zero tool calls:
  they are left out of the counts and rates, and the audit says how many.
### Changed
- VS Code Agent Host sessions (step 10.13): the Copilot session list holds
  classic and Agent Host sessions together, newest start first. The debug
  logging and retention warnings are optional when `agent-host.db` exists,
  since they only affect Local harness chats ("Only affects chats run with
  the Local harness; Agent Host chats are unaffected.").
- Renamed the repository and npm workspace scope from `copilot-cost-analyzer`
  to `agent-cost-analyzer`, matching the product name. GitHub redirects the
  old URLs. The MCP server now reports its name as `agent-cost-analyzer`.
  The settings directory (and its `mitmproxy-captures/` folder) is now
  `agent-cost-analyzer`; an existing `copilot-cost-analyzer` or
  `gh-cp-chat-analyser` directory is moved there on first start.
- Phase 10.12: in AI Credits Analyzer, the Learn scenarios are listed in a
  Learn view in the side bar, like sessions in the Sessions view, so the
  panel uses its full width in Learn mode too.
- Phase 10.11, after a UX review of the VS Code panel.
  - Nothing is cut off on the right at any width: the layout follows the
    room left for the turns, and the turns table scrolls inside its column.
  - The system prompt inspector's section colours read in light, dark and
    high-contrast themes, and its columns stack in narrow panels.
  - In VS Code: no duplicate session list in Analyze mode (use the side
    bar), no extra brand header or status line, native form controls and
    scrollbars, and a visible selection in High Contrast.
  - Session cards no longer repeat "Learn" or "Analyze"; the header no
    longer says "GitHub Copilot Chat"; the dashboard shows the insights
    before its filters in narrow windows.
### Added
- The MCP servers identify themselves to clients with a display title
  (Agent Cost Analyzer, or AI Credits Analyzer in the extension), the
  author, a link to the GitHub repo and the app icon.
- A UI check (`npm run test:ui`) that runs the extension's webview in
  Chromium with VS Code's themes and fails on cut-off content or
  unreadable text.
- Phase 10.8.
  - **AI Credits Analyzer:** a Copilot-only MCP server that Copilot Chat
    agent mode can use (the same 9 read-only tools as the standalone
    server, Copilot sessions only). Off until you turn on
    `aiCreditsAnalyzer.mcp.enabled`; a workspace you haven't trusted can't
    turn it on. Walkthrough step 5 explains what it shares.
  - **Both products:**
    - "View as table" for every chart;
    - keyboard access to the system-prompt diagram;
    - the column chooser closes on an outside click;
    - Cancel for long loads (insights, tool audit, turn inspector).
- Phase 10.9, AI Credits Analyzer (not yet published).
  - Integration tests in a real VS Code, with performance budgets, run in
    CI; each CI run builds an installable `.vsix`.
  - Smaller, minified extension package (2.6 MB) with only the files it
    needs.
  - The extension's MCP server has its own name, `ai-credits-analyzer`,
    and Copilot-only instructions.
  - Release workflows: `ext-v*` tags publish the extension to the VS Code
    Marketplace and Open VSX; `app-v*` tags make a GitHub Release of the
    standalone app.
- Phase 10.10: documentation for both products.
  - The README is now Agent Cost Analyzer's, with a "Which product should
    I use?" section, and says how the Claude Code provider finds its logs.
  - An AI Credits Analyzer guide (`docs/vscode-extension-guide.md`), its
    Marketplace README and its own changelog.
  - The User Guide covers charts as tables, Cancel, narrow and medium
    windows, keyboard use and reduced motion.
  - The threat model covers the extension; CONTRIBUTING covers building
    and testing it.
### Fixed
- MCP tool results (both products) now also mask Google API keys, Stripe
  secret and restricted keys, and npm, GitLab and Hugging Face tokens, since
  those results go to the chat model.
- The tool audit and MCP tool results (both products) now mask a
  shortest-length OpenAI-style `sk-` key or Slack token that ends in a
  hyphen; before, such a token was shown in full.
- Config warnings no longer show the user's home directory path; the
  settings.json location in the help steps is shortened to `~`.
- The dashboard's Security signals tile listed anomalies and behaviour
  changes in its severity note (for example "0" over "2 medium"); it now
  counts security findings only.
- The dashboard's AI Credits by day chart printed every date label even
  when they ran into each other (two weeks of data read "10-1310-14…"); it
  now skips labels to keep them apart.
- The turn inspector's round picker could jump back to round 0 right after
  you picked another round.

## [0.9.0] - 2026-10-24
### Added
- Phase 10.7.
  - **Both products:**
    - automated accessibility checks (axe) in light, dark and
      high-contrast themes, with every violation fixed;
    - text contrast of at least 4.5:1;
    - full keyboard navigation;
    - narrow and medium layouts with a column chooser;
    - one consistent loading, empty, error and partial-data view with
      Retry;
    - reduced-motion support.
  - **AI Credits Analyzer:**
    - a Get Started walkthrough that opens once on first run;
    - localizable strings;
    - the system prompt opens read-only.
- Phase 10.6, AI Credits Analyzer (not yet published).
  - An Activity Bar sidebar with a Sessions list (grouped by day, AI
    Credits or "unknown" per session) and a Setup view with Fix buttons.
  - A status-bar item showing today's known AI Credits, with coverage in
    its tooltip.
  - Picking a session in the sidebar opens it in the analyzer panel.
  - Refresh also picks up workspaces opened after VS Code started.
- Phase 10.5, AI Credits Analyzer (not yet published).
  - Config warnings have Enable/Change buttons that open the exact VS Code
    setting.
  - The system prompt opens in an editor tab, and copying uses VS Code's
    clipboard.
  - The UI follows your VS Code theme and font.
  - Provider pickers and cross-provider wording are hidden, because the
    extension reads only Copilot Chat logs.
- Phase 10.4, AI Credits Analyzer (not yet published).
  - Copilot Chat log paths are derived from VS Code's own storage location,
    so the extension works on Linux, macOS, Windows, Insiders, portable and
    remote installs.
  - Settings are read through VS Code, workspace overrides included, and
    the extension's own settings persist across restarts.
  - Changing a Copilot logging setting refreshes the open panel's warnings.
  - Webview requests are validated per method.
- Phase 10.3: `packages/vscode-extension`, the skeleton of AI Credits
  Analyzer (`raulkivi.ai-credits-analyzer`, not yet published). It has an
  "AI Credits Analyzer: Open" command, a webview panel with a strict CSP, a
  message bridge to the shared `ApiService`, and a Copilot-only
  composition root. A bundle-boundary test keeps Claude Code, pi,
  mitmproxy and Express code out of the extension bundle.
- Phase 10 plan (`docs/plans/vscode-extension.md`): AI Credits Analyzer,
  a separate Copilot-only VS Code extension that shares code with the
  standalone app (Agent Cost Analyzer). Covers the code analysis, decisions
  D1-D10, test-first steps 10.0-10.9, UX and accessibility standards, UI
  mock-ups (`docs/plans/mockups/vscode-extension/`), and CI and Marketplace
  / Open VSX deployment.
- MCP tools v2 (Phase 9.12): `get_session_cost` (token and AI Credits
  totals with coverage, cache hit ratio, spend per model, the most
  expensive turns, cost events, context overhead), `get_cost_rollup`
  (spend across every provider by provider, model and day, plus the top
  sessions), `list_findings` (security, anomaly and behaviour-change
  findings) and `get_turn` (one turn, redacted and bounded). New
  `review_costs` and `security_review` prompts. The server now sends
  workflow instructions, declares an output schema for every tool and
  returns errors that name the next step. `list_sessions` gains a title/id
  `query` and a `total`; `list_tool_calls` gains `kind` and `offset` (also
  on `GET /api/sessions/:id/tool-calls`). Plan: `docs/plans/mcp-tools-v2.md`.

### Changed
- The standalone app bundles its Barlow fonts instead of loading them from
  Google Fonts, so it makes no network requests at all.
- Accent text, primary buttons and muted text are slightly darker, to
  reach 4.5:1 contrast.
- The standalone app's header now shows its product name, "Agent Cost
  Analyzer", from `GET /api/product`.
- The config check reads settings through a `SettingsSource` port. The
  standalone app still reads the user `settings.json`, and its output is
  unchanged.
- Root `engines.node` raised to `>=22.18`. The extension's build scripts
  are `.mts` files that Node runs directly.
- Phase 10.1/10.2 groundwork for the AI Credits Analyzer extension. The HTTP
  routes are now a thin layer over a transport-neutral `ApiService`, and
  the web client reaches its backend through an `ApiTransport` (HTTP, or
  `postMessage` inside a VS Code webview). The HTTP API is unchanged, with
  one exception: `GET /api/sessions/:id/system-prompt` with the mitmproxy or
  Claude Code provider active now always answers 404, instead of returning
  a VS Code session's prompt.
- New `GET /api/product` returns the product profile ("Agent Cost
  Analyzer").

### Fixed
- Analyze mode finds VS Code's Copilot Chat logs on macOS and Windows, not
  only Linux (#22).

### Security
- Upgraded `zod` to 4.6.7 (GHSA-mrhx-c7xc-m3w5: memory exhaustion when
  validating oversized constrained collections). The domain package and the
  planned extension bundle depend on it.
- Forced `undici` to 8.12.3 with a root `overrides` entry (GHSA-xjj6-f33q-929c,
  GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472: denial of service and
  Subresource Integrity bypass). It is pulled in by `jsdom` and by
  `@earendil-works/pi-coding-agent`, which pins 8.10.2.
- Removed the captured turn examples from `Design/examples/`; the 0.8.0 entry said they were removed, but they were still in the repository. Replaced the captured Copilot system prompt (`Design/SystemPrompt.txt`) with a synthetic fixture, `packages/web/fixtures/system-prompt-sample.txt`, used by the parser tests and the design-sync preview.

## [0.8.0] - 2026-10-12
### Added
- Insights dashboard (Phase 9.11): a new **Dashboard** view in Analyze mode
  that works like QlikView across every log provider at once. Click any
  value in a list box or any bar, and every list box, KPI and chart
  narrows to what's associated with it. Values are coloured
  selected/possible/alternative/excluded, with current selections, Back
  and Clear all. KPIs report coverage instead of treating unknown AI
  Credits as 0. A "What happened" summary and a **Signals to review**
  table flag risky commands (pipe-to-shell, decode-and-exec, `rm -rf`,
  force push, `sudo`, credential files, persistence, system-path writes,
  data upload, raw sockets, package installs, denied actions), statistical
  anomalies and first-time behaviour, each with when, why and redacted
  evidence. New endpoint: `GET /api/insights`. Plan:
  `docs/plans/insights-dashboard.md`.
- Community health files: `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, issue forms and a
  pull request template.

### Fixed
- pi sessions no longer undercount tokens: usage from top-level `usage`
  entries (e.g. cache warming), tool results, compactions and branch
  summaries now counts toward the turn it occurs in, and reasoning tokens
  are read from pi's `Usage.reasoning`. Tool-call arguments and thinking text
  are read from pi's published field names (`arguments`, `thinking`). The
  system prompt and tool inventory now come from the system messages pi
  stores in the session file, with the `pi-system-prompt-logger` sidecar as
  the fallback for older files.
- Web test files now type-check: `npm run typecheck` (new, every workspace,
  test files included) runs in CI. `packages/web` gains `tsconfig.app.json`, an
  app-only check without Node types, so browser code can't pick up `node:*`
  imports while tests still can.
- `SECURITY.md` linked private vulnerability reporting at the old
  `gh-cp-chat-analyser` repository name.

### Security
- Removed captured turn examples and local filesystem paths from `Design/`.
- The API server now rejects (403) any request whose `Host` header isn't a
  loopback name (`localhost`, `127.0.0.1`, `[::1]`) on port 3001 or the Vite
  dev port 5173, closing a DNS-rebinding path by which a malicious web page
  could read session transcripts and HAR bodies. The Vite dev server now uses
  a fixed port (`strictPort`) so the allow-list matches.
- `npm audit fix`: `proxy-addr` 2.0.8 (critical `GHSA-jqcg-44mw-7w3h`, via
  Express, production), `@modelcontextprotocol/sdk` 1.32.1 (high
  `GHSA-6qxp-vccf-f47h`, production; the audit MCP server uses no OAuth) and
  `source-map-js` 1.2.2 (high `GHSA-68fv-2mgg-jv7q`, dev-only via Vite).
  Still open: `brace-expansion` 5.0.9 (high) pinned by the `npm-shrinkwrap.json`
  inside `@earendil-works/pi-coding-agent` 0.87.1, a dev-only types dependency
  of `pi-system-prompt-logger`; only Pi 1.x ships 5.0.12, a major bump that is
  tracked separately.
- Captured headers whose names look like credentials (`*api-key`, `*secret`, `*-token`, `*-auth*`, `*security-token`) are stripped in addition to the fixed list. Rate-limit headers such as `x-ratelimit-limit-tokens` are kept.
- `pi-system-prompt-logger` now builds against `@earendil-works/pi-coding-agent`
  0.87.1, the renamed Pi package, instead of the abandoned
  `@mariozechner/pi-coding-agent` 0.73.1. Closes the last 5 Dependabot alerts
  (`GHSA-jfgx-wxx8-mp94`, `GHSA-r95r-rj6r-c39x`, `GHSA-7v5m-pr3q-6453`, fixed
  upstream in Pi 0.78.1, and two `extract-zip` symlink advisories; the new
  package no longer depends on `extract-zip`). Dev-only: the extension imports
  Pi's types, and the extension API it uses is unchanged.

### Changed
- Web UI now runs on React 19; runtime dependencies upgraded to zod 4
  and gpt-tokenizer 4. No behaviour change.
- Renamed the project from `gh-cp-chat-analyser` to `copilot-cost-analyzer`
  (repo, package name, workspace scope, settings directory) for
  discoverability — the old slug wasn't something anyone would search for.
  Existing local settings under the old per-user config directory are
  migrated automatically on first run after upgrading.

## [0.7.0] - 2026-09-09
### Security
- Bumped `qs` (6.15.3 → 6.16.0), `js-yaml` (4.3.1 → 4.3.2), and
  `vitest`/`@vitest/mocker` (4.1.10 → 4.1.11) to patched versions, closing
  4 of 6 Dependabot alerts (`GHSA-x5fp-wj9c-mxmx`, `GHSA-4mjr-xmp4-gh2g`,
  `GHSA-2883-xcg3-v3hh`, `GHSA-82fw-gwwq-j7x9`) — all resolved within
  existing semver ranges, so only `package-lock.json` changed. The
  remaining two (`extract-zip`, `@mariozechner/pi-coding-agent`, both
  dev-only via `packages/pi-system-prompt-logger`) have no patched
  upstream version yet; tracked for a future bump.

## [0.6.0] - 2026-09-09
### Added
- New Analyze-mode log provider, `claude-code`, reading the
  [Claude Code CLI](https://claude.com/claude-code)'s own native JSONL
  session logs directly (`~/.claude/projects/`) — selectable alongside
  `vscode`/`mitmproxy`/`pi-agent` via the existing provider select, with no
  API or frontend changes required. Unlike `pi-agent`, a session file
  (possibly containing edited/resent branches) always lists as exactly one
  session, following the file's own authoritative active branch. Every
  field shape this provider depends on was confirmed against real captures
  on this machine before being coded against, so per-turn token usage
  (including cache read/write and reasoning tokens) is populated for real,
  not marked unavailable pending verification; `Session.systemPrompt`
  stays unset (Claude Code never writes its base system prompt to disk)
  and `Session.toolInventory` stays unset (scoped out of v1).

## [0.5.0] - 2026-09-04
### Added
- Vendored `pi-system-prompt-logger`, a Pi coding-agent extension that
  captures the fully assembled system prompt (plus selected tools, skills,
  and context files) to a JSONL sidecar log once per session, as a new
  workspace package (`packages/pi-system-prompt-logger`) — buildable and
  testable via the root toolchain (`npm run build`/`test`/`bundle
  --workspace=packages/pi-system-prompt-logger`).
- The `pi-agent` log provider now optionally reads that sidecar log:
  when installed and a session's file has a matching captured record, the
  system prompt inspector shows the real captured prompt for pi sessions
  (rendered the same way as a VS Code session's); the "Open system prompt
  inspector" button now always renders for pi-agent sessions, and shows a
  plain-text (no link) message pointing at `npm run configure` when there's
  no match yet. `Session.toolInventory` stays unpopulated.
- `npm run configure`/`unconfigure` now interactively offer to build,
  install, and remove `pi-system-prompt-logger` into
  `~/.pi/agent/extensions/` — independent of and non-fatal to the existing
  shell-alias setup.
- New Analyze-mode log provider, `pi-agent`, reading the
  [pi coding agent](https://pi.dev)'s native JSONL session format directly
  (`~/.pi/agent/sessions/`) — selectable alongside `vscode`/`mitmproxy` via
  the existing provider select, with no API or frontend changes required.
  Since a pi session is a branchable tree (fork/rewind), a session file with
  unmerged branches now lists one session per branch tip, titled
  `<name> (branch i of N)`, the same "one file, many sessions" pattern
  already used for mitmproxy's idle-gap splitting. `tool`/`vision`/`reasoning`
  token breakdowns and `costAiCredits` are marked unavailable for pi sessions
  pending confirmation against a real captured session (no fabricated
  numbers, per the app's usual policy).
- mitmproxy provider: a single `.har` capture is now split into multiple
  Analyze-mode sessions when a gap of more than 30 minutes separates two
  captured exchanges, so one long-running capture spanning several
  coding-agent runs no longer shows up as one mixed-together session.
  Split sessions are titled `<filename> (session i of N)`.
- Zoomable icicle diagram for the system-prompt inspector: flexbox bars
  (one row per visible depth level, each bar sized proportionally to its
  section's character count) with click-to-zoom into subparts and a
  breadcrumb trail back out, available alongside the existing Pretty/Raw
  toggle. Each bar shows a bold section name and, in smaller text below,
  its character count and share of the current zoomed-in view as a
  percentage; a name too long for its bar is clipped with an ellipsis.
  Built with plain CSS so it fills all available width and its text
  always renders at true size, with no JavaScript-driven layout
  measurement.

### Fixed
- Switched to American English spelling ("Analyzer", "canceled", "unlabeled")
  throughout app UI text and documentation.
- Corrected several Learn-mode arithmetic errors found in a fact-check of the
  scenario docs: wrong per-turn token totals in Scenarios 10-13, 15-17
  (`docs/scenarios/`), a wrong AI Credits figure in Scenario 13, and a
  missing-diagram mislabel for Scenarios 8, 12, 15, 17 in the scenario index.
  Two of the AI Credits errors were baked into the served fixtures
  (`image-attachment-invalidation.json` turn 2, `cache-ttl-1-hour-breakpoint.json`
  turn 3), so Learn mode now shows the corrected values for those turns.
- The system-prompt breakdown panel's empty state always told the user to
  "enable agentDebugLog.fileLogging.enabled and reload VS Code," even for
  `pi-agent`/`mitmproxy` sessions, which never have a system-prompt artifact
  to capture (by design) and don't have that VS Code setting at all. The
  panel now shows a provider-neutral message ("This provider does not
  capture a system-prompt artifact...") for any non-`vscode` session.

## [0.4.0] - 2026-08-10
### Added
- Phase 9: extensible `LogProvider` registry with `MitmproxyLogProvider`
  (redacted HAR captures, Anthropic/OpenAI vendor-decoder registry) alongside
  `VscodeLogProvider`; `GET /api/log-providers` and
  `PUT /api/log-providers/active` to select the active source.
- Phase 9.5: per-turn `TurnInspector` request/response drill-down.
- System prompt inspector and AI-advice export panel.
- Rounds-count column in the turns table.
- GitHub Actions CI and package metadata.

### Changed
- Turn Inspector layout redesigned per `Design/README.md`.

## [0.3.0] - 2026-08-09
### Added
- Illustrated `UserGuide.md` covering Learn and Analyze modes.
- AI Credits cost reporting: session-list totals and cumulative per-row
  totals in the turns table.

### Fixed
- Path-traversal and unhandled-crash security gaps (Analyze mode).
- Four user-visible Analyze-mode correctness bugs.
- Four lower-severity correctness bugs.

### Changed
- Renamed "cost" to "AI Credits" across docs, fixtures, and UI.
- Duplication/simplification cleanup pass.

## [0.2.0] - 2026-08-08
### Added
- Phase 8: "Industry" design system applied to `packages/web`.
- MIT license.

## [0.1.0] - 2026-08-08
### Added
- Phases 0-7: npm workspace scaffolding, domain schema package, Learn mode
  (bundled scenarios), Analyze mode reading real VS Code sessions from
  SQLite, `main.jsonl` extractor registry with real usage data, startup
  configuration check, system-prompt breakdown / tool inventory / turn
  detail, shared D3 charts.
