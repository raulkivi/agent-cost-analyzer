# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- VS Code Agent Host sessions (step 10.13): Copilot chats that VS Code 1.143
  and later run through the Agent Host are listed with their turns, tokens and
  AI Credits, beside the classic Copilot Chat sessions. Their prompt and
  response text, tool calls and system prompt aren't read yet.
### Fixed
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
