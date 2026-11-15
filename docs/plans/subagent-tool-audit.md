# Subagent tool calls in the tool-call audit (step 10.20)

**Last changed:** 2026-11-15 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **Plan approved 2026-11-14** (D1–D11 accepted). A 1.0 criterion, C10 in
[implementation-plan.md](../implementation-plan.md#100-release) (tasks V21
plan, V22 build). Spike ST0 done read-only on the owner's machine (§4).
Follows step 10.19 D3
([classic-subagent-credits-implementation.md](classic-subagent-credits-implementation.md))
and designs the audit shape that Claude Code's CS14 reuses
([claude-code-subagents.md](claude-code-subagents.md) D9).

## 1. Why

- A classic Copilot Chat run (`runSubagent`, `searchSubagent`) writes its
  tool calls to its own `runSubagent-*.jsonl` or `searchSubagent-*.jsonl`
  next to `main.jsonl`. Step 10.19 reads those files for usage only.
- The tool audit (`get_session_audit`, `list_tool_calls`,
  `get_audit_rollup`, the Audit tab), the security findings and the
  behaviour-change findings see only the main agent's calls. The parent's
  `runSubagent` call is listed; what the run did is not.
- Agent Host turns already list their subagents' tool calls, but nothing
  marks them as a subagent's: a user can't tell who ran `bash`, and a
  finding can't name the run.
- So a session's audit looks complete but isn't. This breaks constraint 6
  (architecture.md §2): a count must never be silently partial.
- threat-model.md §7 lists this as a residual risk of step 10.19 ("Classic
  subagent tool calls outside the audit"). This step closes it.
- Claude Code has the same gap at a larger scale (CS0: 73,547 `tool_use`
  blocks in transcripts against 20,087 in session files). Its plan's D9
  puts those calls in the audit as CS14, through the shape designed here.

## 2. Goals and non-goals

Goals:

- Every tool call a classic or Agent Host subagent run made is in the audit,
  the rollups, the security findings and the behaviour-change findings,
  counted once.
- Each audited call says who made it: the main agent, or which subagent run
  at which nesting depth.
- Rollups split main-agent and subagent calls; findings name the run.
- A run whose tool calls can't be read is reported as unread with a reason,
  never as zero calls.
- One shape for every provider, so CS14 fills it for Claude Code without a
  second design.

Non-goals:

- No subagent rounds in the turn inspector (10.19 D4: a note only).
- No change to subagent usage or cost: step 10.19 owns that.
- No Claude Code transcripts here: CS14 (after CS10) fills the shape.
- No pi or mitmproxy change (no subagents; mitmproxy tool calls are F6).
- No reading of subagent prompts, responses or tool results. The audit keeps
  a bounded, redacted argument summary and error excerpt per call, as it
  does for the main agent.
- Read-only and local (vision §6): no write, no network.

## 3. What exists

| Area | Today | Gap |
|---|---|---|
| Domain | `ToolCallRecord` (`packages/domain/src/tool-call-record.ts`): name, kind, args summary, shell, outcome, timing, `roundIndex`. `SessionAudit`, `AuditRollup` (`session-audit.ts`). `InsightToolCallRow`, `InsightFinding` (`insights.ts`) | No field says who made a call |
| Classic main calls | `session-enricher.ts` `buildToolCalls`: one record per `tool_call` name from `main.jsonl` (`tool-inventory.ts`) plus `session_files` paths. `KNOWN_ATTRS_KEYS` drops `args`, `result`, `error`; the span `status` and `dur` are ignored | Records are name-only: outcome unknown, `argsSummary` empty, so the security rules have no command or path to match. tool-call-audit.md §12 keeps VS Code outcomes unknown "until a real failing span is captured" |
| Classic subagent logs (10.19) | `subagent-log-path.ts` (bare names, same folder, `lstat`, cap 200), `child-session-refs.ts`, `subagent-attribution.ts` (runs per log turn, orphans by time), `subagent-log-source.ts`, `classic-usage-reader.ts` | Read for `llm_request` usage only; their `tool_call` spans are dropped |
| Agent Host calls | `agent-host-turn-content-builder.ts` `collectCalls`: events with a top-level `agentId` add their calls to the turn; `roundOf` gives them the round of the main call that started them (`parentToolCallId`, nesting followed) | Calls are in the turn but unmarked; `agentId` and `parentToolCallId` are dropped from the record |
| Tool kinds | `tool-kind-resolver.ts`: `task`, `agent`, `runsubagent` → `subagent` | `searchSubagent`, `search_code_subagent` (Agent Host, §4.2) and `explore_subagent` resolve to `other` |
| Audit builders | `session-audit-builder.ts`, `audit-rollup-builder.ts`, `audit-query-service.ts`, `outcome-tally.ts` | One pool of calls; retries match across agents |
| Findings | `security-scanner.ts` walks `turn.toolCalls`; `behavior-change-detector.ts` and `anomaly-detector.ts` read the insight rows | No origin on a finding |
| Savings | `failed-calls-detector.ts` reads the audit | Would start counting subagent failures with no rule |
| MCP | `audit-tools.ts` (`get_session_audit`, `list_tool_calls`, `get_audit_rollup`), `finding-tools.ts` (`list_findings`), `session-tools.ts` (`get_turn`), server instructions in `mcp-identity.ts` | No origin filter or field; instructions say "Replay covers the main agent only" but nothing about the audit |
| UI | Web `SessionAuditPanel`, `AuditRollupPanel`, `ExplanationPanel` (10.19 "Subagents this turn" block), `TurnsTable` Tools cell; extension webview shares them; MCP App U4 `views/audit/`, `views/findings/` | No origin anywhere |
| Threat model | §4 row "Tool audit and security findings (`tool-kind-resolver.ts`; step 10.19)" and §7 row "Classic subagent tool calls outside the audit": residual until 10.20 | Closed by this step (§9) |

## 4. Spike ST0 findings (2026-11-14)

Read-only Python scan of `~/.config/Code - Insiders/User` (28
`workspaceStorage` roots and the `globalStorage` root; `Code` has no debug
logs) and `~/.copilot/session-state/*/events.jsonl`. Output was counts,
enum values, key names, tool names and type names only; no prompt,
argument, result or error text was printed.

### 4.1 Classic Copilot Chat

- **Runs.** 259 sessions with `main.jsonl`; 13 have subagent files; 17 runs:
  12 `runSubagent`, 5 `searchSubagent` (as 10.19 SA0). No nested
  `child_session_ref` in any child file.
- **Tool calls per run.** 481 `tool_call` spans in total; per run 0, 6, 10,
  13, 15, 16, 21, 22, 24, 31, 35, 38, 39, 40, 41, 46, 84 (one run made no
  call).
- **Tools.** `read_file` 238, `grep_search` 107, `file_search` 74,
  `list_dir` 24, `memory` 14, `semantic_search` 13, `fetch_webpage` 11. No
  `run_in_terminal`: the runs on this machine were read-only agents
  (`Explore`, `Plan`, `Tester`, `default`, search). So no shell call, and no
  security finding, is expected from today's data; fixtures must cover them.
- **Outcome fields in child logs.** Same envelope as `main.jsonl`. Span
  `status`: `ok` 470, `error` 11. `attrs.error` (a string) is present on
  exactly the 11 `error` spans and on no `ok` span. `dur` is numeric on all
  481. `attrs.args` is a JSON string on all 481; `attrs.result` a string on
  450, absent on 31.
- **Main agent, same logs.** 7,204 `tool_call` spans: `status` `ok` 7,118,
  `error` 86, with `attrs.error` a string on exactly the 86. So the error
  value that tool-call-audit.md §5 and §12 call "unverified" is `"error"`,
  seen 86 times. Today these calls are name-only (§3).
- **Links.** Every child span's `parentSpanId` names a span in the same
  child file (481 of 481). No child `spanId` appears in its parent
  `main.jsonl` (481 of 481): no call is logged twice.
- **Parent calls.** The parent's `runSubagent` call (12) is a main-agent
  call of kind `subagent`; `searchSubagent` runs have no parent `tool_call`
  (10.19 design §2.2). `explore_subagent` is called 5 times in `main.jsonl`
  with no child file and no `child_session_ref`.

### 4.2 Agent Host (Copilot CLI event log)

- 84 event logs; 4 have subagent events; 5 subagent runs (`subagent.started`
  5, each carrying a top-level `agentId`).
- 139 `tool.execution_start` events with an `agentId`, against 3,696
  main-agent starts. Tools: `view` 27, `bash` 20, `grep_search` 20,
  `file_search` 17, `web_fetch` 16, `read_file` 11, `rg` 10, `glob` 5,
  `web_search` 5, `apply_patch` 3, MCP 4, `list_agents` 1.
- **Link.** All 139 carry `parentToolCallId`, naming a main-agent call:
  `task` 91, `search_code_subagent` 48. Each `agentId` has exactly one
  `parentToolCallId`; `agentId` equals it in 2 of 5 runs, so the starting
  call's id, not `agentId`, is the stable run id. `subagent.started.toolCallId`
  equals that parent call in 5 of 5. Depth 1 only.
- **Outcomes.** `tool.execution_complete.success` true 124, false 13 (each
  with `error`), no completion 2; `shellExecution.exitCode` an integer on
  18; `permission.completed` 21 (`approved` 19, `approved-for-location` 1,
  `cancelled` 1). The existing outcome rules already read all of these.
- **Run summary.** `subagent.completed` has `totalToolCalls` in 3 of 5 runs
  (newer CLI versions): equal to the counted starts in 2, 24 against 26 in
  one cancelled run. Usable as a cross-check, not as the oracle.

### 4.3 What this means for the design

- Outcomes in classic child logs come from the span `status` and
  `attrs.error`, the same signal as the main agent's spans. One reader rule
  serves both (D3).
- No dedupe is needed between a classic parent and its child logs on this
  machine; a rule and a test still guard it (§5.4).
- Agent Host needs marking, not reading: the calls are already counted.
- Nesting: classic 0, Agent Host depth 1, Claude Code depth 2 (CS0: 16
  runs). The shape carries a depth up to 8.

## 5. Design

Subagent calls go into `turn.toolCalls` of the turn that started their run
(10.19 option A, as Agent Host does today), each carrying an `origin`. Every
consumer that walks `turn.toolCalls` counts them with no change; consumers
that must split read `origin`. One responsibility per module (§11.5); pure
functions except the file reads.

### 5.1 The shared shape (`packages/domain`)

All optional and additive. A record without `origin` is the main agent's,
so Learn fixtures, pi, mitmproxy and old clients stay valid.

```ts
// tool-call-origin.ts (new)
export const toolCallOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("main") }),
  z.object({
    kind: z.literal("subagent"),
    runId: subagentRunIdSchema,          // same pattern as subagentRunUsageSchema.id
    label: subagentLabelSchema,          // same pattern as subagentRunUsageSchema.label
    depth: z.number().int().min(1).max(8), // 1 = started by the main agent
    parentRunId: subagentRunIdSchema.optional(), // set when depth > 1
    startedByCallId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/).optional(),
  }),
]);

// tool-call-record.ts
origin: toolCallOriginSchema.optional(),   // absent = main
```

- `runId` equals the run's `TurnUsage.subagents[].id` where the cost side
  has the run, so the audit and the cost views link one run:
  classic `childSessionId`; Agent Host the starting call's id
  (`parentToolCallId`); Claude Code the transcript's agent id (CS4).
- `label` reuses 10.19's label pattern, widened once for every provider:
  `runSubagent-<agent>`, `searchSubagent` (classic); `task-<agentName>`,
  `search_code_subagent` (Agent Host, from `subagent.started.agentName` or
  the starting tool's name); `Agent-<agentType>` (CS4).
- `startedByCallId` is the main or outer call that started the run, when
  the log names one (absent for `searchSubagent`).
- The two id and label patterns move to one module
  (`subagent-run-ids.ts`) that `turn-usage.ts` and `tool-call-origin.ts`
  both import, so the cost and audit sides can't drift.

Aggregates:

```ts
// session-audit.ts
const originTotalsSchema = z.object({
  main: outcomeTotalsSchema,
  subagents: outcomeTotalsSchema.extend({ runs: z.number() }),
});

const auditedRunSchema = z.object({
  runId: subagentRunIdSchema,
  label: subagentLabelSchema,
  depth: z.number(),
  parentRunId: subagentRunIdSchema.optional(),
  turnIndex: z.number(),
  totals: outcomeTotalsSchema.nullable(),     // null = unread, never 0
  failureRate: failureRateSchema,
  unreadReason: z.string().optional(),        // set iff totals is null
});

sessionAuditSchema.extend({
  byOrigin: originTotalsSchema.optional(),    // present when any run exists
  subagentRuns: z.array(auditedRunSchema).optional(),
});

auditRollupSchema.extend({
  byOrigin: originTotalsSchema.optional(),
  sessionsWithUnreadSubagentRuns: z.number().default(0),
});

// insights.ts
insightToolCallRowSchema.extend({ origin: toolCallOriginSchema.optional() });
insightFindingSchema.extend({ origin: toolCallOriginSchema.optional() });
```

- `totals`, `byTool`, `byShellProgram`, `byFailureCategory`, `perTurn`,
  `daily` and `topFailingCommands` keep meaning "all calls": main plus
  every read run. `byOrigin` splits them; `byOrigin.main +
  byOrigin.subagents = totals` is a property test.
- `outcomeCoverage.unknownReasons` gains each unread run's reason.

**What CS14 reuses unchanged:** `toolCallOriginSchema`, the id and label
module, the aggregate fields, every builder in §5.5, the finding origin
(§5.6), the MCP inputs, outputs and texts (§5.8), the UI (§5.7), the honesty
table's run-level rows (§6) and the real-data suite's structure (§11).
**What CS14 adds:** reading `tool_use`/`tool_result` pairs from each
transcript with the existing `tool-call-extractor.ts` and
`tool-result-index.ts`; origin from CS8's attribution (agent id, `spawnDepth`,
`parentAgentId`); skipping tool-use ids a fork copied from the parent (CS
D4); its unread rules from CS §6; the `Agent-…` label (CS4).

### 5.2 Classic reader (`packages/server/src/data-sources/jsonl/`)

| File | Exports | Rule |
|---|---|---|
| `audit-attrs-projector.ts` | `AUDIT_ATTRS_KEYS`, `projectAuditAttrs` | A second projector (as `turn-inspector-reader.ts` has its own): keeps `args` cut to `MAX_ARGS_SUMMARY_LENGTH` before parsing and `error` cut to 2 KB; never `result`. Used only on the audit read path (`readSession`), never by `listSessions` |
| `tool-call-spans.ts` | `toolCallSpanRecord(envelope)` → `ToolCallRecord` | `status: "ok"` → success, `"error"` → error with `attrs.error` through `buildToolCallOutcome` (so the failure classifier and redactor run); any other value → unknown "unrecognised span status"; `dur` → `durationMs`; `args` → `summarizeToolArgs`, `shell.command` and `program` for shell kinds |
| `session-enricher.ts` (changed) | `buildToolCalls` | Main-agent records come from the spans (D3); `session_files` paths still fill `filesTouched` by name and order |
| `subagent-tool-calls.ts` | `readSubagentToolCalls(runsByTurn, sessionDir)` → `{ byTurn: Map<number, ToolCallRecord[]>, unread: UnreadRun[] }` | Reads each run 10.19's attribution placed, through `subagent-log-path.ts` and `subagent-log-source.ts`; every record gets `origin` (`depth: 1`; `startedByCallId` = the ref's `parentSpanId`, the parent's `runSubagent` span, when present) |

- The child file is the one 10.19 already opened for usage. The audit
  path streams it a second time with the audit projector; the usage path
  keeps its own allow-list unchanged (no content enters the list path).
- A nested `child_session_ref` in a child file keeps 10.19 D6: that inner
  run is unread "nested subagents are not read" (none seen; §4.1).
- `turnIndex` is the store turn 10.19's placement gives the run.

### 5.3 Agent Host (`agent-host-turn-content-builder.ts`)

- `CallDraft` already holds `agentId` and `parentToolCallId`. A new pure
  `originOf(draft, byId, runLabels)` walks `parentToolCallId` up (the same
  walk as `roundOf`, depth cap 8, cycle guard) and returns:
  - `{ kind: "main" }` when `agentId` is null;
  - else `runId` = the id of the call that started the innermost run,
    `depth` = the number of subagent hops, `parentRunId` for depth > 1,
    `label` from `subagent.started.agentName` for that call id, else the
    starting tool's name.
- `subagent.started` is added to the event types the log cache keeps
  (`toolCallId`, `agentName` only).
- A chain that never reaches a main call (none seen) gives
  `origin.depth` unknown: the call is listed with `kind: "subagent"`,
  `runId` from its own `parentToolCallId`, depth 1, and the run's
  `unreadReason` "the call that started this subagent run is not in the
  log", so the run's totals stay visible but flagged.
- Order (D2): main-agent calls first in source order, then each run's
  calls in run start order.

### 5.4 Dedupe

- A call id is counted once per session. When the same id is in the parent
  and a child log (classic; not seen) or in the parent and a fork's
  transcript (Claude Code CS D4), the first log in read order wins: the
  parent's, then outer runs before inner ones.
- The parent's starting call (`runSubagent`, `task`, `Agent`) stays a
  main-agent call of kind `subagent`; the run's own calls are the run's.
- A property test: no `(sessionId, call id)` appears twice in an audit.

### 5.5 Audit builders (`services/tool-audit/`)

| Module | Change |
|---|---|
| `outcome-tally.ts` | `originKeyOf(call)` (`"main"` or the run id); `tallyByOrigin` |
| `session-audit-builder.ts` | `byOrigin`, `subagentRuns` (one row per run 10.19 knows of, read or not); retries grouped within one origin (D6); `failureRecoveryCost` counts main-agent rounds only, as today (D6) |
| `audit-rollup-builder.ts` | `byOrigin`; `sessionsWithUnreadSubagentRuns`; such sessions stay in every count (D4) |
| `audit-query-service.ts`, `audit-query-params.ts` | Filters `origin` (`main`, `subagent`) and `runId` for `list_tool_calls` and the HTTP route; default both |

### 5.6 Findings and savings

- `SecurityScanner` copies `call.origin` onto each security finding; the
  `title` and `why` stay the rule's, and the UI and MCP name the run from
  `origin`.
- `insights-dataset-builder.ts` `toolCallRow` copies `origin`; the
  behaviour-change detector's "first use of a program or tool" names the
  run when the first use was a subagent's.
- `anomaly-detector.ts` failure outliers use all calls (they are the
  session's real failures).
- Savings detectors (`failed-calls`, `unused-tools`) read main-agent calls
  only in 1.0, with "N subagent calls not analysed" in the row's coverage
  (D7, matching CS D10).

### 5.7 UI

Mock-ups first (ST2); the owner approves before ST12 and ST13.

| Surface | Change |
|---|---|
| Web `SessionAuditPanel` (also the extension webview) | KPI sub-line "incl. N calls from M subagent runs"; a filter chip group All / Main agent / Subagents; an "Agent" column in the calls table (Main, or the run label with depth); a "Subagent runs" table (label, turn, calls, failed, unknown, failure rate, or the unread reason) |
| Web `AuditRollupPanel` | Totals split main and subagent; a "subagent calls" column in the sessions table; the unread-runs count with its reason |
| `ExplanationPanel` "Subagents this turn" block (10.19) | Each run row gains calls and failed; the tool list groups the run's calls under it |
| `TurnsTable` Tools cell | Count includes runs; tooltip "incl. k from subagent runs"; the failed badge covers both |
| Findings (web Insights, extension) | A finding from a subagent call says "by subagent run Explore (turn 4)" |
| MCP App U4 (`views/audit/`) | The by-origin split, the runs list, the Agent column on failing commands |
| MCP App findings view (`views/findings/`) | The run on each finding |
| MCP App U5 (session picker) | No change: it lists sessions and shows no audit figure |

Unread runs show their reason, never 0. Labels and ids render as text
nodes.

### 5.8 MCP and HTTP

| Tool or route | Input | Output | Description text |
|---|---|---|---|
| `get_session_audit`, `GET /api/sessions/:id/audit` | unchanged | `byOrigin`, `subagentRuns` | "Counts include tool calls made inside subagent runs; byOrigin splits main agent and subagents; a run whose calls couldn't be read is listed with its reason, never as 0" |
| `list_tool_calls`, `GET /api/sessions/:id/tool-calls` | `origin?: ("main" \| "subagent")[]`, `runId?` | each `call.origin` | "Each call says whether the main agent or a subagent run made it" |
| `get_audit_rollup`, `GET /api/audit` | unchanged | `byOrigin`, `sessionsWithUnreadSubagentRuns` | as above |
| `list_findings` | `origin?` | each finding's `origin` | "Security findings cover subagent tool calls and name the run" |
| `get_turn` | unchanged | `toolCalls[].origin` | one clause |
| Server instructions (`mcp-identity.ts`) | | | The "Subagent runs" paragraph adds: "The tool-call audit and findings include subagent tool calls, each marked with its run (`origin`)." |

- A client that ignores `origin` sees the true totals (D9).
- Both tool-list snapshots
  (`packages/server/src/mcp/__snapshots__/tool-list-standalone.json`,
  `packages/vscode-extension/src/mcp/__snapshots__/tool-list-extension.json`)
  are updated on purpose; `mcp/security.test.ts` gains a hostile label.

### 5.9 SOLID and CUPID

- Single responsibility: the audit projector, span-to-record, run reading,
  origin resolution and tallies are separate modules; providers only wire.
- Open/closed: `origin` is optional; a provider without subagents changes
  nothing; a new provider fills the same shape (CS14).
- Liskov: a record with `origin: { kind: "main" }` and one without it are
  treated the same by every builder (test).
- Interface segregation: builders take `ToolCallRecord[]` per turn and a
  run list, not provider types.
- Dependency inversion: `readSubagentToolCalls` takes 10.19's placed runs
  and a file source; tests pass in-memory sources.
- Composable and predictable: totals are sums of origins; every unknown has
  one tested reason. Domain-based: "run", "origin", "main agent" as in
  terminology.md.

## 6. Honesty rules

Unknown is never 0. Each row is a tested reason.

| Case | Effect |
|---|---|
| Run read, every span with `status` | Calls listed with outcomes; run totals known |
| Span `status` other than `ok`/`error`, or absent | That call's outcome unknown "unrecognised span status" |
| Child log missing (ref present) | Run `totals: null`, reason "The subagent log `<label>` this turn started is missing, so its tool calls are unknown." Session counts stay the read calls; `sessionsWithUnreadSubagentRuns` + 1; coverage names it |
| Child log not a regular file, name rejected, unreadable, or 0 parsable lines | As missing, with 10.19's reason text |
| Folder over 200 subagent files | Every run unread, reason "too many subagent logs to read" |
| Orphan placed by time (10.19 D5) | Calls listed; origin as usual; the run row says "matched by time" |
| Orphan that can't be placed | No turn: calls not listed; session-level reason; counted as an unread run |
| Nested ref in a child file | The inner run unread "nested subagents are not read" |
| A subagent-kind main call with no run log and no ref (`explore_subagent`, 5 seen) | An unread run row "this subagent tool writes no log the analyzer reads" (D5) |
| Agent Host session with no event log | Unchanged: the whole session's tool calls unknown |
| Agent Host call whose `parentToolCallId` chain doesn't reach a main call | Listed with depth 1; the run row flagged (§5.3) |
| Nesting deeper than 8 or a cycle | That run unread "nested subagents beyond the read depth" |
| Live run, partial last line | Skipped; counts "as of now", like the parent |

## 7. Outcome detection in child logs

- Classic: span `status` and `attrs.error` (§4.1), through the shared
  `buildToolCallOutcome`, `FailureClassifier` and `OutputRedactor`: the
  same evidence (`ruleId`, ≤ 200-char redacted excerpt) as main-agent calls.
  Exit codes only where the error text states one in the classifier's
  explicit pattern.
- Agent Host: unchanged rules (`success`, `error.message`,
  `shellExecution.exitCode`, `permission.completed`, `abort`).
- Claude Code (CS14): `tool_result.is_error` and `toolUseResult`, as for
  the main agent (tool-call-audit.md §9.1).
- ST0b runs the server's classifier over the 97 classic error texts and
  prints category counts only, to check the rules fit Copilot's wording.

## 8. Owner decisions

Decided 2026-11-14: the owner accepted each recommendation.

| # | Question | Recommendation |
|---|---|---|
| D1 | Where subagent calls live: in `turn.toolCalls` with `origin`, or in a separate `turn.subagentToolCalls` list | In `turn.toolCalls`: every consumer counts them with no change (a forgotten consumer would otherwise stay silently partial), and Agent Host already does it |
| D2 | Order in the turn | Main-agent calls first in source order, then each run's in run start order. Main-agent finding keys (`turnKey:callIndex`) stay stable; Agent Host's interleaved order changes once (CHANGELOG) |
| D3 | Classic main-agent calls: take outcomes, duration and the bounded argument summary from the same spans (86 `error` spans seen), in this step | Yes: one reader rule for main and child; without it subagent calls would have outcomes the main agent lacks, and classic security rules keep matching nothing (name-only records). Closes tool-call-audit.md §12's VS Code limitation |
| D4 | A session with an unread run in rollups | Keep it in every count, flagged by `sessionsWithUnreadSubagentRuns` and its reasons: its main-agent calls are known, and dropping the session would hide more than it shows |
| D5 | A subagent-kind call with no log (`explore_subagent`) | List an unread run with the reason, so the audit never claims the run made no calls; ST0b checks whether such tools run tools at all |
| D6 | Retries and failure-recovery cost | Retries only within one origin (main, or one run). Recovery cost stays main-agent rounds; the run's own recovery is inside its usage (10.19) |
| D7 | Savings detectors | Main agent only in 1.0, coverage "N subagent calls not analysed" (as CS D10) |
| D8 | Nesting | Shape carries depth 1-8 and `parentRunId`; classic nested refs stay unread (10.19 D6) until seen; Agent Host follows its chain |
| D9 | MCP default for `origin` | Both: a client that doesn't know `origin` still gets true totals |
| D10 | Order with CS14 | This step builds the shape, builders, MCP and UI with Copilot data; CS14 (after CS10) only adds the Claude Code reader |
| D11 | Release | The next extension and app release after the build, before 1.0.0. CHANGELOG: audit counts rise in sessions with runs; classic outcomes become known; new findings may appear; Agent Host call order changes |

## 9. Threat-model rows (`docs/threat-model.md`)

Add to §4 before reader code (ST1), rewrite as verified in ST14:

| Component | Threat | Finding to record |
|---|---|---|
| Audit attrs projector (`audit-attrs-projector.ts`) | Information disclosure: `args` and `error` of classic spans (main and child) now kept | Mitigated: audit read path only, never the list path; `args` cut before parsing and summarised; `error` cut, redacted and excerpted (≤ 200 chars) by the existing redactor; `result` never kept; the advice bundle still gets counts only (F10); tests |
| Classic subagent tool-call reader (`subagent-tool-calls.ts`) | Path traversal and denial of service | Mitigated: only files 10.19's `subagent-log-path.ts` resolves (bare names, same folder, `lstat`, cap 200), streamed line by line; tests |
| `origin.label`, `runId`, `parentRunId`, `startedByCallId` reaching UI and MCP | Hostile text, prompt injection through an agent name | Mitigated: shared id and label patterns and caps; React text nodes; MCP output is data; hostile-text tests in web, U4 and `mcp/security.test.ts` |
| Agent Host origin (`agent-host-turn-content-builder.ts`) | A crafted `parentToolCallId` loop | Mitigated: depth cap 8 and cycle guard; test |

Close: §4's row "Tool audit and security findings (`tool-kind-resolver.ts`;
step 10.19)" becomes "Mitigated; verified (step 10.20)", and §7's residual
row "Classic subagent tool calls outside the audit" is removed. CS plan §7's
Claude Code row closes with CS14.

## 10. Risks

| Risk | Effect | Handling |
|---|---|---|
| Undocumented span `status` values change in a Copilot Chat update | Outcomes wrong | Only `ok` and `error` map; anything else is unknown with a reason; the real-data suite re-runs per release |
| Kept `args` and `error` widen what the server holds | Secrets in memory or MCP output | Bounded, redacted, audit path only (§9); `OutputRedactor` gap R7 of Phase 16 (glued tokens) stays a known residual |
| Audit and rollup reads get slower (child logs read twice) | Audit tab and `get_audit_rollup` lag | Read child logs only for sessions with runs; the event-log cache already serves Agent Host; a budget test with runs in 10 % of 200 sessions |
| Counts and failure rates change for existing sessions | Users think the audit regressed | CHANGELOG and guide text; the KPI sub-line names the runs |
| New findings appear on old sessions | Alert noise | Each names the run; the CHANGELOG says why |
| Finding keys shift for Agent Host (D2) | A saved link to a finding breaks | Keys are not stored anywhere today (checked in ST10); documented |
| Classic outcomes reveal the classifier misreads Copilot's error wording | Wrong categories | ST0b checks the 97 error texts as category counts; unmatched stays `unclassified` |
| CS14 needs a field this shape lacks | Second shape | CS plan read before ST3; `parentRunId` and depth cover CS0's nesting |

## 11. Exit criterion

A `REAL_DATA` suite, `packages/server/scripts/st-subagent-tool-audit.real.test.mts`,
part of `npm run test:real-data`, passes on the owner's logs and the owner
signs off its output (as SA18). Read-only; prints session ids, dates,
counts, tool names and enum values only.

- **Oracle:** an independent lib (`subagent-tool-audit-lib.mts`, tested)
  that reads the raw `debug-logs` folders and `events.jsonl` files and
  shares no code with the server: classic `tool_call` spans per child file
  and per `main.jsonl` by `status`; Agent Host `tool.execution_start` with
  an `agentId`, grouped by `parentToolCallId`, with `success` from the
  completion.
- **Actual:** the extension composition (as SA18), MCP over an in-memory
  client.
- **Asserts, per session with runs:** `list_tool_calls` with
  `origin: ["subagent"]` returns the oracle's count per run (`runId`) and
  per status (classic: 481 calls, 11 error on this machine; Agent Host: 139
  calls, 13 error, 2 unknown); every such call's `origin.label` equals the
  run's label; `get_session_audit.byOrigin` sums to `totals`; no call id
  twice; every unread run the oracle predicts (a ref without a file) is
  unread with a reason; main-agent counts per status equal the oracle's
  (D3: 7,204 calls, 86 error).
- **Aggregate:** `get_audit_rollup` over the logs' range: `byOrigin.subagents`
  = Σ the oracle's runs.
- **Findings:** every `list_findings` security finding whose `toolCallKey`
  points at a subagent call carries that call's `origin`.
- **UI specs** (no manual rows; release-ui-gate.md): Playwright
  `packages/web/e2e/specs/subagent-tool-audit.spec.ts` (Audit tab split,
  filter, runs table, unread reason, finding names the run) and one in
  `packages/mcp-apps/e2e/specs/` (U4 and the findings view, both theme
  sets, axe); wdio `packages/vscode-extension/test/ui/specs/subagent-tool-audit.e2e.ts`
  (the panel's Audit tab over the seeded classic session with runs).

## 12. Tasks

TDD in every code task (architecture.md §11.4): failing test first. No local
model in this repo. Specs and the real-data suite are TDD exceptions as in
10.19; their pure helpers are unit-tested.

| ID | Task | Exit | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| ST0 | **Done 2026-11-14 (§4).** Spike: read-only counts over classic debug logs and Agent Host event logs | Findings in §4 | medium | Opus | — |
| ST0b | Open points (§14): `explore_subagent` (does it run tools, where are they logged); the cancelled run's 24 vs 26; the server classifier over the 97 classic error texts (category counts only); Copilot Chat 0.74+ still writing child logs | §4 and §14 updated; D5 confirmed or changed | low | Sonnet | — |
| ST1 | Threat-model rows (§9) in `docs/threat-model.md` §4 before reader code | Rows merged | low | Haiku | Plan approved |
| ST2 | **Boards ready for owner review (2026-11-15).** Mock-ups (§5.7): Audit tab split and runs table, rollup split, Explanation block, Tools cell tooltip, finding row, U4; known, unread, matched-by-time; light, dark, High Contrast; 320 and 640 px; in `docs/plans/mockups/subagent-tool-audit/` | Owner approves | medium | Sonnet (frontend-design skill) + owner | Plan approved |
| ST3 | Domain (§5.1): `subagent-run-ids.ts`, `toolCallOriginSchema`, `ToolCallRecord.origin`, audit, rollup, insight row and finding fields | Schema tests: valid, absent = main, depth bounds, hostile label and id rejected; Learn and 10.19 fixtures still parse; CS plan checked against the shape | medium | Sonnet | D1, D8 |
| ST4 | Fixtures: classic child logs with `ok`/`error` spans (an error text per failure category, a shell call), missing and unreadable log, nested ref, `searchSubagent` without parent call, `explore_subagent` without log, an id in parent and child; Agent Host log with `task` and `search_code_subagent` runs, depth 2, a cancelled run, a refused permission | A test reads each and finds the expected counts | medium | Sonnet | ST0b |
| ST5 | `tool-kind-resolver.ts`: `searchsubagent`, `search_code_subagent`, `explore_subagent` → `subagent` | Resolver tests | low | Haiku | — |
| ST6 | `audit-attrs-projector.ts`, `tool-call-spans.ts`; `buildToolCalls` from spans (D3) | Tests: status mapping, unknown status, `dur`, args bound (50 KB `args` → summary ≤ 300 chars), `result` never kept, list path unchanged | medium | Sonnet | ST3, ST4, D3 |
| ST7 | `subagent-tool-calls.ts` (§5.2, §5.4, §6) wired into `readClassicSession` | Every classic row of §6 is a test; dedupe property test; no known run with a call left out | high | Opus | ST5, ST6 |
| ST8 | Agent Host `originOf` and order (§5.3); `subagent.started` kept by the cache | Tests: main, depth 1 and 2, label sources, broken chain, cycle, order | medium | Sonnet | ST3, ST4, D2 |
| ST9 | Builders and queries (§5.5) | `byOrigin` property test; runs table incl. unread; retries per origin; rollup counter; filters | high | Opus | ST3, D4, D6 |
| ST10 | Findings and savings (§5.6) | Scanner, dataset, behaviour-change and savings tests; finding keys checked unstored | medium | Sonnet | ST9, D7 |
| ST11 | HTTP and MCP (§5.8): inputs, outputs, descriptions, instructions, snapshots | `mcp/security.test.ts`; route tests; snapshots updated on purpose | medium | Sonnet | ST9, ST10, D9 |
| ST12 | Web and extension webview per ST2; Playwright and wdio specs (§11); UI fixture sessions gain child-log tool calls | Component tests with axe, keyboard, hostile text; `web-e2e`, `extension-ui` pass | medium | Sonnet | ST2, ST11 |
| ST13 | MCP App U4 and findings view per ST2; Playwright spec | View-model and view tests; `mcp-apps-e2e` passes | medium | Sonnet | ST2, ST11 |
| ST14 | Docs (§13); threat-model rows rewritten as verified, residual closed | Docs match the code; Gantt updated by the main session | medium | Sonnet | ST7–ST13 |
| ST15 | Real-data suite and oracle (§11); owner run and sign-off | §11 passes; owner signs off | medium | Opus (suite), owner | ST14 |

Critical path: ST0b → ST4 → ST6 → ST7 → ST9 → ST11 → ST12 → ST14 → ST15.
ST1, ST2, ST3 and ST5 run beside ST0b–ST4; ST8 beside ST6–ST7; ST13 beside
ST12. CS14 starts after ST11 (shape, builders and MCP final) and CS10.

## 13. Docs to update (ST14)

- `docs/architecture.md`: §5 (`origin`, audit and rollup fields), §6.2.2
  (classic span outcomes; child-log tool calls), §6.2.2.2 (Agent Host
  origin), the Phase 9.10 audit text, §8 (MCP inputs and outputs), §11.2
  (audit projector).
- `docs/threat-model.md` (ST1, ST14).
- `docs/plans/tool-call-audit.md` §5 and §12 (VS Code outcomes known),
  `docs/plans/classic-subagent-credits-implementation.md` (D3 done),
  `docs/plans/claude-code-subagents.md` CS14 (points at §5.1),
  `docs/plans/mcp-apps.md` U4, `docs/plans/savings-report.md` (coverage).
- `docs/UserGuide.md`, `docs/vscode-extension-guide.md`: the Agent column,
  filter, runs table, unread reasons.
- `CHANGELOG.md`, `packages/vscode-extension/CHANGELOG.md` `[Unreleased]`
  (D11).
- `docs/terminology.md`: "origin", "main agent".
- `docs/implementation-plan.md` (10.20, C10, V22), `docs/plans/vscode-extension.md`
  and `docs/implementation-plan-gantt.md`: by the main session.

## 14. Not verified

- What `explore_subagent` is, whether it runs tools, and where they are
  logged (5 calls, no child file, no ref).
- Whether Copilot Chat 0.74 and later still write child logs (10.19 §13).
- Classic shell calls inside a run: none on this machine; fixtures only.
- Agent Host nesting deeper than 1, and the cancelled run's 2 extra starts
  against `totalToolCalls`.
- How Copilot words classic tool errors, against the classifier's rules
  (ST0b).
