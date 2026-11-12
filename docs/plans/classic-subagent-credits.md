# AI Credits of classic Copilot Chat subagents

**Last changed:** 2026-11-12 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **accepted; implementation is step 10.19** of
[implementation-plan.md](../implementation-plan.md), planned in
[classic-subagent-credits-implementation.md](classic-subagent-credits-implementation.md)
(owner decisions accepted 2026-11-12; plan merged in #124). `ext-v0.1.0`
shipped on 2026-11-03 without this fix, so classic-harness totals that omit
subagent spend stay partial until it lands.

## 1. Context

A classic Copilot Chat session (Local harness, `copilotHarness: "local"`)
can start subagents through the `runSubagent` and `searchSubagent` tools.
Each subagent run writes its own debug log next to the parent's
`main.jsonl`, in the same session folder:

```
workspaceStorage/<hash>/GitHub.copilot-chat/debug-logs/<session-id>/
  main.jsonl
  runSubagent-<agent>-<toolCallId>.jsonl     # e.g. runSubagent-Explore-call_…
  searchSubagent-<toolCallId>.jsonl
```

The subagent's `llm_request`s, with their `copilotUsageNanoAiu`, are only
in that sibling file. `VscodeLogProvider` reads only `main.jsonl`, so the
Sessions list, the session detail, the status bar and every rollup leave
this spend out. The totals look complete but are not, which breaks
constraint 6 (architecture.md §2): a total must never be silently partial.

PR #122 found the gap. Agent Host sessions are not affected: their AI
Credits come from `session.db`, whose per-turn totals already include
subagent calls (§6.2.2.2, step 10.15 reconciliation). Claude Code subagent
transcripts stay out of scope (§6.2.6).

### 1.1 Measured impact (owner's machine, 2026-11-05)

Read-only scan of `~/.config/Code - Insiders/User` (the Stable `Code`
folder has no debug logs). Only counts and sums were taken; no prompt or
response text.

| Measure | Value |
|---|---|
| Session folders | 258 (257 with `main.jsonl`; 96 with `llm_request`s) |
| Sessions with subagent files | 13 |
| Subagent files | 17: 12 `runSubagent-*`, 5 `searchSubagent-*` |
| Subagent `llm_request`s | 191: 176 `runSubagent`, 15 `searchSubagent` |
| Requests without a numeric `copilotUsageNanoAiu` | 0 |
| Uncounted AI Credits | **177.64**, all from `runSubagent` |
| `searchSubagent` AI Credits | 0.00 (all 15 requests report `0` nano-AIU, model `copilot-search-a`) |
| Sessions whose total is too low | 8 (the 5 `searchSubagent`-only sessions lose nothing) |
| Share of the 13 sessions' true total | 10.7 % (1,479.62 counted, 177.65 missing) |
| Share of all classic spend | 2.5 % (6,856.53 counted in every `main.jsonl`) |
| Subagent file size | 19.3 MB in total, 2.6 MB max, 0.9 MB median |
| Date range | 2026-08-08 to 2026-09-29; newest `main.jsonl` 2026-10-01 (newer sessions run in the Agent Host) |

Per `runSubagent` agent (from the file name and `child_session_ref.label`):

| Agent | Files | Requests | AI Credits | Model |
|---|---|---|---|---|
| `Explore` | 9 | 155 | 163.90 | `claude-haiku-4.5` |
| `Plan` | 1 | 14 | 8.33 | `gpt-5.6-luna` |
| `default` | 1 | 6 | 4.03 | `gpt-5.6-luna` |
| `Tester` | 1 | 1 | 1.38 | `gpt-5.6-luna` |

Per affected session (anonymised, counted vs. missing):

| Session | Counted today | Subagent | Under-count |
|---|---|---|---|
| A | 46.53 | 54.65 (3 runs) | 117 % |
| B | 99.42 | 42.06 (2) | 42 % |
| C | 83.08 | 29.78 (2) | 36 % |
| D | 172.54 | 23.83 (1) | 14 % |
| E | 231.22 | 13.59 (1) | 6 % |
| F | 38.58 | 8.33 (1) | 22 % |
| G | 26.69 | 4.03 (1) | 15 % |
| H | 9.05 | 1.38 (1) | 15 % |

Per turn the error is larger. In 8 of the 10 parent turns that started a
paid subagent, the subagent cost more than the turn itself (for example
3.14 counted vs. 42.06 missing). The turns table, the "most expensive
turns" ranking and the cost-outlier findings are therefore wrong today,
not just the session totals.

## 2. File format (verified on real data)

### 2.1 Subagent file

Same envelope as `main.jsonl` (§7): `v`, `ts` (ms epoch), `dur`, `sid`,
`type`, `name`, `spanId`, `parentSpanId` (on all but the root span),
`status`, `attrs`. 0 malformed lines in 17 files.

| Event type | Count | `attrs` keys |
|---|---|---|
| `session_start` | 17 (one per file) | `parentSessionId`, `label`, `copilotVersion`, `vscodeVersion` |
| `user_message` | 17 (one per file: the subagent's task prompt) | `content` |
| `turn_start` / `turn_end` | 193 / 192 | `turnId` |
| `llm_request` | 191 | same as `main.jsonl`: `inputTokens`, `outputTokens`, `cachedTokens`, `copilotUsageNanoAiu`, `model`, `responseId`, `debugName`, plus content keys the reader drops |
| `agent_response` | 191 | `response`, `reasoning` |
| `tool_call` | 481 | `args`, `result`, `error` |
| `hook` | 302 | `command`, `input`, `output`, `resultKind` |
| `subagent` | 12 (one per `runSubagent` file) | `agentName` (`Explore`, `Plan`, `Tester`, `GitHub Copilot Chat`) |
| `generic` | 177 | `category`, `details` |

- `sid` is the same on every line and equals the `<toolCallId>` in the file
  name (`call_…` for OpenAI-style ids, `toolu_…` for Anthropic-style).
- `session_start.attrs.parentSessionId` equals the parent session folder's
  id in 17 of 17 files.
- **Credits are per request**, exactly like `main.jsonl`: every
  `llm_request` has numeric `inputTokens`, `outputTokens`, `cachedTokens`,
  `copilotUsageNanoAiu` and a string `model`. The existing
  `extractLlmRequestUsage` reads them unchanged. `debugName` is
  `tool/runSubagent-<agent>` or `searchSubagentTool`.
- **No nesting observed**: no subagent file contains a `child_session_ref`.
- **No double counting**: none of the parent `main.jsonl` files has an
  `llm_request` whose `debugName` names a subagent, and no subagent
  `responseId` appears in its parent.
- `responseId` is not unique per request. Each subagent file has a single
  value across all its requests (parents also repeat: 641 requests, 79
  distinct values). None of the 17 subagent values, and none of the
  parents', is in this machine's `agent-traces.db`. See risk R5.

### 2.2 Link to the parent: `child_session_ref`

The parent `main.jsonl` has one `child_session_ref` event per subagent run.
`attrs`: `childSessionId`, `childLogFile`, `label`.

| Check | Result |
|---|---|
| A `child_session_ref` for every subagent file | 17 of 17 |
| A subagent file for every `child_session_ref` | 17 of 17 (no dangling refs) |
| `childLogFile` is a bare file name in the same folder | 17 of 17 (no `/`) |
| `childSessionId` equals the file's `sid` and file-name suffix | 17 of 17 |
| `label` | `runSubagent-<agent>` or `searchSubagent` |
| `ts` equals the subagent's `session_start.ts` (to the second) | 17 of 17 |
| `parentSpanId` names the parent's `runSubagent` `tool_call` span | 12 of 12 `runSubagent` refs |
| That `tool_call` is in the same turn and its span (`ts` to `ts + dur`, ±1 s) covers every subagent event | 12 of 12 |
| `parentSpanId` on `searchSubagent` refs | absent in 5 of 5 (no matching `tool_call` either) |

**Turn attribution.** The ref's position in `main.jsonl` gives its turn by
the existing positional join (`groupEnvelopesByUserMessage`: the Nth
`user_message` is turn N). This works for both kinds, with or without
`parentSpanId`, and for log-only turns (§6.2.2, "Debug-log turns without a
store row"). Every ref's turn index was a store turn on this machine.

**Files without a link.** None observed. They can still occur: a parent
log cut by `maxSessionLogSizeMB`, a crash between writing the child's first
line and the parent's ref, or a live session read before the ref is
flushed (`flushIntervalMs`). §4 defines the fallback.

## 3. Design options

All options read the same files. They differ in where the spend shows up.

### A. Fold into the parent turn (via `child_session_ref`)

Each run's usage is added to the turn that started it. The turn's
`TurnUsage` figures become "everything billed for this turn", and a new
optional `TurnUsage.subagents` lists the runs for display and per-model
breakdowns.

- Pro: every consumer that sums turns (session total, cumulative column,
  sparkline, `SessionCost`, `InsightsDataset`, status bar) becomes correct
  with no change. "Session total = Σ turns" and "list = detail" (contract
  test) still hold.
- Pro: matches Agent Host, where `session.db` already counts subagent calls
  in the parent turn, so both harnesses report the same thing.
- Pro: the most expensive turns and cost-outlier findings point at the turn
  where the user's prompt caused the spend.
- Con: a turn's `model` names the main agent while some of its tokens came
  from another model. Per-model breakdowns need the `subagents` detail to
  split them (task 10, 11).
- Con: `roundsCount` needs a rule (open question 1).

### B. Separate rows in the parent session

Each run is a pseudo-turn in `Session.turns`, after its parent turn.

- Pro: visible as its own row in the turns table.
- Con: breaks the positional turn index that `readTurnDetail`, the
  inspector, `get_turn`, the audit's `turnIndex` and the scrubber rely on.
  Every consumer that counts turns (`turnCount`, "N turns", insights turn
  rows) would count runs as turns, which they are not: the user sent no
  prompt.
- Con: needs a new `Turn` kind that every builder must understand.

### C. Separate subagent sessions

Each run is listed as its own `Session` (id = `childSessionId`).

- Pro: simple reader; the subagent file is already a well-formed session
  log.
- Con: the parent's total stays partial unless it also counts the runs,
  and then rollups count them twice. `call_…` ids are not in
  `session-store.db`, so the list would mix store and non-store sessions
  with a new parent/child relation the domain has no notion of.
- Con: 17 extra list entries with one user message each, mostly noise.

### D. Session-level only

Add the runs to `Session.costAiCredits` but not to any turn.

- Con: "session total = Σ turns" breaks: `session-kpis.ts`, the cumulative
  column, `SessionCost` and `InsightsDataset` all sum turns, so the list
  and the detail would disagree again (the bug #122 fixed).

### E. Unknown when the link is missing (applies to A-D)

A run that can't be read or placed makes the affected total unknown with a
reason, never a lower known number. §4 defines the rules.

## 4. Recommendation: option A, with E's rules

### 4.1 Reading

1. Parse `main.jsonl` as today. Add `childSessionId`, `childLogFile`,
   `label`, `parentSessionId` and `agentName` to `KNOWN_ATTRS_KEYS`, and
   `parentSpanId` to `JsonlEnvelope` (all fixed-format ids and labels, no
   content).
2. Collect the refs with their positional turn index:
   `{ turnIndex, childSessionId, childLogFile, label, ts }`.
3. For each ref, resolve `childLogFile` inside the session folder. Accept
   only a bare file name matching
   `^(runSubagent|searchSubagent)-[A-Za-z0-9_-]+\.jsonl$`; anything else
   (a `/`, `..`, another name) is rejected as unreadable (§11.2 path
   traversal).
4. List the folder's subagent files (same name pattern). A file without a
   ref is an orphan (§4.3).
5. Read each file with the same `readMainJsonlFile` and allow-list. Sum its
   `llm_request`s with `extractLlmRequestUsage` into one
   `SubagentRunUsage`. AI Credits are all-or-nothing per run, as for a turn.
6. Add each run to its turn (§4.2).

Both `listSessions` (`summarizeSessionWithCost`) and `readSession`
(`readClassicSession`) call one shared function that returns
`{ availability, turnUsages }` with the runs merged in. Their inputs to
`summarizeSessionUsage` stay identical, so the list still equals the
detail. `readSession` also applies the `agent-traces.db` join to the runs'
`responseId`s; the list doesn't, as today.

### 4.2 Merge rules (per turn)

- `uncachedInput`, `cacheRead`, `output`, `costAiCredits`: the turn's value
  plus each run's, with `sumTokenCounts` (unknown wins).
- `cacheWrite`, `reasoning`: the same sum. Known only when the turn's and
  every run's figure is known (today they come only from
  `agent-traces.db`).
- `tool`, `vision`: unchanged (not exposed).
- `model`: unchanged (the main agent's last model).
- `roundsCount`: unchanged; the runs' request counts are in
  `subagents[].roundsCount` (open question 1).
- `subagents`: one entry per run, in ref order.
- A turn whose own usage is `null` (no parsable `llm_request`) stays
  unknown; a run doesn't turn it into a known turn.

### 4.3 Cost-unknown rules

Each case is a distinct, tested reason. Unknown is never 0.

| Case | Effect |
|---|---|
| Ref and file present, every request numeric | Run known; turn and session sums include it |
| Ref present, file missing | Run `costAiCredits` unknown: "The subagent log `<label>` this turn started is missing." Turn and session AI Credits become unknown |
| `childLogFile` rejected by the name check | As "missing", reason "not a subagent log name" |
| File present but unreadable, or 0 parsable lines | Run unknown, reason "unreadable" |
| A request without a numeric `copilotUsageNanoAiu` | Run AI Credits unknown (`AI_CREDITS_NOT_AVAILABLE_REASON`); its token figures still sum |
| File present, no `llm_request` (subagent started, no model call yet) | Run known with 0 requests and 0 AI Credits (the source says so; not a fabricated 0) |
| Orphan file, `parentSessionId` equals the folder id, its `session_start.ts` falls in exactly one parent turn's window (that turn's `user_message.ts` to the next one's) | Attributed to that turn, `attribution: "timestamp"` |
| Orphan file that can't be placed (no `parentSessionId` match, before the first turn, or no turns) | Session `costAiCredits` unknown: "A subagent log in this session's folder could not be matched to a turn." Turn figures unchanged |
| A `child_session_ref` inside a subagent file (nesting, not observed) | Run unknown, reason "nested subagents are not read" (open question 6) |
| Parent `main.jsonl` not `events-present` | Unchanged: the session is already unknown; subagent files are not read |

A live session's last line may be partial; it is skipped, as for
`main.jsonl`, and the totals are "as of now", like the parent's.

### 4.4 Domain changes (`packages/domain`)

```ts
// turn-usage.ts: new, optional
interface SubagentRunUsage {
  id: string;                     // childSessionId (the starting tool call's id)
  label: string;                  // "runSubagent-Explore", "searchSubagent"
  agentName?: string;             // from the `subagent` event, when present
  model: string;                  // last known model of the run's requests
  roundsCount: number;            // the run's llm_requests
  uncachedInput: TokenCount;
  cacheWrite: TokenCount;
  cacheRead: TokenCount;
  reasoning: TokenCount;
  output: TokenCount;
  costAiCredits: TokenCount;
  startedAt?: string;             // ISO, from session_start.ts
  attribution: "child-session-ref" | "timestamp";
}

interface TurnUsage {
  // ... unchanged fields, which now include the runs
  subagents?: SubagentRunUsage[]; // classic Copilot Chat only; absent = none read
}
```

- `Session` gets no new field. The session total keeps coming from
  `summarizeSessionUsage`, which also takes the orphan result (§4.3) so an
  unplaceable orphan makes `costAiCredits` unknown in both list and detail.
- `TurnView` reuses `turnUsageSchema`, so `get_turn` carries `subagents`
  with no schema change of its own.
- Optional and additive: Learn fixtures, other providers and old clients
  are unaffected.

### 4.5 Effect on every consumer

| Consumer | Effect | Change needed |
|---|---|---|
| Sessions list (web, extension tree) | Correct total; 8 sessions rise on this machine | None (summary from `summarizeSessionUsage`) |
| Session detail, KPIs, sparkline | Correct total and cumulative curve | None |
| Turns table | AI Credits and token cells include runs; cumulative column correct | A marker on the AI Credits cell with "incl. X from N subagents" in its tooltip |
| Explanation panel | | "Subagents this turn" block: label, model, requests, AI Credits, attribution; explanation text names the subagent share |
| Turn inspector | Unchanged: subagent rounds not shown (as Agent Host) | A note "N subagent runs not shown" (open question 4) |
| Tool audit (`/audit`, `/tool-calls`, `get_session_audit`, `list_tool_calls`, `get_audit_rollup`) | Unchanged: the parent's `runSubagent` call is listed; the 481 subagent-internal calls are not | Open question 3 |
| `get_session_cost` | Totals and top turns correct | `byModel` splits a turn's runs onto their own models; optional `subagents` summary (runs, AI Credits) |
| `get_cost_rollup` | Totals correct (from `InsightsDataset`) | `byModel` split needs the runs in the dataset (task 11) |
| `list_findings` | Cost-outlier z-scores use the true turn and session costs (some findings change) | None; security rules still don't see subagent tool calls (open question 3) |
| `get_turn` | `usage` includes runs; `subagents` listed | MCP description mentions it |
| Insights dashboard | Totals correct | `subagentRuns` table linked to turns, for the model split and a filter |
| Status bar | Correct (sums list summaries) | None |
| Standalone app | Same server and web code | None beyond the above |
| Agent Host, Claude Code, pi, mitmproxy | Unchanged | None |

## 5. Risks

- **R1 Undocumented format.** `child_session_ref` and the sibling files are
  Copilot Chat internals. Mitigation: defensive parsing, the §4.3 reasons,
  and fixtures from real structure. A renamed file prefix shows as an
  orphan or missing run, never as a silent lower total.
- **R2 Known sessions become unknown.** A missing subagent file now makes a
  turn and session unknown where today they show a (too low) number. This
  is the intended constraint-6 behaviour; none is affected on this machine.
- **R3 List cost.** The list already reads every `main.jsonl`; it would
  also read 19.3 MB of subagent logs on this machine. Mitigation: read
  subagent files only for sessions with refs or matching file names, and
  stream like `main.jsonl`.
- **R4 Path traversal.** `childLogFile` comes from a log file. Mitigation:
  the strict name pattern and same-folder resolution (§4.1 step 3), with a
  traversal test.
- **R5 `responseId` is not unique.** The `agent-traces.db` join (Phase 8.5)
  assumes one span per `responseId`. A repeated id can match several
  requests to one span. This affects existing turns too, not just
  subagents, and no match exists on this machine. Out of scope here;
  recorded for a separate check.
- **R6 Per-model attribution.** Until tasks 10 and 11 land, folding runs
  into a turn credits `claude-haiku-4.5` spend to the parent's model.
  Ship the split with the fold, or state the gap (open question 2).
- **R7 Text and secrets.** Subagent files hold prompts, tool results and
  hook output. Only the allow-listed numeric and id keys are kept, as for
  `main.jsonl`; fixtures are synthetic.

## 6. Tasks (TDD order)

Every task writes its failing test first (§11.4). No task uses the local
model (owner, 2026-10-29: Claude subagents only in this repo).

| # | Task | Complexity | Model |
|---|---|---|---|
| 1 | Synthetic fixtures under `packages/server/fixtures/jsonl/subagents/`, structure and field names from §2, no real text: a parent with a `runSubagent` ref (with `parentSpanId`) and a `searchSubagent` ref (without, 0 nano-AIU); a dangling ref; an orphan file placeable by timestamp; an orphan that isn't; a request without `copilotUsageNanoAiu`; a `childLogFile` with `../`; a nested ref; a partial last line. Matching store rows for the provider tests | medium | Sonnet |
| 2 | Domain: `subagentRunUsageSchema`, optional `TurnUsage.subagents`; schema tests (valid, unknown figures, absent) | low | Haiku |
| 3 | Reader: allow-list keys and `parentSpanId`; pure `collectChildSessionRefs(envelopes)` with positional turn index | low | Sonnet |
| 4 | `resolveSubagentLogPath(sessionDir, childLogFile)` and `listSubagentLogFiles(sessionDir)`: name pattern, same-folder resolution, traversal tests | low | Sonnet |
| 5 | Pure `extractSubagentRunUsage(envelopes, ref)`: sums via `extractLlmRequestUsage`, all-or-nothing AI Credits, 0-request run, model, `startedAt`, `agentName` | medium | Sonnet |
| 6 | Pure attribution: refs first, then orphans by `parentSessionId` and turn window; result per turn plus an "unplaceable" marker; every §4.3 row is a test | high | Opus |
| 7 | Pure `mergeSubagentUsage(turnUsages, runsByTurn)` (§4.2), including the `agent-traces.db` join for `cacheWrite`/`reasoning`; `summarizeSessionUsage` takes the unplaceable marker | high | Opus |
| 8 | Provider wiring: one shared classic-usage reader for `summarizeSessionWithCost` and `readClassicSession`; the contract fixture gains a session with subagents, so "list equals detail" covers them; provider tests for every unknown reason | medium | Sonnet |
| 9 | Explanation text in `session-enricher` names the subagent share | low | Haiku |
| 10 | `session-cost-builder`: `byModel` split, `subagents` summary; `cost.ts` schema; MCP descriptions and server instructions; the tool-list snapshots (`packages/server/src/mcp/__snapshots__/tool-list-standalone.json` and `packages/vscode-extension/src/mcp/__snapshots__/tool-list-extension.json`) updated on purpose | medium | Sonnet |
| 11 | `InsightsDataset` `subagentRuns` rows linked to turns; `cost-rollup-builder` `byModel` split; associative-engine link test | medium | Sonnet |
| 12 | Web: AI Credits cell marker and tooltip in `TurnsTable`; "Subagents this turn" in `ExplanationPanel`; UI check seeds a session with runs (shared by the extension webview) | medium | Sonnet |
| 13 | Extension: tests that the status bar and sessions tree show the higher totals from a fixture with runs | low | Haiku |
| 14 | Docs: architecture.md §5 and §6.2.2 (format and rules from this plan), both user guides, both changelogs' `[Unreleased]`, this plan's status | low | Haiku |
| 15 | Real-data check on the owner's machine (counts and sums only, as in §1.1) | low | owner, Sonnet to script |

## 7. Exit criteria

- On the owner's machine, the Copilot provider's classic sessions total
  177.64 AI Credits more than before (±0.01), split as in §1.1's per-session
  table; the 5 `searchSubagent`-only sessions are unchanged.
- For each affected session, the Sessions list, the session detail, the
  status bar, `get_session_cost` and `get_cost_rollup` report the same
  total (the contract test proves list = detail on the fixture).
- Each parent turn shows its runs (label, model, requests, AI Credits) in
  the UI and in `get_turn`.
- `byModel` in `get_session_cost` and `get_cost_rollup` credits
  `claude-haiku-4.5` with the `Explore` runs' 163.90 AI Credits.
- Every row of §4.3 has a test; none yields a known total that leaves a
  billed request out.
- A `childLogFile` with a path component is never opened (test).

## 8. Open questions for the owner

1. **Rounds column.** Keep `roundsCount` as the main agent's round-trips
   (runs' requests shown in the breakdown), or add the runs' requests?
2. **Per-model split.** Ship tasks 10 and 11 with the fold, or fold first
   and accept the per-model gap (R6) for one release?
3. **Subagent tool calls.** The 17 files hold 481 `tool_call`s that the
   tool audit and the security findings don't see. Agent Host already
   counts subagent tool calls in the parent turn (§6.2.2.2). Add them here
   or as a follow-up plan?
4. **Inspector.** Show subagent rounds in the turn inspector, a note only,
   or nothing (as Agent Host)?
5. **Orphans.** Accept timestamp attribution for a subagent file without a
   ref, or always make the session unknown?
6. **Nesting.** Not observed. Read nested refs recursively (bounded depth),
   or keep "unknown" until one is seen?
7. **Strictness.** Accept that a dangling ref turns a currently-known
   session total into unknown (R2)?
8. **Free runs.** Show `searchSubagent` runs with 0.00 AI Credits in the
   breakdown, or hide 0-credit runs?
9. **Scheduling.** Make this a numbered step (for example 10.17)? The
   0.1.0 release has shipped without it, so the question is now which
   release carries it (0.1.x or 0.2.0, which Phase 13 also targets).
