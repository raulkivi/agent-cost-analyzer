# Claude Code subagent usage

**Last changed:** 2026-11-15 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **plan approved** (2026-11-14): the owner accepted every recommendation, D1–D16 (§8). A 1.0 criterion, C15 in
[implementation-plan.md](../implementation-plan.md#100-release) (tasks V32
plan, V33 build). Spike CS0 done read-only on the owner's machine (§4).
Built on the patterns of step 10.19
([classic-subagent-credits-implementation.md](classic-subagent-credits-implementation.md)).

## 1. Why

- Claude Code writes each subagent's transcript to
  `<projects>/<encoded-cwd>/<session-id>/subagents/agent-<id>.jsonl`, next to
  the session's own `<session-id>.jsonl`.
- `ClaudeCodeLogProvider`
  (`packages/server/src/data-sources/claude-code/claude-code-log-provider.ts`)
  reads only the session file. `listClaudeCodeSessionFiles` walks two levels
  and never enters `subagents/` (architecture.md §6.2.6: "out of scope for
  v1").
- So every Claude Code figure leaves subagent usage out: session tokens,
  priced cost, rollups, cost by repository and project, statements,
  estimates, savings, the tool-call audit, replay coverage and insights.
- The totals look complete but are not. This breaks constraint 6
  (architecture.md §2): a total must never be silently partial.
- Found by V3 (PR #289, 2026-11-14): 46 subagent transcripts in 4 of 10
  sampled sessions. CS0 (§4) measured the whole machine: subagents account
  for about **71 %** of Claude Code's token-weighted usage, so the app shows
  about 29 % of the real spend.
- Owner decision 2026-11-14: a 1.0 task with its own plan; plan first, then
  build, with a real-data check.

## 2. Goals and non-goals

Goals:

- Every Claude Code session's tokens and priced cost include its subagent
  runs, in every view, rollup, statement and MCP tool, with no double
  counting.
- Each run is priced on its own model, with its own cache-write lifetime
  split.
- A run that can't be read or placed makes the affected figure unknown with
  a reason, never a smaller known number.
- The user sees which part of a turn came from which subagent.
- The design reuses step 10.19's domain shapes (`TurnUsage.subagents`,
  `ownUsage`, cost lines, replay coverage) rather than adding a second
  model of subagents.

Non-goals:

- No subagent sessions in the Sessions list (10.19 option C).
- No subagent rounds in the turn inspector (10.19 D4: a note only).
- No replay of subagent chains: replay stays main chain only
  (analyze-session-replay.md D6).
- No AI Credits for Claude Code: it has none (`NO_AI_CREDITS_REASON`).
- No reading of subagent prompts, responses, tool output or the meta
  file's `description` or `worktreePath`.
- No change for Copilot, pi, mitmproxy or Learn.
- Read-only and local (vision §6): no write, no network.

## 3. What exists

| Area | Today | Gap for Claude Code runs |
|---|---|---|
| Provider | `ClaudeCodeLogProvider.buildSession` builds list and detail from one file; rounds by `message.id` (`round-grouper.ts`), usage once per round (`usage-extractor.ts`), active branch through compactions (`session-tree.ts`) | Never opens `subagents/` |
| Session file discovery | `platform/claude-code-paths/resolve-claude-code-projects-dir.ts`, two levels | The subagents folder is derived from the session file path, never from log content (§5.3) |
| Domain (10.19) | `subagentRunUsageSchema`, `TurnUsage.subagents`, `ownUsage`, `Session.subagentSpend` | `label` regex accepts only `runSubagent-…`/`searchSubagent`; no `extendedCacheWrite` on runs or `ownUsage`; `attribution` has no "tool call id" value; no `parentRunId` for nesting; `subagentSpend`, `SessionCost.subagents` and `coverage.subagentRuns` carry AI Credits only |
| Cost lines (10.19 SA10) | `turnLinesOf` (`services/pricing/turn-cost-lines.ts`) splits a turn into own + run lines, each priced on its model | The own line takes the folded `extendedCacheWrite`; run lines have none, so 1-hour cache writes in runs would be priced at the 5-minute rate |
| Replay (10.19 SA11) | Measured per turn from `ownUsage`; `coverage.subagentRuns` | Generic, but its cost figure is AI Credits only |
| Copilot subagent reader | `data-sources/jsonl/subagent-log-path.ts` (bare names, same folder, `lstat` regular file, 200-file cap), `subagent-attribution.ts`, `subagent-usage-merge.ts` | Copilot-specific file names and refs; the path rules and the merge are reusable |
| Tool audit | `tool-call-extractor.ts` reads the session file | Subagent tool calls are not seen; step 10.20 (C10, plan V21 not yet written) covers the Copilot side |
| Savings | Detectors `unused-tools`, `cache-break`, `failed-calls`, `cheaper-model` over the main trace and audit | Runs not analysed and not reported as such |
| MCP | Server instructions (`mcp/mcp-identity.ts`) say "in a VS Code Copilot Chat session" | Text and descriptions name Copilot only |
| Extension | Does not use the Claude Code provider | None |

## 4. CS0 findings (2026-11-14)

Read-only Python scan of the owner's `~/.claude/projects` (25 project
folders, 223 session files). Output was counts, field names, enum values,
model names and token sums only; no prompt, response, title, description or
file content was printed.

### 4.1 Layout

- 81 session folders have a `subagents/` directory; 80 hold transcripts.
- Per run, two files: `agent-<id>.jsonl` (1,235) and `agent-<id>.meta.json`
  (1,236; one meta has no transcript). `<id>` is `a` plus 16 hex characters
  in all 1,235.
- Also seen once: `agent-<id>.forked-skill.json` and
  `agent-<id>.forked-skill.marker.json`.
- Up to 96 transcripts per session (median 10). 2.5 GB of subagent
  transcripts against 0.9 GB of session files; largest 39 MB, median
  1.3 MB.
- No symlinks. A sibling `tool-results/` directory exists in 72 sessions
  (not read, as today).
- 19 Claude Code versions, 2.1.300–2.1.325; dates 2026-10-15 to 2026-11-14.

### 4.2 Link to the parent

| Check | Result |
|---|---|
| Every line's `agentId` equals the file name's id | 1,235 of 1,235 |
| `sessionId` equals the parent session's | every line that has one; 15 `fork-context-ref` lines have none |
| First line's `parentUuid` is `null`; no branching (no uuid with two prompt children); no `last-prompt` lines; no dangling `parentUuid` | 1,235 of 1,235 |
| Parent tool that starts a run | `Agent` (1,219 calls); no `Task` on these versions |
| `meta.toolUseId` equals a parent `Agent` `tool_use` id | 1,217 |
| Nested: `meta.parentAgentId` names another transcript in the same folder (`spawnDepth: 2`) | 16 of 16; 39 `Agent` calls inside transcripts |
| Meta with no link (`spawnDepth` absent) | 2 |
| Parent `Agent` call whose run is in its own folder / another session's folder / nowhere | 1,216 / 1 / 2 (both with `is_error: true` results) |
| Parent `toolUseResult.agentId` equals the file id | 1,217 of 1,217 (a second, independent link) |
| Parent `toolUseResult.status` | `async_launched` 1,114; absent 104 |
| Parent result carries usage | 5 synchronous results have `usage`/`totalTokens`, describing the last round only (3 of 5 equal): no usable total in the parent |

Meta keys (all values are flags, ids, enums or aliases except
`description` and `worktreePath`): `toolUseId`, `agentType`, `isBuiltIn`
(true 810), `model` (aliases: `sonnet` 805, `opus` 285, `haiku` 97,
`inherit` 24, absent 23, one full id), `spawnDepth`, `parentAgentId`,
`isFork` (24), `finished` (true 1,169, absent 67, never false),
`requestShape`, `requestNonInteractive`, `pickedEffortModel`,
`spawnedWithWorktree`/`worktreePath` (240), `launchedWithDefaults`.

### 4.3 Usage and models

- Line types: `user`, `assistant`, `attachment`, `api-request` (66,234),
  `api-request-blob`, `api-request-shape`, `fork-context-ref` (15). No
  `system` lines, so no `compact_boundary` in any transcript.
- `isSidechain: true` on every line that has the field (251,571).
- Usage sits on `assistant` lines' `message.usage`, repeated per content
  block as in session files: 66,230 rounds by distinct `message.id`. Every
  round has numeric `input_tokens`, `cache_creation_input_tokens`,
  `cache_read_input_tokens`, `output_tokens` and the lifetime split
  `cache_creation.ephemeral_1h_input_tokens`; 48,927 have
  `output_tokens_details`.
- Round models: `claude-sonnet-5-5` 32,138, `claude-opus-5-5` 30,878,
  `claude-haiku-5-5` 3,206, `<synthetic>` 8. The meta's `model` is an alias;
  the round's `message.model` is the one to price.
- Token sums, runs vs session files (file-wide, distinct `message.id`):

| Field | Subagent transcripts | Session files | Ratio |
|---|---|---|---|
| `input_tokens` | 134,422 | 44,858 | 3.0 |
| `cache_creation_input_tokens` | 276,491,035 | 64,785,839 | 4.3 |
| `cache_read_input_tokens` | 11,673,493,960 | 5,429,722,721 | 2.1 |
| `output_tokens` | 41,251,098 | 14,492,908 | 2.8 |

- Weighted by Anthropic's relative token prices (cache read 0.1, write
  1.25, output 5 × input; a rough weight, not the price book), runs are
  2.5 × the main agents: about 71 % of the true total. Per session the
  run/main ratio has median 2.1 (min 0.06, max 10.3); runs exceed the main
  agent in 55 of 80 sessions.
- Tool calls: 73,547 `tool_use` blocks in transcripts against 20,087 in
  session files (3.7 ×).

### 4.4 Double counting, forks, compaction, resume

- **Sidechain lines in session files:** none (`isSidechain` is `false` or
  absent on all 225,199 parent lines). Session files hold no run usage.
- **Uuid overlap with the parent:** 0 files.
- **Forked runs copy the fork point:** 15 transcripts (each with a
  `fork-context-ref` line carrying `parentSessionId`, `parentLastUuid`,
  `contextLength`) repeat exactly 1 parent round with the same `message.id`
  and `requestId`; their own rounds are 229. Counting them as-is
  double-counts 15 rounds. 24 metas say `isFork`; 9 of those copied no
  round.
- **Compaction:** 29 `compact_boundary` entries in session files, 0 in
  transcripts. The provider already follows `logicalParentUuid` across a
  compaction, so an `Agent` call before it stays on the branch.
- **Resume:** no agent id appears in two session folders; no session file
  holds two `sessionId`s. One `Agent` call's run lives in another session's
  folder (likely history copied by a resumed or forked session; §13).

### 4.5 Background and continued runs

- 1,114 of 1,219 runs were launched in the background (`async_launched`).
- 567 transcripts have rounds after the parent's next real user prompt;
  those rounds carry about 42 % of the runs' weighted usage.
- 239 `SendMessage` calls in session files, 237 naming one of the session's
  agents; 31 transcripts hold more than one prompt. A run can be continued
  from a later turn.
- 73 `TaskStop` calls.

## 5. Design

Fold each run into the turn that started it (10.19 option A), with the
turn's own figures kept in `ownUsage`, cost lines per model, and the
unknown rules of §6. One responsibility per module (§11.5); pure functions
except the file reads.

### 5.1 Domain (`packages/domain`)

All optional and additive; Copilot data unchanged.

- `subagentRunUsageSchema`:
  - `label` also accepts `^Agent(-[A-Za-z0-9_.: -]{1,64})?$` (the tool
    plus `agentType`).
  - `attribution` gains `"tool-use-id"` (the parent's `Agent` call placed
    it).
  - New optional `parentRunId` (same pattern as `id`) for nested runs.
  - New optional `extendedCacheWrite: tokenCountSchema` (1-hour writes).
- `ownTurnUsageSchema`: optional `extendedCacheWrite`, so the own line keeps
  its own split.
- `subagentSpendSchema`, `SessionCost.subagents` and
  `coverage.subagentRuns`: add `tokens` (the four token fields) and a
  priced `cost` (`TurnCostFigures`) beside `costAiCredits`, so a provider
  without AI Credits shows a figure, not "unknown" (D13).
- `costAiCredits` of every Claude Code run is unknown with
  `NO_AI_CREDITS_REASON`, as for the main agent.

### 5.2 Reader (`packages/server/src/data-sources/claude-code/`)

| File | Exports | Rule |
|---|---|---|
| `subagent-transcript-path.ts` | `subagentsDirOf(sessionFilePath)`, `listSubagentTranscripts(dir)` | §5.3 |
| `subagent-meta.ts` | `parseSubagentMeta(text)` | Keeps `toolUseId`, `agentType` (64 chars, pattern), `isBuiltIn`, `spawnDepth`, `parentAgentId`, `isFork`, `finished`; drops every other key; size cap 64 KB |
| `round-usage.ts` (extracted from `usage-extractor.ts`) | `sumRoundUsage(rounds)` | One summation for turns and runs, incl. `extendedCacheWrite`; `<synthetic>` excluded as today |
| `subagent-run-usage.ts` | `extractClaudeCodeRunUsage(entries, meta, parentRequestIds)` | Rounds by `message.id`; skips rounds whose `requestId` or `message.id` is in the parent (fork copies); model = last round's; `roundsCount` = own rounds |
| `subagent-attribution.ts` | `attributeClaudeCodeRuns(runs, parentBranch, turnGroups)` → `{ byTurn, sessionUnknownReasons }` | §5.4 |
| `subagent-usage-merge.ts` | Reuse or generalise `data-sources/jsonl/subagent-usage-merge.ts` | 10.19 §4.2 sums; sets `subagents` and `ownUsage`; a `null` turn stays `null` |
| `claude-code-run-cache.ts` | Run summaries keyed by `(path, size, mtimeMs)` | Numbers and ids only; bounded entries (D16) |

Transcripts are parsed line by line; only `type`, `message.id`,
`message.model`, `message.usage`, `requestId`, `timestamp` and `agentId`
are kept per line.

### 5.3 Path safety

Modelled on `subagent-log-path.ts`, with one difference: nothing in a log
names a file. The folder comes from the session file's own path, and runs
are found by listing it.

- `subagentsDirOf`: `dirname(sessionFile)/<basename without .jsonl>/subagents`.
  The basename comes from the provider's own enumeration.
- `lstat` the session folder and `subagents/`: each must be a real
  directory, not a symlink; otherwise no run is read and the session's
  figures are unknown ("not a regular folder").
- Accept only bare names `^agent-[A-Za-z0-9]{1,64}\.jsonl$` and
  `^agent-[A-Za-z0-9]{1,64}\.meta\.json$`; `lstat` must be a regular file.
  Other names (`.forked-skill*`) are ignored, not read.
- `parentAgentId` and `toolUseId` are looked up in in-memory maps of the
  listed files, never joined into a path.
- Cap `MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION` (proposed 500; seen
  96): above it, no run is read and the session is unknown ("too many
  subagent transcripts to read").

### 5.4 Attaching a run to its parent turn

1. Build the active branch and turn groups as today.
2. Index the branch's `Agent` `tool_use` blocks by id → turn index, and
   their results by `tool_use_id` (`toolUseResult.agentId`, `is_error`).
3. For each transcript: link by `meta.toolUseId`; else by the parent
   result's `agentId`; else, for a nested run, by `parentAgentId` to its
   parent run, recursively (depth cap 8, cycle guard) to the top-level
   run's turn.
4. Nested runs are listed as their own runs with `parentRunId`, so each is
   priced on its model.
5. The whole run belongs to the starting turn, including rounds after a
   later prompt and continuations (D1, D2).
6. A run whose `Agent` call is off the active branch is not counted, like
   the main agent's off-branch rounds (D5).
7. Unlinked transcripts follow D6.

Turn usage = own + runs (10.19 §4.2): `ownUsage` keeps the main agent's
figures, including `extendedCacheWrite`; `roundsCount` stays the main
agent's (D12); `model` stays the main agent's.

### 5.5 Pricing per model

- `turnLinesOf` gives the own line `ownUsage.extendedCacheWrite` and each
  run line its own `extendedCacheWrite`; the property test (Σ lines = row)
  gains that field.
- Each line is priced on its model at the date of the turn; the price book
  already has the three models seen.
- Cost basis: priced (Claude Code logs no cost of its own, no billing).

### 5.6 Each consumer

| Consumer | How runs count | Change |
|---|---|---|
| Session list and detail, KPIs, turns table, cumulative curve | Folded totals | Shared reader for list and detail; contract test "list equals detail" covers a session with runs |
| Session cost (`get_session_cost`, web cost views) | Totals and `byModel` from cost lines; `subagents` with runs, tokens, priced cost | §5.1 schema |
| Rollups (`get_cost_rollup`, Dashboard, cost cube) | Lines per model; one row per turn | None beyond lines; golden tests updated only where a fixture has runs |
| Cost by repository and project, statements, estimates, variance | The parent session's repository, even for worktree runs (D11) | None beyond lines; issued statements show a diff on re-run (as 10.19 D13) |
| Savings detectors | Main agent only; each row's coverage says "N subagent runs not analysed" (D10) | Coverage text in `savings-service.ts` |
| Tool-call audit, security findings, `get_audit_rollup`, `list_tool_calls` | Per D9 | D9's increment |
| Replay, `compare_models_for_session`, `estimate_cost` with `model` | Main chain only; measured from `ownUsage`; `coverage.subagentRuns` lists runs with tokens and priced cost | Coverage schema (§5.1) |
| Insights and findings | Session z-scores and first-time model see runs | None beyond lines |
| `get_turn` | `usage.subagents`, `usage.ownUsage` | Description |
| MCP server instructions and descriptions | Name Claude Code beside Copilot | `mcp-identity.ts`, `session-tools.ts`, `cost-tools.ts`, `replay-tools.ts`; tool-list snapshots updated on purpose |
| MCP App U1 turn detail | Lists runs | View model reads tokens and priced cost for non-Copilot runs |
| Web turns table, Explanation panel, KPI tile, inspector note | 10.19 components | Show tokens and priced cost when AI Credits don't apply; mock-up delta CS2 |
| Extension | Copilot only | None |

### 5.7 SOLID and CUPID

- Single responsibility: paths, meta, run usage, attribution, merge and
  cache are separate modules; the provider only wires them.
- Open/closed: the domain gains optional fields; Copilot code paths don't
  change behaviour.
- Dependency inversion: the attribution and merge functions take parsed
  data, not file handles, and are tested without a file system.
- Composable and predictable: the same `TurnUsage` shape for both vendors;
  every unknown has one tested reason.
- Domain-based: "run", "own usage", "cost line" as in 10.19 and
  terminology.md.

## 6. Honesty rules

Unknown is never 0. Each row is a tested reason.

| Case | Effect |
|---|---|
| Linked transcript, every round numeric | Run known; turn and session include it |
| Meta present, transcript missing | Run unknown "The subagent transcript this turn started is missing."; turn and session tokens and cost unknown |
| Non-failed `Agent` call with no run in the folder | As missing (D7 for a run found in another session's folder) |
| `Agent` call with `is_error: true` and no transcript | No run; figures stay known (D8) |
| Transcript or folder that is a symlink or not regular | As missing, reason "not a regular file" or "not a regular folder" |
| Name outside the pattern | Ignored, not read; no figure changes (nothing links to it by name) |
| Unreadable transcript, or 0 parsable lines | Run unknown "unreadable" |
| A round missing a numeric usage field | That field unknown for the run (`MISSING_FIELD_REASON`) |
| Partial last line of a live run | Skipped; figures "as of now", like the parent (D14) |
| Rounds repeated from the parent (fork copy) | Skipped; counted once, in the parent |
| Nested run deeper than 8, or a `parentAgentId` cycle | Run unknown "nested subagents beyond the read depth" |
| Unlinked transcript | D6: matched by time and labelled, else session unknown "A subagent transcript in this session's folder could not be matched to a turn." |
| More files than the cap | Session unknown |
| Session file unreadable | Unchanged: the session is unknown; transcripts not read |

## 7. Threat-model rows to add (`docs/threat-model.md` §4)

| Component | Threat | Finding to record |
|---|---|---|
| Claude Code subagent paths (`subagent-transcript-path.ts`) | Path traversal; a symlinked folder or file pointing outside `~/.claude/projects` | Mitigated: the folder comes from the provider's own session path; no log value names a file; `lstat` on folders and files, bare-name patterns, symlinks refused; tests |
| Same | Denial of service: 2.5 GB of transcripts, many files, very long lines | Mitigated: streamed line by line, per-session file cap that makes the total unknown, meta size cap, run-summary cache; performance budget test |
| Meta and transcript readers | Information disclosure: prompts, tool output, `description`, `worktreePath` | Mitigated: allow-listed keys only; numbers, ids, enums and model names kept |
| `agentType`, `label`, `id`, `parentRunId` reaching UI and MCP | Hostile text, prompt injection through a custom agent name | Mitigated: schema patterns and length caps; React text nodes; MCP output is data |
| Tool audit and security findings | Subagent tool calls (3.7 × the main agents' on this machine) not scanned | Residual until D9's increment; §7 row |

## 8. Owner decisions

**Decided 2026-11-14:** the owner accepted the recommendation for each of D1–D16 below.

| # | Question | Recommendation |
|---|---|---|
| D1 | A background run keeps going after the user's next prompt (42 % of run usage here). Whole run to the turn whose `Agent` call started it, or each round to the turn in whose time window it ran? | Starting turn: it caused the spend, matches 10.19 and Agent Host, and needs no clock matching. Session, daily and repository totals are the same either way |
| D2 | A run continued by `SendMessage` from a later turn: the starting turn, or the sending turn? | Starting turn in 1.0; show "continued N times" on the run. Revisit if users ask |
| D3 | Nested runs (16 seen): fold in, or unknown (10.19 D6)? | Fold in, listed with `parentRunId`, depth cap 8: they are real spend and the link is reliable |
| D4 | Forked runs repeat the fork point's round: skip rounds whose `requestId` or `message.id` the parent has? | Yes |
| D5 | Runs started from an `Agent` call off the active branch (after an edit or rewind) | Not counted, like the main agent's off-branch rounds; CS0b counts them, and if material a session-level "off-branch runs" note follows |
| D6 | Transcript with no link (2 seen) | Match by time to the turn whose window holds its first line, labelled "matched by time" (10.19 D5); else the session is unknown |
| D7 | `Agent` call whose run lives in another session's folder (1 seen) | Count it only in the session whose folder holds it; this turn lists "counted in another session". Unknown if no folder in the same project has it |
| D8 | `Agent` call that failed to launch (`is_error`, no transcript) | No run; figures stay known |
| D9 | Subagent tool calls in the audit and security findings | In C15, as a second increment after the cost fold, sharing one audit shape with step 10.20 (V21's plan); both residual rows close together |
| D10 | Savings | Main agent only in 1.0, with "N subagent runs not analysed" in coverage; runs in O1 and O5 later |
| D11 | Repository and project of a run started in its own worktree | The parent session's |
| D12 | Rounds column | Main agent only; runs' rounds in the breakdown (10.19 D1) |
| D13 | Subagent summaries for a provider without AI Credits | Add tokens and priced cost to `subagentSpend`, `SessionCost.subagents` and `coverage.subagentRuns` |
| D14 | Runs still running (`finished` absent: 67) | Count as of now, as the parent |
| D15 | Release | The next app release after the build, before 1.0.0, with a CHANGELOG note: Claude Code totals rise about 3 × on heavy subagent use; issued statements show a diff |
| D16 | List performance (2.5 GB here) | In-memory run-summary cache keyed by path, size and mtime; a budget test with runs |

## 9. Risks

| Risk | Effect | Handling |
|---|---|---|
| Undocumented, fast-moving format (19 versions in a month; new line types; the tool may be `Task` on older versions) | Runs unread or unlinked | Unknown with a reason, never smaller; accept both `Agent` and `Task`; fixtures from real structure; the real-data check re-run per release |
| List gets much slower | Sessions view lags | Cache (D16); stream; read only sessions with a `subagents/` folder; budget test |
| Totals jump about 3 × | Users think the app is wrong | CHANGELOG and guide text; the KPI sub-line "incl. X from N subagent runs" |
| Double counting through fork copies or resumed sessions | Totals too high | Fork rule (D4), D7, a property test that no `requestId` is counted twice in a session |
| 1-hour cache writes priced at the 5-minute rate | Cost too low | `extendedCacheWrite` on runs and `ownUsage` (§5.5) |
| Background runs credited to an earlier turn (D1) | Per-turn figures and "most expensive turn" skewed | Documented; the run shows when it ended |
| Schema change touches Copilot paths | Copilot regressions | Optional fields only; SA18 suite re-run |
| V3 and V4 real-data checks assume today's totals | Their oracles disagree after the fold | Re-run both after CS10; their oracles compare `ownUsage` or add runs |
| Hostile `agentType` | Rendering or injection surface | Patterns, caps, text nodes (§7) |

## 10. Exit criterion

A `REAL_DATA` suite, `packages/server/scripts/cs-claude-code-subagents.real.test.mts`,
part of `npm run test:real-data`, passes on the owner's logs and the owner
signs off its output (as SA18, V3, V4). It is read-only and prints session
ids, dates, counts, sums and model names only.

- **Oracle:** an independent lib (`claude-code-subagent-spend-lib.mts`,
  tested) that reads the raw `~/.claude/projects` transcripts and metas and
  shares no code with the server: links by `toolUseId`, rounds by distinct
  `message.id` minus fork copies and `<synthetic>`, tokens per model, and
  priced cost from the bundled price-book files.
- **Actual:** the standalone composition, MCP over an in-memory client.
- **Asserts, per session with runs:** list = detail; Σ runs' tokens = the
  oracle's per field and per model (exact); session total = Σ `ownUsage`
  + Σ runs; `get_session_cost` `subagents.runs` = the oracle's linked runs
  and its priced cost = the oracle's (±0.01 USD); `byModel` sums to the
  total; `coverage.subagentRuns` of `replay_session` lists the same runs;
  no session is known where the oracle finds a missing or unlinkable run.
- **Aggregate:** Σ runs over all sessions = the oracle's grand total;
  `get_cost_rollup` over the logs' date range = Σ session totals;
  `get_repository_cost` for each repository equals the sum of its
  sessions.
- **If D9 is accepted:** `list_tool_calls` count per session = the
  oracle's `tool_use` blocks on the branch plus in linked runs.

## 11. Tasks

TDD in every code task (architecture.md §11.4): failing test first. No local
model in this repo. Specs and the real-data suite are TDD exceptions as in
10.19; their pure helpers are unit-tested.

| ID | Task | Exit | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| CS0 | **Done 2026-11-14 (§4).** Spike: read-only inspection of `~/.claude/projects/**/subagents/` | Findings in §4 | medium | Opus | — |
| CS0b | Close the spike's open points (§13): the run in another session's folder, `isFork` without copied rounds, how a `SendMessage` continuation appears in the transcript, runs off the active branch, a pre-`Agent` version's `Task` layout | §4 and §13 updated; D5–D7 confirmed or changed | low | Sonnet | — |
| CS1 | Threat-model rows (§7) in `docs/threat-model.md` §4 and §7 before reader code | Rows merged | low | Haiku | Plan approved |
| CS2 | Mock-up delta for runs without AI Credits: turns-table marker tooltip, Explanation panel block, KPI sub-line, U1, in `docs/plans/mockups/claude-code-subagents/` | **Done 2026-11-15: boards approved by the owner (all questions as drawn)** | medium | Sonnet (frontend-design skill) + owner | Plan approved |
| CS3 | Synthetic fixtures under `packages/server/fixtures/claude-code/subagents/`: linked run, nested run, fork copy, failed launch, missing transcript, unlinked transcript, symlink (made at test time), cap (generated), partial last line, off-branch call, `<synthetic>` round, 1-hour writes | A test reads each and finds the expected counts | medium | Sonnet | CS0b |
| CS4 | **Done 2026-11-15.** Domain (§5.1): `label`, `attribution`, `parentRunId`, `extendedCacheWrite` on runs and `ownUsage`; tokens and priced cost on the three summaries | Schema tests: valid, hostile label and id rejected, Copilot and Learn fixtures still parse | medium | Sonnet | D13 |
| CS5 | `subagent-transcript-path.ts` (§5.3) | Tests: symlinked folder and file, directory, other names, cap, missing folder | low | Sonnet | CS3 |
| CS6 | `subagent-meta.ts` allow-list | Tests: dropped keys, caps, malformed JSON, oversize | low | Sonnet | CS3 |
| CS7 | `round-usage.ts` extracted; `subagent-run-usage.ts` | Existing usage tests unchanged; run tests: sums, 1-hour split, fork copies skipped, `<synthetic>`, missing field, partial line | medium | Sonnet | CS4, CS6 |
| CS8 | `subagent-attribution.ts` (§5.4, §6) | Every row of §6 and D1–D8 is a test; none yields a known total that leaves a round out | high | Opus | CS5, CS7 |
| CS9 | Merge and cost lines: reuse or generalise `mergeSubagentUsage`; `turnLinesOf` with `extendedCacheWrite`; property test (lines sum to the row, no `requestId` twice) | Tests pass; Copilot golden tests unchanged | high | Opus | CS8 |
| CS10 | Provider wiring, shared for list and detail; run-summary cache; budget test | Contract test "list equals detail" on a session with runs; budget test with 2.5 × the session bytes in runs | medium | Sonnet | CS9, D16 |
| CS11 | Session summaries, replay coverage and savings coverage (D10, D13) | `session-cost-builder`, `session-replay-service`, `savings-service` tests | medium | Sonnet | CS10 |
| CS12 | MCP text: server instructions, `get_turn`, `get_session_cost`, `replay_session` descriptions; tool-list snapshots | `mcp/security.test.ts` passes; snapshots updated on purpose | low | Sonnet | CS11 |
| CS13 | Web and MCP App U1 per CS2; Playwright spec `packages/web/e2e/specs/claude-code-subagents.spec.ts` and one in `packages/mcp-apps/e2e/specs/` | Component tests with axe; `web-e2e` and `mcp-apps-e2e` pass | medium | Sonnet | CS2, CS11 |
| CS14 | Tool audit increment (D9): subagent tool calls in the audit and security findings, one shape with step 10.20 | Audit tests; threat-model residual closed | high | Opus | V21 approved, CS10 |
| CS15 | Docs (§12) | Docs match the code; Gantt updated | medium | Sonnet | CS10–CS14 |
| CS16 | Real-data suite and oracle (§10); owner run and sign-off | §10 passes; owner signs off | medium | Opus (suite), owner | CS15 |

Critical path: CS0b → CS3 → CS5/CS6 → CS7 → CS8 → CS9 → CS10 → CS11 →
CS13 → CS15 → CS16. CS1, CS2 and CS4 run beside CS3–CS7; CS14 after V21.

## 12. Docs to update (CS15)

- `docs/architecture.md`: §5 (schema additions), §6.2.6 (replace "out of
  scope for v1" with the layout, links and rules), §6.4 (lines with
  `extendedCacheWrite`), §6.5 (replay coverage), §11.2 (path rules).
- `docs/threat-model.md` (CS1), `docs/terminology.md` ("subagent run" for
  both vendors).
- `docs/UserGuide.md`: what the marker, block and coverage line mean for
  Claude Code; why totals rose.
- `CHANGELOG.md` `[Unreleased]`: Claude Code totals include subagents;
  issued statements may show a diff.
- `docs/plans/savings-report.md` §6 (runs not analysed),
  `docs/plans/analyze-session-replay.md` (coverage), this plan's status.
- `docs/implementation-plan.md` (C15 status, V32/V33) and
  `docs/implementation-plan-gantt.md` (C15 bar, criteria count, Open
  items).

## 13. Not verified

- What put one `Agent` call's run in another session's folder (resume,
  `--fork-session` or a moved file); CS0b.
- Why 9 `isFork` runs copied no parent round.
- How a `SendMessage` continuation shows in the transcript (31 transcripts
  hold more than one prompt; 237 calls named an agent).
- How many runs hang off `Agent` calls that are off the active branch.
- The layout on Claude Code versions that named the tool `Task`; only
  2.1.300–2.1.325 are on this machine.
- Whether a run's own `/compact` writes a `compact_boundary` (none seen).
- The 71 % share uses a rough price weight, not the price book; CS16 gives
  the priced figure.
