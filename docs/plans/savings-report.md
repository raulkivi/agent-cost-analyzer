# Savings report: ranked, quantified fixes

**Last changed:** 2026-11-12 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

**Status: planned; owner decisions accepted 2026-11-12 (every recommendation); implementation started 2026-11-12.** Phase 16 in
[implementation-plan.md](../implementation-plan.md) (owner decision D9).

The question this answers: **"What should I change to spend less, and
about how much would each change save?"** One ranked list, across
sessions and providers, in the standalone app, in the VS Code extension
and (Increment 2) as an MCP tool with an MCP App view.

## Contents

1. Why
2. Goals and non-goals
3. What exists and what this builds on
4. The opportunities
5. Design (SOLID, CUPID)
6. What each provider gives
7. Honesty rules
8. MCP tool and view (Increment 2)
9. Mock-ups
10. Tasks
11. Threat-model rows to add
12. Owner decisions
13. Risks
14. Exit criterion

## 1. Why

- Every cost driver a user can fix is already visible somewhere, but in
  pieces: the Tools tab shows unused tool definitions for one session, the
  tool-call audit shows failures, the replay shows another model's cost,
  the turns table shows cache misses.
- None of them says what to change first, across all sessions, in money.
- The `review_costs` MCP prompt (`packages/server/src/mcp/prompts.ts`)
  asks the chat model to do this ranking itself from raw rollups. The
  model guesses the figures; the app can compute them from the logs and
  the price book.
- Real Analyze sessions never carry `triggeredEvent: "cache-expiry"` or
  `"instructions-change"`. Only Learn's `simulate-scenario.ts` sets them
  (verified by search). Idle cache loss in real sessions is invisible today.

## 2. Goals and non-goals

**Goals**

- G1. One report per time window (default 30 days) listing opportunities,
  each with what to change, the evidence, and an estimated saving per week
  as a range or a labelled upper bound.
- G2. Ranked by estimated saving, across every available provider in the
  standalone app and across Copilot sessions in the extension.
- G3. Every figure carries its basis (priced or Simulated), its price
  versions, and its coverage (sessions and turns analysed, the rest with
  reasons). Unknown is never 0.
- G4. Recommendations are text the user acts on. The extension may offer a
  Copy button; it opens nothing the existing `openSetting` allow-list does
  not already allow (D6).
- G5. Increment 2: `get_savings_report` MCP tool and a U18 view (U16 and U17 are reserved by [mcp-apps.md](mcp-apps.md) §11), following
  [mcp-apps.md](mcp-apps.md).

**Non-goals** (checked against vision §6)

- Changing settings, instruction files or MCP configuration. Read-only, as
  vision §6 requires.
- Predicting behaviour. A cheaper-model saving is a Phase 14 replay: it
  assumes the same conversation (assumption A1) and stays **Simulated**.
- Live prices. The bundled price book and the user's versions only.
- A grand total across opportunities (D4): they overlap (an unused tool is
  also part of every cache rebuild).
- Storing reports. Computed on request, never written.
- Advice on prompt content. No prompt or response text is read for this.
- Vision §6 lists the tool-call audit and the insights dashboard as the
  deliberate extensions. A savings report is a third one; vision.md needs
  that sentence (D1).

## 3. What exists and what this builds on

Each item below was read in the code on 2026-11-12.

| Capability | Where | Used for |
|---|---|---|
| Tool inventory per session: `ToolInventoryEntry { name, loaded, invokedInTurns }` | `packages/domain/src/tool-inventory-entry.ts`; built by `buildToolInventory` (`server/src/data-sources/jsonl/tool-inventory.ts`) for VS Code local and by `PiAgentLogProvider` for pi | O1 unused tools. Has no per-tool token count today |
| Tool definitions as one system-prompt component, `kind: "tool-definitions"`, label `Tool definitions (N tools)`, token count from `estimateTokenCount` over the raw tools file | `server/src/data-sources/jsonl/system-prompt-breakdown.ts`; raw JSON from `readToolDefinitionsRaw` (`prompt-artifact-reader.ts`) via `buildAnalyzeModeExtras` | O1: the raw JSON lets each tool be counted on its own (task SR2) |
| `contextOverhead.toolInventory` (`defined`, `loaded`, `invoked`, `neverInvoked`, capped at 50) | `server/src/services/cost/session-cost-builder.ts` | Same numbers, one session; O1 generalises it over a window |
| MCP tool recognition: `mcp__` or `mcp_` prefix → kind `mcp` | `resolveToolKind` in `services/tool-audit/tool-kind-resolver.ts` | O1 groups tools by MCP server |
| Request trace: one record per LLM request with `startedAt`, `model`, `uncachedInput`, `cacheRead`, `cacheWrite` (null when not logged), `output`, `event` (`compaction`, `clear`, `model-switch`) | `packages/domain/src/request-trace.ts`; `RequestTraceReader` / `canReadRequestTrace` in `data-sources/log-providers/log-provider.ts`; Claude Code and VS Code (local and Agent Host) implement it | O2, O3, O4 cache breaks |
| Cache lifetimes per vendor: `defaultTtlMinutes`, `extendedTtlMinutes`, `ttlMinutes`, `minCacheableTokens` | `cachingKindSchema` in `packages/domain/src/vendor-profile.ts`; profiles in `fixtures/vendor-profiles/` | O2 idle threshold |
| Tool-call audit: `failureRecoveryCost { recoveryRounds, affectedTurns, affectedTurnsInputTokens, affectedTurnsOutputTokens }`, `byFailureCategory`, `byShellProgram`, `retries` | `packages/domain/src/session-audit.ts`; `buildSessionAudit(session)` in `services/tool-audit/session-audit-builder.ts` | O5 failed calls |
| Turn cost figures: `billed`, `reported`, `priced`, each known or unknown with a reason; `preferredCostFigure` | `packages/domain/src/cost-figure.ts`; `TurnCostFigureBuilder.figuresFor` in `services/pricing/turn-cost-figures.ts` | Upper bounds for O5 |
| Pricing a usage at a model, channel and date: `CostPricer.price(PricingRequest)` | `services/pricing/cost-pricer.ts` | The counterfactual pricer (SR3) |
| Replay and compare: `SessionReplayService.replay` / `.compare`, self-check, coverage, A1–A5 | `services/session-replay/session-replay-service.ts`, wired once in `composition/create-session-replay.ts` | O6 cheaper model (Simulated) |
| Insights dataset: every provider's sessions loaded sequentially, bounded by `DEFAULT_ROLLUP_SESSION_LIMIT` (50) and `MAX_ROLLUP_SESSION_LIMIT` (500); `FindingDetector` strategies | `services/insights/insights-service.ts`, `finding-detector.ts`, `insights-dataset-builder.ts` | The loading pattern and the detector port shape |
| Findings: `kind` ∈ `security`, `anomaly`, `behavior-change`, `price-change`; `title`, `why`, `evidence` strings, no amounts | `insightFindingSchema` in `packages/domain/src/insights.ts`; MCP `list_findings` in `mcp/finding-tools.ts` | Compared in §5.1 |
| Dashboard tabs: Overview, Cost over time, Compare, Project (and Billing) | `web/src/components/insights/InsightsDashboard.tsx` | New Savings tab |
| AI-advice bundle (session metadata as JSON for an LLM, no message text) | `buildAdviceBundle` in `web/src/lib/build-advice-bundle.ts`; User Guide "Exporting an AI-advice bundle" | Later: include the report (D11) |
| Host commands `openSetting`, `copyToClipboard`, `openTextDocument`; `openSetting` limited to settings the config status warns about plus the two Copilot logging settings | `hostCommandSchema` in `packages/domain/src/rpc.ts`; `HostCommandHandler` in `vscode-extension/src/rpc/host-command-handler.ts`; threat-model §6 | G4, D6 |
| Product feature flags | `productFeaturesSchema` in `packages/domain/src/product-profile.ts` | New `savingsReport` flag |

## 4. The opportunities

All amounts are per week over the window (total ÷ weeks in the window,
D8), per currency (AI Credits for Copilot channels, USD otherwise; 1 AI
Credit = $0.01, no other rate).

### O1. Tools loaded but never used

- **Detect.** Over the window, each tool (and each MCP server, grouped by
  name prefix) that was loaded in S sessions and invoked in none of them.
- **Tokens.** Per-tool definition tokens: `estimateTokenCount` over that
  tool's JSON from the tools file (SR2). Labelled "estimate" (constraint 6
  exception: a local tokenizer over captured text).
- **Requests.** The number of LLM requests in those sessions, from the
  request trace, else `usage.roundsCount`, else unknown.
- **Saving range.** Low: tokens × requests × the model's cache-read price.
  High: tokens × requests × the uncached input price. Most requests read
  tool definitions from cache, so the low end is the likely one.
- **Action.** "Turn off the `<server>` MCP server (N tools, about T tokens
  each request) in the tool picker; none of its tools ran in S sessions
  over D days." Server grouping from a Copilot `mcp_` name is **inferred**
  (a server name can contain `_`; SR0 checks whether the tools file names
  the server).

### O2. Cache lost after an idle gap

- **Detect.** In the request trace, a request whose cache read fell short
  of the previous prompt by at least the threshold (D7), whose start came
  more than the vendor's TTL after the previous request's start, with no
  `compaction`, `clear` or `model-switch` event.
- **Lost tokens.** `min(prompt(i−1), prompt(i)) − cacheRead(i)`, where
  prompt = uncached + cache read + cache write (cache write null: uncached
  already holds it, as `PricingRequest.uncachedIncludesUnknownCacheWrite`).
- **Saving.** Upper bound: lost tokens × (the rate they were billed at −
  the cache-read rate). When cache writes are unknown, a range between the
  write and uncached rates. Low end 0: a break is not always avoidable.
- **Action.** "N breaks longer than the M-minute cache lifetime cost up to
  X to rebuild the context. Resuming a long session after a break resends
  all of it; a new session with a short summary, or `/compact` before the
  break, sends less." For Claude Code, also name the 1-hour cache option
  with its higher write price.

### O3. Cache lost with no idle gap (instructions or tools changed)

- **Detect.** As O2, but within the TTL and with no trace event.
- **Cause.** Shown as "not recorded in the log; usually an instructions
  file or the tool list changed, or the provider evicted the cache". It
  names "instructions changed" only where SR0 shows the log records it
  (VS Code local: a different `systemPromptFile` on a later `llm_request`
  span is the candidate signal; unverified).
- **Saving and action.** As O2. Action: "Edit instructions files and
  enable or disable tools between sessions, not during one."

### O4. Model switched mid-session

- **Detect.** Trace `event: "model-switch"` followed by a cache read below
  the threshold.
- **Saving.** As O2, upper bound.
- **Action.** "Pick the model when the session starts; a switch resent
  T tokens uncached N times."

### O5. Repeated failed tool calls

- **Detect.** From `buildSessionAudit` per session, grouped across the
  window by `failureCategory` and, for shell calls, by program.
- **Saving.** Upper bound only: the priced cost of `affectedTurns`. The
  audit reports affected turns, not rounds (its own constraint-6 note), so
  no lower bound is claimed; the figure reads "up to".
- **Action.** Per category, a fixed template, e.g. "`rg` was not found 14
  times in 6 sessions: install it, or say in your instructions file which
  search tool to use."

### O6. A cheaper model (Simulated)

- **Detect.** For the K most expensive replayable sessions (D5),
  `SessionReplayService.compare` on the candidate models.
- **Saving.** The replay's difference, labelled **Simulated**, with its
  self-check and coverage. Never ranked with O1–O5 (D3).
- **Action.** "This session would have cost about X on `<model>`
  (Simulated; replay matches the log on its own model for P% of requests).
  The other model would not have answered the same way."

## 5. Design (SOLID, CUPID)

### 5.1 A separate service, not a finding kind

Recommendation (D2): a new `services/savings` module, not a fifth
`findingKind`.

- **SRP.** A finding is a prompt to look: severity, title, why, evidence
  text. A saving is a quantity: a money range per currency, basis, price
  versions, coverage and an action. Putting amounts into `InsightFinding`
  gives that schema two reasons to change.
- **ISP.** `list_findings` callers and `FindingsTable` would get fields
  they never read, and the MCP output schema of `list_findings` would
  change for every client.
- **OCP.** Each opportunity is a `SavingsDetector` strategy, as
  `FindingDetector` is; a new opportunity is a new class.
- **DIP.** The service depends on narrow ports (session source, request
  trace reader, replay comparer, counterfactual pricer), not on
  `InsightsService` or `SessionReplayService` classes.
- **CUPID.** Composable (detectors take plain data and return plain data),
  Unix-like (one detector, one opportunity), predictable (pure detectors,
  golden tests), idiomatic (same zod-schema-first domain types and
  `create-*` composition as Phases 14 and 15), domain-based (names from
  the report's vocabulary: opportunity, saving, action).

### 5.2 Modules

| Module | Responsibility |
|---|---|
| `packages/domain/src/savings.ts` | `savingsOpportunityKindSchema` (`unused-tools`, `idle-cache-expiry`, `unexplained-cache-break`, `model-switch`, `failed-tool-calls`, `cheaper-model`); `savingsAmountSchema` (known: `currency`, `low`, `high`, `basis: "priced" \| "simulated"`, `label: "range" \| "upper-bound" \| "simulated"`, `priceVersionIds`; or unknown with a reason; `low ≤ high` refined); `savingsOpportunitySchema` (key, kind, subject, sessions, evidence counts and tokens, amounts per week and per window, coverage, action template id and parameters, `inferred` flag); `savingsReportSchema` (window, pricing mode, ranked opportunities, simulated opportunities, not analysed with reasons) |
| `packages/domain/src/savings-actions.ts` | `savingsActionText(kind, params)`: fixed templates; parameters are numbers, model ids and bounded names only |
| `packages/domain/src/tool-inventory-entry.ts` | Optional `definitionTokens: TokenCount` (additive) |
| `server/src/services/savings/savings-detector.ts` | `SavingsDetector` port and `SavingsInput` (sessions, traces, audits, pricer, window) |
| `server/src/services/savings/counterfactual-pricer.ts` | `CounterfactualPricer`: prices N tokens as one token type versus another for a model, channel and date through `CostPricer.price` with a synthetic `TurnUsage`; returns a range or unknown with the reason |
| `server/src/services/savings/cache-break-classifier.ts` | Pure: request trace + vendor caching rules → breaks classified `idle-expiry`, `model-switch`, `compaction` (left out: intended), `unexplained`, each with lost tokens and gap |
| `server/src/services/savings/detectors/*.ts` | `UnusedToolsDetector`, `CacheBreakDetector` (O2–O4 over the classifier), `FailedCallsDetector`, `CheaperModelDetector` (over a `ReplayComparer` port) |
| `server/src/services/savings/savings-ranker.ts` | Pure: order by D3's key; Simulated kept apart |
| `server/src/services/savings/savings-service.ts` | `SavingsService.report(filter, options, signal)`: loads sessions like `InsightsService.load` (sequential, bounded), reads traces where `canReadRequestTrace`, builds audits, runs detectors, ranks |
| `server/src/composition/create-savings-report.ts` | One wiring for the app, its MCP server, the extension and its MCP server (as `create-session-replay.ts`) |
| `server/src/services/savings/savings-query-params.ts` | zod query schemas shared by HTTP, RPC and MCP |
| `web/src/components/insights/SavingsTab.tsx`, `web/src/lib/savings/*` | The Dashboard tab, opportunity rows, detail panel, Copy action |
| `server/src/mcp/savings-tools.ts` (Increment 2) | `get_savings_report`, tool group `savings` |
| `packages/mcp-apps/src/views/SavingsView.tsx`, `view-models/to-savings-view-model.ts` (Increment 2) | U18 |

### 5.3 Surfaces

- **HTTP.** `GET /api/savings?since&until&provider&pricing&includeSimulated`.
  GET only, behind the loopback host guard.
- **RPC.** `getSavingsReport` in `domain/rpc.ts` with a result schema
  (as `getSessionReplay`); the extension's dispatcher routes it.
- **Feature flag.** `ProductFeatures.savingsReport`: on when the backend
  has a price book (both products).
- **Web.** A Savings tab in the Dashboard: ranked rows (kind, subject,
  "up to"/range per week, coverage tag), a detail panel (evidence,
  sessions with links into Analyze, the action text, Copy), a separate
  "Simulated" section, and a "Not analysed" list with reasons.
- **Extension.** The same tab in the webview; Copilot sessions only.
  Copy uses the existing `copyToClipboard` host command.

## 6. What each provider gives

| Opportunity | VS Code local | Agent Host | Claude Code | pi | mitmproxy |
|---|---|---|---|---|---|
| O1 unused tools | Yes, with debug logging (tools file) | Unverified (SR0) | No: the log records invoked tools only | Total only, via the sidecar; per tool unverified | No tool inventory |
| O2–O4 cache breaks | Yes (trace; writes inferred without `agent-traces.db`) | Yes (trace) | Yes (trace) | No trace yet (Phase 14 D1) | No trace yet |
| O5 failed calls | Yes, where outcomes are logged ([tool-call-audit.md](tool-call-audit.md) §5) | No: tool calls unknown | Yes | Per audit §5 | Per audit §5 |
| O6 cheaper model | Yes | Yes | Yes | No | No |

A provider or session that cannot give an opportunity appears under "Not
analysed" with the reason, never as a saving of 0.

## 7. Honesty rules

- Every amount is `priced` (a counterfactual cannot be billed) or
  `simulated`, and shows its price versions on demand.
- An amount is a range ("X–Y a week") or an upper bound ("up to Y a
  week"); never a bare number.
- Coverage on every row: "38 of 41 sessions; 3 had no request trace".
- The labels "estimate", "inferred", "up to" and "Simulated" come from the
  view model, not CSS, and a test asserts them (as mcp-apps.md §6).
- Action text is a suggestion in the second person; it never says the app
  changed anything.
- O6 always carries the A1 sentence and the self-check.

## 8. MCP tool and view (Increment 2)

- **Tool.** `get_savings_report` (read-only annotations, output schema),
  arguments `since`, `until`, `provider`, `pricing`, `limit` (≤ 20
  opportunities), `includeSimulated` (default false: a replay per session
  is the costly part). Group `savings` in `MCP_TOOL_GROUPS`, both servers.
  Model-visible tools: standalone 21 → 22, extension 19 → 20.
- **What goes to the model.** Kinds, amounts with basis, label, coverage
  and price version ids; session ids; model ids; tool, MCP server and
  program names passed through `redactSecrets` and `excerptOf` with a
  fixed cap; the fixed action text. Never prompts, responses, file
  contents or paths (instruction files by base name only).
- **Prompt.** `review_costs` calls `get_savings_report` first and explains
  its rows, instead of ranking from rollups itself.
- **View U18 `SavingsView`.** Added to `APP_VIEW_TOOL_NAMES`
  (`server/src/mcp/apps/register-app-views.ts`) and the router. Shows the
  ranked rows and the Simulated section. Drill-down: `get_session_cost`
  (U1 in place) and `replay_session` (U12 in place), with ids and plain
  model ids from `structuredContent` only. The only message is the
  existing `Analyse session <id>` through `AskAboutSession.tsx`. No new
  `sendMessage` site, no `updateModelContext`, no `openLink`.
  `test/security/no-forwarding.test.ts` names the new files.

## 9. Mock-ups

Boards in `docs/plans/mockups/savings-report/`, `.dc.html` format as
`mockups/session-replay/`, approved by the owner before any UI code
(task SR11; U18 boards in SR18, as A0b/A17b/A25b).

| Board | Shows |
|---|---|
| `Dashboard` | Standalone Savings tab: ranked rows, range and "up to" forms, coverage tags, the Simulated section, Not analysed |
| `Detail` | One opportunity: evidence, sessions, price versions, action text with Copy, "inferred" grouping |
| `States` | Loading with Cancel, no trace for a provider, Claude Code with no tool inventory, every amount unknown, empty window, error with Retry |
| `VsCode` | The extension's panel, compact width, Dark Modern, Light Modern, High Contrast |
| `U18` (Increment 2) | VS Code Copilot Chat and Claude Desktop frames, light and dark, drill-down into U1 and U12 |

## 10. Tasks

TDD in every task: the failing test first (architecture.md §11.4).
Fixture-driven golden tests for every detector. No local model in this
repo.

**Increment 1: the report in both products**

| ID | Work | Exit criterion | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| SR0 | Spike (1 day, no merge): over the owner's own local logs, check (a) whether VS Code local's `systemPromptFile`/`toolsFile` changes within a session when instructions or tools change, (b) whether Copilot's tools file names the MCP server, (c) whether Agent Host sessions carry a tool inventory, (d) whether Claude Code records loaded MCP tools or `CLAUDE.md` changes. Reads local files only; runs no chat | Answers recorded in this plan's §4 and §6; unverified marks removed or kept | medium | Sonnet | — |
| SR1 | Domain: `savings.ts` schemas and types; failing tests for range, upper bound, simulated, unknown with reason, `low > high` rejected, simulated without its label rejected | `npm run typecheck` and domain tests green | medium | Sonnet | — |
| SR2 | `ToolInventoryEntry.definitionTokens` for VS Code local (per tool from `readToolDefinitionsRaw` through `estimateTokenCount`) and pi where its sidecar allows; test first with a tools-file fixture and a missing-file case (unknown with reason) | Session fixtures carry per-tool estimated tokens; existing Tools tab tests unchanged | medium | Sonnet | SR0, SR1 |
| SR3 | `CounterfactualPricer` over `CostPricer`: tests for Anthropic API and GitHub Copilot channels, a model with no price on the date (unknown with reason), unknown cache writes (range) | Golden figures match hand-computed price-book values | medium | Sonnet | SR1 |
| SR4 | `cache-break-classifier.ts`: tests over Claude Code and Copilot traces for idle expiry, model switch, compaction (excluded), unexplained, short prompts under `minCacheableTokens`, start-to-start gap caveat | Golden classification over the request-trace fixtures that `session-replay.golden.test.ts` replays | high | Opus | SR1, D7 |
| SR5 | `UnusedToolsDetector` across the window, MCP server grouping (`mcp__` exact, `mcp_` inferred) | Golden report on a multi-session fixture | medium | Sonnet | SR2, SR3 |
| SR6 | `CacheBreakDetector` (O2–O4) on SR4 and SR3 | Golden report; unknown traces in Not analysed | medium | Sonnet | SR3, SR4 |
| SR7 | `FailedCallsDetector` over `buildSessionAudit`, grouped by category and program, upper bound from turn cost figures | Golden report; Agent Host sessions in Not analysed | medium | Sonnet | SR1, SR3 |
| SR8 | `CheaperModelDetector` over a `ReplayComparer` port (fake in tests), carrying self-check, coverage and A1 | Simulated opportunities never enter the ranked list (test) | medium | Sonnet | SR1, D5 |
| SR9 | `savingsActionText` templates; tests that every parameter is a number, model id or capped name and that no template claims a change was made | Template tests green; wording reviewed by the owner in SR11 | low | Sonnet | SR1 |
| SR10 | `SavingsRanker`, `SavingsService` (bounded, cancellable through `AbortSignal`), `create-savings-report.ts` | Service test over all detectors with fakes; one wiring used by both products | high | Opus | SR5–SR9 |
| SR11 | Mock-ups (§9 boards except U18) and the owner's approval | Boards in `docs/plans/mockups/savings-report/`, approved | medium | Sonnet (frontend-design skill) + owner | SR1, SR9 |
| SR12 | HTTP route, RPC method with result schema, extension dispatcher, `ProductFeatures.savingsReport`; `app.savings.test.ts` (GET only, 400 on bad query, loopback guard) | Route, RPC and dispatcher tests green | medium | Sonnet | SR10 |
| SR13 | Test fixtures for the e2e homes: a Claude Code session with an idle gap and a model switch, a VS Code local session with an unused MCP server and failed `rg` calls | Fixtures load in `web-e2e` and `extension-ui` homes; server golden test over them | medium | Sonnet | SR10 |
| SR14 | Web: `SavingsTab`, detail, Simulated section, Not analysed, Copy, links into Analyze; component, axe (four theme fixtures) and keyboard tests | Matches the SR11 boards; labels asserted | medium | Sonnet | SR11, SR12 |
| SR15 | UI specs: Playwright `web-e2e` `sv1-savings-report.spec.ts` (every figure equals the API, labels present, axe); wdio `extension-ui` `sv1-savings.e2e.ts` (three themes, compact width, Copy) | Both specs pass in CI; no manual checklist row | medium | Sonnet | SR13, SR14 |
| SR16 | Accessibility and security review (hostile tool and program names in every field, no write path, unknown never 0, labels not droppable) | Findings fixed test-first; results in this plan | medium | Opus | SR14 |
| SR17 | Docs: User Guide "Savings report", extension guide, root and extension CHANGELOG `[Unreleased]`, architecture.md (§4.1/§4.2 rows, §5 types, a new §6 data-flow section, §8 route and RPC, §11.2), vision.md §3.2 and §6 (D1), threat-model.md (§11), implementation-plan.md phase section, Gantt | Docs match the code; owner review | medium | Sonnet | SR16 |

**Increment 2: MCP tool and view** (starts after Increment 1 is released)

| ID | Work | Exit criterion | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| SR18 | U18 mock-ups in both host frames, light and dark, with states | Boards approved by the owner | medium | Sonnet (frontend-design skill) + owner | SR17 |
| SR19 | `get_savings_report` in `mcp/savings-tools.ts`, group `savings`, both servers; `mcp/security.test.ts` covers it; `review_costs` updated; tool counts updated in tests; the tool and the prompt declare arguments as `z.object(...)` (SDK 2); the tool-list snapshots (`packages/server/src/mcp/__snapshots__/tool-list-standalone.json` and `packages/vscode-extension/src/mcp/__snapshots__/tool-list-extension.json`) updated on purpose | In-memory client tests green; Claude Code CLI text answer unchanged in shape | medium | Sonnet | SR10 |
| SR20 | `toSavingsViewModel`, `SavingsView` (U18), router, `APP_VIEW_TOOL_NAMES`, no-forwarding allow-list (`get_session_cost`, `replay_session`), component, axe, keyboard, hostile-text tests; if ext-apps is on 2.1 or later by then, `webMcpBridge: false` and its test ([mcp-sdk-2-migration.md](mcp-sdk-2-migration.md) §9a) | Bundle stays under the 1.2 MiB budget (742 KB before U18, ext-apps 2.0.4) | medium | Sonnet | SR18, SR19 |
| SR21 | UI specs: Playwright fake host `packages/mcp-apps/e2e/specs/u18-savings.spec.ts` (Claude light and dark); wdio real-Copilot row for U18 in the G4 suite (run by the owner before tagging, release-ui-gate D1, D12 cap) | G5 spec passes in CI; G4 spec written and typechecks | medium | Sonnet | SR20 |
| SR22 | Review (as A32) and docs: architecture.md §4.1.1/§4.4, threat-model §6.1, both guides' MCP sections, both CHANGELOGs, Gantt | Docs match the code | medium | Opus | SR21 |

## 11. Threat-model rows to add

| Surface | Threat | Planned mitigation |
|---|---|---|
| `GET /api/savings`, RPC `getSavingsReport` | Information disclosure; denial of service through a large window or many replays | Loopback host guard; zod query (`savings-query-params.ts`); session cap from `MAX_ROLLUP_SESSION_LIMIT`; replay capped at K sessions × at most 3 models, off unless asked; cancellable |
| Log-derived names in the report (tool, MCP server, program, instruction file) | Prompt injection or markup through a crafted name; a secret in a command name | Rendered as text; `redactSecrets` and a length cap; base names only, no paths; hostile-text tests in web and U18 |
| Copy action (extension and web) | Copying attacker-chosen text the user then runs | Copies the fixed template with parameters folded to one line, control characters removed, capped (as the copy-title row in §6.1) |
| `openSetting` | Widening the editor surface | Unchanged if D6 is taken; any new setting id is a fixed list in `HostCommandHandler` with its own row |
| MCP `get_savings_report` | Log content to a hosted model | Numbers, ids, model ids and capped redacted names only; covered by `mcp/security.test.ts` |
| U18 view | Relaying logged text into the chat | No new `sendMessage` site; drill-down arguments are ids from `structuredContent`; no-forwarding test |

## 12. Owner decisions

| # | Decision | Recommendation |
|---|---|---|
| D1 | Admit the savings report into vision §6 as a third deliberate extension | **Accepted 2026-11-12:** Yes, with the sentence "recommendations are text; the app never changes settings or files" |
| D2 | New finding kind or separate service | **Accepted 2026-11-12:** Separate `services/savings` (§5.1); no `saving` finding kind in v1 |
| D3 | Ranking key | **Accepted 2026-11-12:** The high end ("up to"), low end shown beside it; Simulated opportunities in their own unranked section |
| D4 | A grand total of savings | **Accepted 2026-11-12:** None: opportunities overlap |
| D5 | Cheaper-model scope | **Accepted 2026-11-12:** Top 5 sessions by cost, up to 3 cheaper documented models from the same vendor at list price; off by default in MCP |
| D6 | Widen `openSetting` for actions | **Accepted 2026-11-12:** No in v1; text and Copy only |
| D7 | Cache-break threshold | **Accepted 2026-11-12:** Lost tokens ≥ the vendor's `minCacheableTokens` and ≥ 50% of the previous prompt |
| D8 | Default window and unit | **Accepted 2026-11-12:** 30 days, amounts per week |
| D9 | Phase number and order | **Accepted 2026-11-12:** Next free phase number after the open local drafts are ordered; Increment 2 after Increment 1 ships |
| D10 | Extension parity | **Accepted 2026-11-12:** Same tab, Copilot sessions only |
| D11 | Include the report in the AI-advice bundle | **Accepted 2026-11-12:** Later, not in v1 |
| D12 | Per-tool token counts from the local tokenizer | **Accepted 2026-11-12:** Accept, labelled "estimate" (constraint 6 exception) |

## 13. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Users read "up to" as a promise | Trust lost when the bill does not drop | Range or "up to" wording everywhere; the A1 sentence on O6; SR11 copy review |
| Start-to-start gaps overstate idle time (a long request looks idle) | A break classed as idle that was not | Caveat in the classifier; requests longer than the TTL flagged in SR4 tests |
| The tokenizer differs from the vendor's | O1 tokens off by some percent | "estimate" label; range already wide |
| `mcp_` server grouping wrong | Advice names the wrong server | "inferred" label; SR0 checks the tools file |
| Report latency: two parses per session plus replays | Slow tab, slow MCP answer | Sequential bounded loads, replay off by default in MCP, Cancel in the UI |
| Overlapping opportunities double counted | Inflated sense of saving | No grand total (D4); detail says what overlaps |
| Claude Code has no tool inventory | O1 missing for the main standalone provider | Shown under Not analysed with the reason |
| Price book gaps for a model or date | Unknown amounts | Unknown with the price book's reason, never 0 |

## 14. Exit criterion

On the owner's machine, over 30 days of real Claude Code and Copilot
sessions: the Savings tab in both products and (after Increment 2)
`get_savings_report` list the same ranked opportunities, each amount
labelled with its basis, range or "up to", and coverage; the owner checks
one idle-expiry break and one unused tool by hand against the turn's
tokens and the price book and finds them equal within rounding; and the
app writes no file and changes no setting.
