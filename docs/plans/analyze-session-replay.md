# Phase 14: Replay a real Analyze session on another model

**Status (2026-11-07): planned.** The owner decided D1, D2, D4, D5 and D7
on 2026-11-07; D3, D6 and D8 take the recommendation, open for the owner to
revisit (§11). Steps 14.0 (threat-model rows), 14.1 (domain schemas) and
14.2 (request traces), 14.3 (the scripter), 14.4 (the replay service) and
14.5 (routes, RPC and MCP) are done (2026-11-07); step 14.6's mock-ups are
drawn and approved by the owner (2026-11-07); step 14.7 (the UI) is next.

The question this answers: **"What would this real session have cost on
another model?"** It reuses Phase 13's simulator
([vendor-aware-learn-simulation.md](vendor-aware-learn-simulation.md),
decision D18 there) on the token shape of a session the user really ran.
The measured figures always stay next to the replay, and the replay is
labelled **Simulated** (implementation-plan.md, Phase 14).

## Contents

1. Context
2. Goals and non-goals
3. What the user sees
4. How a replay works
5. What each provider gives
6. Assumptions a replay makes
7. Pricing and currency
8. Architecture (SOLID)
9. API, RPC and MCP
10. Testing, privacy, risks
11. Decisions
12. Implementation steps (TDD, each with an exit criterion)
13. Exit criterion

## 1. Context

- **Phase 13** built a simulator that, given a `ScenarioScript` (per step:
  idle gap, new tokens by kind, output, events), a vendor profile and a
  model, decides each request's cache read, write and miss from that
  vendor's documented rules and prices it from the profile (USD per million
  tokens; AI Credits = USD × 100). It runs Learn mode's 18 scripts.
- **Step 13.5a** already turns real logs into scripts: `scriptFromCapture`
  (`services/learn-simulation/calibration/replay.ts`) takes one request
  series (gap, uncached, cache read, cache write, output) and derives each
  step's new tokens. Over 15,320 real Claude Code requests the simulator
  agreed with the recorded cache reads in 99.8% of requests
  ([learn-calibration-findings.md](learn-calibration-findings.md)).
  Phase 14 is that path, made general, run on any Analyze session, with the
  target model chosen by the user.
- **Phase 15** priced turns from a dated price book and left "estimate on
  another model" to this phase (its decision D17).

## 2. Goals and non-goals

**Goals**

- G1. For one Analyze session, replay it on a chosen model (any model a
  vendor profile documents caching for) and show per turn and in total what
  it would have cost, beside what it did cost.
- G2. Compare one session across several models at once (as Learn's
  Vendors tab does for a scenario).
- G3. Say plainly what a replay can't know (§6) and how much of the session
  it covers; never invent a figure for a turn whose tokens are unknown.
- G4. A self-check: replaying a session on **its own model** must reproduce
  the measured cache reads within Phase 13's tolerance (D12 there: hit/miss
  exact, read within 5%). It is the evidence the replay of other models
  rests on, shown in the UI as "Replay matches the log on <model>: 98% of
  requests".

**Non-goals**

- Predicting how a different model would have *behaved*: more or fewer
  turns, longer or shorter answers, different tool calls. The replay keeps
  the session's shape; only caching and prices change (§6).
- Re-tokenising text for another vendor's tokenizer (no content is read;
  §6 A2).
- Live prices: the vendor profiles' and price book's sourced prices only.
- Writing anything: a replay is computed on request and never stored.

## 3. What the user sees

In Analyze mode, with a session open (the standalone app and the
extension, D5):

- A **Replay on** model picker beside the session title, the same
  component as Learn's `VendorPicker` (vendors with undocumented caching
  listed, disabled, with the reason, Phase 13 D1).
- Choosing a model adds **Simulated** columns to the turns table next to
  the measured ones: cache outcome, cache read, AI Credits (and USD on
  hover). Measured columns stay as they are; the simulated ones carry a
  "Simulated" header badge and a dashed cell style, readable in every theme.
- A **summary card**: measured total, simulated total, the difference, the
  coverage ("38 of 40 turns replayed; 2 had no token data"), the self-check
  result, and the assumptions (§6) behind a disclosure, with sources.
- A **Compare models** view (D4): the session's total on its own model and
  on each vendor's default model plus any the user adds, as a table with a
  bar per model; unknowns as "unknown", never 0.

Mock-ups are drawn and approved before UI code starts (as Phase 15's step
15.8), following the Industry design system and the VS Code themes.

## 4. How a replay works

1. **Request trace.** The provider's log, reduced to one record per LLM
   request in the session's main chain: time, model, uncached input, cache
   read, cache write (and 1-hour writes), output, reasoning. No text. A
   Copilot or Claude Code "turn" is several requests (`Turn.usage.roundsCount`),
   so a per-turn sum isn't enough: cache reads happen between requests.
2. **Script.** `RequestTraceScripter` turns the trace into a
   `ScenarioScript`, generalising `scriptFromCapture`:
   - new tokens per request = this input − previous input − previous output;
   - a **shrinking prompt** (negative delta) becomes a `compaction` event
     with the new prompt as its summary, or `clear` when the turn's
     `triggeredEvent` says so (13.5a skipped these 17 sessions; replay
     can't);
   - a **model change** becomes `model-switch`;
   - 1-hour cache writes become `extended-ttl`;
   - sub-agent (sidechain) requests are left out of the main chain and
     reported as not replayed (D6).
3. **Simulate.** `simulateScenario(script, { profile, modelId, harness })`
   as in Learn, with the session's harness (`claude-code`, `vscode-local`,
   `copilot-agent-host`) so harness cache defaults apply (Phase 13's 1-hour
   Claude Code decision).
4. **Align.** Simulated requests are summed back into the session's turns,
   so each turn row has its measured and simulated figures side by side.
5. **Self-check.** The same script on the session's own model, compared
   request by request with the trace (G4).

## 5. What each provider gives

| Provider | Per-request trace | Cache write | Gaps | Replayable |
|---|---|---|---|---|
| Claude Code | Yes, every assistant message's `usage` (13.5a extractor) | Yes, incl. 1-hour | Yes | Fully |
| Copilot, Agent Host | Yes, the Copilot CLI event log's usage records (10.15) | Usually | Yes | Fully |
| Copilot, local harness | Yes, `main.jsonl` request spans (13.5a extractor) | Only with `agent-traces.db` | Yes | Yes; cache writes inferred when absent (§6 A4) |
| pi | Yes, per assistant message | Yes | Yes | Yes (pi has no real capture yet: Phase 11) |
| mitmproxy | Yes, one exchange per request | Per vendor decoder | Yes | Yes, for decoded exchanges |

A session (or request) with unknown input or output tokens can't be
replayed; it's counted in the coverage with its reason (constraint 6).

## 6. Assumptions a replay makes

Each is shown with the replay, worded for a person, with its confidence.

- **A1. Same conversation.** The other model is given the same prompts and
  answers with the same number of output and reasoning tokens. (It wouldn't:
  it's the comparison's main caveat.)
- **A2. Same token counts.** The session's token counts are kept as they
  are, though another vendor's tokenizer would count the same text
  differently (no content is read to re-count it, and no vendor publishes a
  conversion we could cite). D3's option (b) adds a per-vendor factor where one is
  documented.
- **A3. Cold start.** The first request reads nothing from cache, though in
  reality other sessions may have left the tools and system prompt warm
  (13.5a's cross-session finding).
- **A4. Inferred cache writes.** Where the log records no writes (Copilot
  local without `agent-traces.db`), writes are what the rules say they'd be.
- **A5. Same harness.** The session's harness (tool definitions, cache
  breakpoints, lifetime defaults) is kept; only the model and its vendor's
  rules change.

## 7. Pricing and currency

Phase 13's profiles price from GitHub's Copilot price table (USD per
million tokens, shown as AI Credits). Phase 15's price book adds dated API
prices. A Claude Code user pays API or subscription prices, not Copilot's.
D2 decides which price a replay uses: the **channel
the session used** (Copilot sessions at Copilot prices, Claude Code and
API sessions at the vendor's API price from the price book, as of the
session's date), with the other one available as a switch.

## 8. Architecture (SOLID)

New code goes in `packages/server/src/services/session-replay/`:

- `RequestTrace` (domain schema): numbers only, per request.
- `RequestTraceSource` port, one adapter per provider, built from the two
  13.5a extractors (moved out of `calibration/`, which then uses them),
  plus pi, Agent Host and mitmproxy. Providers already read these files;
  the adapters reuse their readers (ISP: a narrow `readRequestTrace(id)`).
- `RequestTraceScripter` (pure): trace → `ScenarioScript`, with the events
  of §4.2. Replaces `scriptFromCapture`.
- `ReplayAligner` (pure): simulated requests → turns, with coverage.
- `SessionReplayService`: trace source + scripter + simulator + aligner +
  self-check, behind `ApiService`. Depends on ports only (DIP), so tests
  pass fakes.
- Domain `SessionReplay`: per-turn measured and simulated figures, totals,
  coverage, self-check, assumptions with sources, the model and price basis.

No change to the simulator's rules: a replay that disagrees with a log is
fixed in the rules or an assumption, as in 13.5a, never by special-casing.

## 9. API, RPC and MCP

- `GET /api/sessions/:id/replay?model&pricing&provider` → `SessionReplay`.
- `GET /api/sessions/:id/replay/compare?models&pricing&provider` → the
  session's total on each model, with coverage.
- Webview RPC methods with the same names, in the extension (D5).
- MCP (D7): `replay_session` (one model) and `compare_models_for_session`,
  read-only, with output schemas, in a new `replay` tool group; and Phase
  15's `estimate_cost` gains an optional `model` (its D17), estimating at
  that model's simulated cost per active day.

## 10. Testing, privacy, risks

- **TDD**, per architecture.md §11.4: the scripter and aligner pure and
  property-tested (totals conserved, unknowns never 0); golden replays of
  the 13.5a fixtures; the self-check over every calibration fixture must
  pass at D12's tolerance (the phase's main evidence).
- **Usage scenarios** (as Phase 15 §12.4): replay a fixture session on two
  models in the standalone app (Playwright) and in the extension (wdio).
- **Privacy**: traces hold numbers only; nothing is written; the MCP tools
  return no text and redact paths as Phase 15's do.
- **Limits** (threat-model.md §4, step 14.0): `model`/`models` must be a
  vendor profile's model ids (400 otherwise), at most 10 models per compare,
  and a trace over 20,000 requests is refused with a reason. Tests for each
  come with the step that adds the route, RPC method or tool.
- **Risks**: the main one is over-trust. A replay can look precise while A1
  and A2 dominate the error. Mitigations: the Simulated label, the
  assumptions shown by default the first time, the self-check result, and
  wording that says "would have cost about".

## 11. Decisions

The owner answered D1, D2, D4, D5 and D7 on 2026-11-07, each with the
recommended option. D3, D6 and D8 weren't asked: they take the
recommendation and stay open for the owner to revisit.

| # | Question | Options considered | Decided |
|---|---|---|---|
| D1 | Which providers first? | (a) Claude Code and Copilot (both harnesses); (b) all five | **(a)** (owner, 2026-11-07): both are calibrated (13.5a); pi waits for Phase 11's real capture, mitmproxy follows |
| D2 | Price basis | (a) the session's own channel (Copilot or API, as of its date); (b) Copilot price table always; (c) API prices always | **(a)**, with a switch to the other (owner, 2026-11-07) |
| D3 | Tokenizer differences | (a) keep counts, state the assumption; (b) a sourced per-vendor factor; (c) show a ± range | **(a)** now; (b) only where a vendor documents a ratio (recommendation; owner may revisit) |
| D4 | Views | (a) Replay on one model, in the turns table; (b) plus Compare models | **(b)** (owner, 2026-11-07) |
| D5 | Products | (a) standalone first; (b) both at once | **(b)** (owner, 2026-11-07) |
| D6 | Sub-agents | (a) main chain only, sub-agents counted as not replayed; (b) replay each sub-agent chain separately | **(a)** first; (b) later (recommendation; owner may revisit) |
| D7 | MCP | (a) none yet; (b) `replay_session` and `compare_models_for_session`; (c) (b) plus `estimate_cost` with `model` | **(c)** (owner, 2026-11-07): closes Phase 15's D17 |
| D8 | Self-check visibility | (a) shown in the summary card; (b) only in tests | **(a)** (recommendation; owner may revisit) |

## 12. Implementation steps (TDD, each with an exit criterion)

| Step | Work | Exit criterion |
|---|---|---|
| 14.0 | Decisions D1–D8 (§11, recorded 2026-11-07); threat-model rows for the new read routes, RPC methods and MCP tools | Threat model updated. Done 2026-11-07: §4 and §6 rows and the §9 bullet, marked "plan" |
| 14.1 | Domain `RequestTrace` and `SessionReplay` schemas | Schema tests pass. Done 2026-11-07: `request-trace.ts` (strict records, numbers only; indexes, times and turns never go back; 1-hour writes within all writes; untraced turns with reasons) and `session-replay.ts` (always `simulated: true`; a turn is replayed or has a reason; unknown totals null, never 0, with the difference null too; coverage and the self-check bounded; at most 10 compared models); 18 tests |
| 14.2 | `RequestTraceSource` for Claude Code and Copilot (local and Agent Host), the 13.5a extractors moved and reused | Each provider's fixture gives the expected trace; calibration tests unchanged. Done 2026-11-07, see the note below |
| 14.3 | `RequestTraceScripter` with compaction, clear, model switch and 1-hour events; replaces `scriptFromCapture` | Property tests; the 17 shrinking-prompt sessions' shapes replay without error; calibration still 99.8%. Done 2026-11-07, see the note below |
| 14.4 | `ReplayAligner`, `SessionReplayService`, self-check, pricing per D2 | Golden replays of the fixtures; self-check passes at D12 on every calibration fixture. Done 2026-11-07, see the note below |
| 14.5 | API routes, RPC, MCP tools (per D7) | Route, RPC and MCP tests (schemas, read-only, redaction). Done 2026-11-07, see the note below |
| 14.6 | Mock-ups (Replay on, Simulated columns, summary card, Compare models) in both products' themes | Owner approves the boards. Done 2026-11-07: drawn and approved by the owner, see the note below |
| 14.7 | UI in the standalone app and the extension (per D4, D5) | Component, axe and keyboard tests; UI check in three VS Code themes; usage scenarios pass in `web-e2e` and `extension-ui` |
| 14.8 | Docs: architecture.md, User Guide, extension guide, vision | Owner reviews |

### 12.1 Step notes

**14.2 (done 2026-11-07).** Request traces for Claude Code and both Copilot
harnesses.

- **Port.** `RequestTraceReader` is an optional `LogProvider` capability
  (`canReadRequestTrace`, ISP), implemented by `ClaudeCodeLogProvider` and
  `VscodeLogProvider` (classic store first, then Agent Host through an
  optional `CopilotSessionSource.readRequestTrace`). pi and mitmproxy don't
  implement it (D1).
- **Same turns as the session.** Each trace reuses its provider's own turn
  building: Claude Code's active branch, turn grouping and rounds;
  the local harness's debug-log alignment to the store
  (`alignLogTurnsToStore`, store rows plus placed log turns); Agent Host's
  `segmentCopilotTurns`, as the turn inspector. A test per provider checks
  the trace's turns against `readSession`'s.
- **Builders** (pure, tested over the providers' fixtures):
  `buildClaudeCodeRequestTrace`, `buildLocalRequestTrace`
  (`data-sources/jsonl/`), `buildAgentHostRequestTrace`
  (`services/session-enricher/`).
  - A turn is traced whole or not at all, and an untraced turn keeps its
    reason: no usage, no request, not in the debug log, a log turn that
    can't be placed, or a turn the matcher couldn't place.
  - Times are kept in order, and a model change is a `model-switch` event.
  - Sub-agent calls are left out of the main chain (D6).
- **Domain change.** `TraceRequest.cacheWrite` is nullable. Copilot's local
  harness records no writes without `agent-traces.db`, and Agent Host flags
  unreliable writes (`cacheDetailsReported: false`). Then the writes stay in
  `uncachedInput` and step 14.3 infers them (A4), rather than a made-up 0.
- **Deviation from the plan.** The 13.5a calibration extractors are not
  moved. They read whole files across branches and store 5-minute and
  1-hour writes separately, while a trace follows the session's active
  branch and turns with the 1-hour writes inside all writes. Reusing them
  would have changed calibration; the traces reuse the providers' readers
  instead, and calibration is unchanged (its 25 tests pass).

**14.3 (done 2026-11-07).** `scriptFromRequestTrace` (and the injectable
`RequestTraceScripter`) in `services/session-replay/request-trace-scripter.ts`.

- **Rules.** Input = uncached + read + write (a null write is already in the
  uncached input, A4); carried output = output − reasoning (reasoning is
  billed, never carried). New tokens = this input − previous input −
  previous carried output. A `clear` event goes on its own request; a shrink
  or a `compaction` event puts `compaction {summaryTokens}` on the request
  before (the simulator applies it after that request). The static prefix is
  the smallest prompt the messages were ever reset to (never more than the
  first prompt), split half tools, half system as 13.5a did. A model change
  is read from the model id (first model primary, any other cheaper);
  `extended-ttl` starts on the first request with 1-hour writes.
- **Tests.** 23: examples for each rule and fast-check properties (the
  script parses; simulated, it never throws and every request's input is
  the trace's exactly; no shrink gives no compaction or clear; gaps
  round-trip). Calibration replays its captures through the scripter
  (`traceFromCapture`); `scriptFromCapture` is gone and `calibration.test.ts`
  is unchanged, with the same two known disagreements, so 13.5a's 99.8% holds.
- **The 17 shrinking-prompt sessions** are on the owner's machine, not in the
  repo. They were checked here against this machine's own real Claude Code
  logs instead (numbers only, nothing committed), which found three provider
  bugs, fixed in this step with the owner's go-ahead (2026-11-07):
  - a compaction's `compact_boundary` has `parentUuid: null`, so the branch,
    and with it Analyze and the trace, stopped at the latest compaction; the
    walk now follows `logicalParentUuid`, and the first request after the
    boundary carries a `compaction` event (the turn `triggeredEvent:
    "compaction"`);
  - `<synthetic>` assistant lines (all-zero usage) became fake requests and
    model switches; they are left out;
  - `isMeta` user lines opened a turn, splitting one response into two
    identical requests; they no longer do.

  After the fixes, a real 484-request session with a compaction replays
  without error on three models, every simulated input equals the log's,
  and on its own model the cache read is within 5% on 480 of 483 requests.
- **Open after 14.3.** A `/clear` inside a Claude Code file still starts the
  branch after it (no link back), and a file that begins with a compaction
  records no `compaction` event: both are recorded, not fixed. (The model-id
  mapping and model-switch pricing it also listed were settled in 14.4.)

**14.4 (done 2026-11-07).** `SessionReplayService` in
`services/session-replay/`, composing pure parts over narrow ports (DIP):

- **`ReplayModelResolver`.** A log's model id (`claude-opus-5-5`, a date
  suffix, `[1m]`, `copilot/`) resolves to a vendor profile's model through
  Phase 15's shared `candidateModelIds`; no near match is guessed, and a
  model whose caching is undocumented is refused (Phase 13 D1).
- **Model switches.** On a target model the whole session runs on that one
  model (`withoutModelSwitches`, A1/A5). The self-check keeps them: the
  simulator's new `cheaperModelId` option runs the "cheaper" role on the
  session's own second model. With three or more models, or a second model
  in another profile, the self-check is null (the roles can't hold them).
- **Pricing (D2), `ReplayPricer`.** Through Phase 15's `CostPricer` at each
  request's date, list prices only (a contract applies to real use).
  "Session channel" keeps a Copilot session on Copilot (AI Credits) and moves
  any other channel to the target vendor's API (USD). An unknown channel is
  `pricing.channel: null` with its reason, and nothing simulated is priced
  (constraint 6; the domain schema gained the reason). The simulator now
  reports 1-hour writes as `extendedCacheWrite`, so they are priced at the
  1-hour rate (no rule changed, no Learn golden moved).
- **Measured figures** are the session's preferred figure per turn, as
  `get_session_cost` gives it, converted to the replay's currency at the one
  documented rate (1 AI Credit = $0.01).
- **`alignReplay`.** Requests are summed into the session's turns; a turn
  with any unknown request is not replayed, with the reason. Totals compare
  like with like: both are over the same turns (replayed, with known measured
  and simulated cost), and the coverage gives the rest with reasons.
- **Self-check (G4, D8), `replaySelfCheck`.** Calibration's own check: the
  first request is not compared (A3), the outcome must match and the read be
  within 5%. Through the service, every calibration capture gives exactly
  calibration's result: three pass, and the two known disagreements
  (`claude-code-39e87ae3` request 14, `claude-code-2e4ad1d9` request 20,
  explained in `calibration.test.ts`) still disagree there, so "passes on
  every calibration fixture" holds except where calibration itself records a
  disagreement. Harness cache defaults (on for replays, off in calibration)
  change no capture's result.
- **Compare.** Any model no profile lists refuses the whole comparison; more
  than 10 models (the session's own included) is a validation error for
  14.5's 400. The measured total is the own-model replay's.
- **Limits.** A trace over 20,000 requests is not replayed. The longest real
  traces seen are 484 requests (this machine) and 52 (the calibration
  captures); a synthetic 20,000-request trace scripts and simulates in about
  0.15 s, so the cap stays as a bound, not a cost problem.
- **Goldens.** Eight replays over the Claude Code, Copilot local and Agent
  Host fixtures, each on its own model and two others (Haiku 5.5, GPT-6.1
  Sol), in `__golden__/`. The fixtures predate the price book, so the golden
  test shifts every time by one offset into 2026-10-21 (gaps and order
  unchanged, so caching is the same). The hand-written fixtures' tiny prompts
  (one under Sonnet 5's 1,024-token minimum) make some own-model self-checks
  fail, which is the rules being right about fixtures that aren't real logs;
  the real Copilot local log passes 3 of 3.

**14.5 (done 2026-11-07).** One wiring, `composition/create-session-replay.ts`,
in all four places (the standalone app and its MCP server, the extension
and its MCP server).

- **HTTP.** `GET /api/sessions/:id/replay?model&pricing&provider` and
  `/replay/compare?models&pricing&provider`, through `ApiService`'s
  `getSessionReplay` and `compareSessionReplay`. The query parsers
  (`services/session-replay/replay-query-params.ts`, model ids of at most
  100 characters, 1 to 10 models, the pricing enum) give HTTP, RPC and MCP
  the same messages. An unknown model or too many models is a 400; an
  unknown session, or one that can't be replayed (a provider with no
  traces, an empty trace, more than 20,000 requests), is a 404 with the
  reason: the shared error set has no 422, and this matches the system-prompt
  route's 404 for a session that lacks the artifact. GET only; no paths in
  any body; the loopback host guard applies (`app.replay.test.ts`).
- **RPC.** `getSessionReplay` and `compareSessionReplay` in `domain/rpc.ts`
  with strict params and, a first for the RPC table, result schemas
  (`apiMethodResultSchemas`) the web client parses answers with
  (`web/src/api-client/replay.ts`); the extension's dispatcher routes them
  to the same ApiService methods.
- **MCP (D7).** A `replay` tool group with `replay_session` and
  `compare_models_for_session` (read-only, domain output schemas, errors as
  tool errors with the reason), in both servers: 21 tools in the standalone
  server, 19 in the extension's. `estimate_cost` takes an optional `model`:
  the project's sessions in the window (at most 200) are replayed on it and
  each turn's priced figure is replaced by its simulated cost, then the
  unchanged estimate rules apply (D16, D18); the answer carries a
  `simulation` block (coverage, self-check counts, assumptions) and is
  priced as of each session's dates on its own channel (D2), not today.
  `GET /api/estimates` doesn't take `model` yet (only MCP was asked for, D7).
- **Tests.** Route, RPC, dispatcher, web client and MCP tests, and
  `mcp/security.test.ts` now runs its read-only and no-path/no-credential
  checks over the replay tools and `estimate_cost` with a model.

**14.6 (done 2026-11-07: drawn, and approved by the owner with no change
requests).** Five boards on a
Design canvas, **https://claude.ai/artifact/Qv3dWr3J3RybfDsAzTKUxM**
(private until the owner shares it from the page's Share menu; reviewers
comment on the canvas), with versioned copies in
[mockups/session-replay/](mockups/session-replay/) (`.dc.html` files
rendered by the canvas, not standalone pages). All numbers are sample data;
model ids are the vendor profiles' own.

| Board | File | Shows |
|---|---|---|
| 1 | `Main.dc.html` | Analyze with a Claude Code session open: the Replay on picker (vendors grouped; Moonshot AI and Microsoft disabled, caching undocumented), a summary strip (measured, simulated, difference, coverage, self-check, price line), the turns table with a dashed **Simulated** column group (cache outcome as word and icon, cache read, cost), a turn not replayed with its reason, and the selected turn's simulated note in the Explanation tab. Tweaks: replay off or on, the selected turn |
| 2 | `Summary.dc.html` | The replay summary panel: totals over the same turns, the price channel and date with a switch, coverage with reasons, the self-check sentence and its rule, the assumptions A1–A5 with confidence (A4 greyed when unused). Tweaks: self-check passed or failed, API or Copilot prices |
| 3 | `Compare.dc.html` | Compare models: a ranked table and one-hue bars (the session's own model hatched and outlined, a measured reference line, an unknown total as "unknown" with its reason), Add model with the 10-model cap, the pricing note (another vendor's model moves to that vendor's API) |
| 4 | `States.dc.html` | The picker open, loading with Cancel, not replayable (a pi session; over 20,000 requests), no price channel, no price on that date, a request error with Retry, no self-check (three models; no vendor profile) |
| 5 | `VsCode.dc.html` | The extension's panel at a compact width with a Copilot session: Replay on, the summary line, the price switch, the turns table with the Simulated group behind Columns, and Compare models with inline bars. Tweaks: Dark Modern, Light Modern, High Contrast; replay or compare view |

## 13. Exit criterion

For a real Claude Code session and a real Copilot session on the owner's
machine: replayed on their own model, the self-check matches the log at
Phase 13's D12 tolerance; replayed on two other models, the Analyze view
shows measured and Simulated figures side by side with coverage and
assumptions, the Compare models view ranks the models, and MCP gives the
same totals as the UI.
