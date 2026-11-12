# AI Credits of classic Copilot Chat subagents: implementation plan (step 10.19)

**Last changed:** 2026-11-13 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **planned; owner decisions accepted 2026-11-12 (every recommendation); implementation started 2026-11-12**. Turns the design in [classic-subagent-credits.md](classic-subagent-credits.md) (status "proposed", #124) into a numbered step. The owner decisions in §9 are accepted.

## 1. Why

- A classic Copilot Chat session (Local harness, `copilotHarness: "local"`, set in `session-enricher.ts`) starts subagents with `runSubagent` and `searchSubagent`.
- Each run writes its own debug log next to the parent's `main.jsonl`; its `llm_request`s and their `copilotUsageNanoAiu` are only in that file.
- `VscodeLogProvider` (`packages/server/src/data-sources/log-providers/vscode/vscode-log-provider.ts`) opens only `<session>/main.jsonl` (`resolveMainJsonlPath` in `session-log-path.ts`), so that spend is in no total.
- The totals look complete but are not. This breaks constraint 6 (architecture.md §2): a total must never be silently partial.
- Measured on the owner's machine on 2026-11-05 (design §1.1): 177.64 AI Credits missing over 8 sessions, up to 117 % of a session's counted total; in 8 of 10 affected parent turns the subagent cost more than the turn.
- Those figures are 7 days old and come from logs dated 2026-08-08 to 2026-10-01. Retention may have removed some since (unverified; SA0 re-measures).

## 2. Goals and non-goals

Goals:

- Every classic session's AI Credits include its subagent runs, in the Sessions view, the panel, the status bar, every rollup, statement and MCP tool, with no double counting.
- A run that can't be read or placed makes the affected total unknown with a reason, never a lower known number (constraint 6).
- Per-model figures credit each run's own model, on every cost basis (billed, reported, priced).
- The user sees which part of a turn's cost came from which subagent.

Non-goals (checked against vision §6 and the design):

- No subagent sessions in the Sessions list (design option C).
- No subagent rounds in the turn inspector (as Agent Host; D4).
- No subagent tool calls in the tool audit or security findings in this step (D3; a follow-up step).
- No replay of subagent chains: replay stays main chain only (analyze-session-replay.md D6).
- Claude Code subagent transcripts stay out of scope (architecture.md §6.2.6).
- No per-model split for Agent Host turns (D14).
- Read-only and local, as everything else (vision §6): no write, no network.

## 3. The design doc against today's code

Checked by reading the code on `main` at `2a71f11`. "Holds" means the claim is still true; "changed" means the plan below adapts it.

| Design claim | Today | Verdict |
|---|---|---|
| `VscodeLogProvider` reads only `main.jsonl` | `summarizeSessionWithCost`, `readClassicSession`, `readClassicRequestTrace`, `readClassicTurnDetail` all resolve `<id>/main.jsonl`; no code mentions `child_session_ref`, `runSubagent` file names or `parentSessionId` | Holds |
| Session folder is `workspaceStorage/<hash>/GitHub.copilot-chat/debug-logs/<id>/` | Step 10.18 added `globalStorage/github.copilot-chat/debug-logs/<id>/` for empty windows (`listWorkspaceDebugLogsDirPaths`) | Changed: the session folder is `dirname(resolveMainJsonlPath(...))`, which covers both. Whether Copilot writes subagent files in the global folder too is unverified (SA0) |
| Add keys to `KNOWN_ATTRS_KEYS`; add `parentSpanId` to `JsonlEnvelope` | `main-jsonl-reader.ts` still has the 9 keys and no `parentSpanId`; `parseEnvelopeLine` now also adds a `contentDigest` to `user_message` | Holds; the digest is kept |
| Turn of a ref = position among `user_message`s (`groupEnvelopesByUserMessage`) | Since #126, log turns are placed on store turns by `alignLogTurnsToStore` + `placeByStoreIndex` (`log-turn-alignment.ts`); a log turn can be unplaced (`null`) | Changed: refs and orphans are grouped by **log** turn and placed with the same alignment (§4.3) |
| `listSessions` and `readSession` share one function | They don't share one yet; each calls `readMainJsonlFile`, `alignLogTurnsToStore`, `extractTurnUsages` itself | Holds as a task (SA9) |
| `summarizeSessionUsage` takes an orphan marker | Its signature is now `(mainJsonlAvailability, storeTurnIndices, turnUsages)` and it adds log-only turns | Changed: the marker is a 4th, optional parameter |
| `extractLlmRequestUsage` reads subagent requests unchanged | `llm-request-extractor.ts` reads `inputTokens`, `outputTokens`, `cachedTokens`, `copilotUsageNanoAiu`, `model`, `responseId` | Holds |
| `AI_CREDITS_NOT_AVAILABLE_REASON` all-or-nothing per turn | `aggregateAiCredits` in `session-usage-spans.ts` | Holds |
| `TurnView` reuses `turnUsageSchema`, so `get_turn` carries `subagents` | `turn-view.ts` uses `turnUsageSchema` | Holds |
| Option A makes every consumer that sums turns correct "with no change" | True for AI Credits and tokens. Phase 15 added the priced basis: `TurnCostFigureBuilder.figuresFor` (`services/pricing/turn-cost-figures.ts`) prices `turn.usage` at `turn.usage.model` (`cost-pricer.ts` line 78) | Changed: folded subagent tokens would be priced at the parent's model. Priced figures need per-model lines (§4.5) |
| Per-model split is optional (open question 2, R6) | Phase 15 consumers key on `model`: `price-change-finding-detector.ts` compares billed with priced per model, `statement-builder.ts` keys lines by model, `variance-analyzer.ts` and `time-series-builder.ts` group by model | Changed: without the split, false observed price changes and wrong statement lines. The split ships with the fold (D2) |
| `get_session_cost` `byModel` comes from session turns | `buildSessionCost` (`services/cost/session-cost-builder.ts`) now builds from `buildInsightRows` | Changed: the split goes into the Insights rows, once |
| Cost-outlier findings are per turn | `anomaly-detector.ts` scores sessions only | Changed: only session z-scores move |
| Status bar sums list summaries | `status-bar-model.ts` sums `session.costAiCredits` | Holds |
| Agent Host is unaffected | Its totals come from `session.db` and include subagent calls; the turn's model is the store's (`agent-host-session-builder.ts`) | Holds for totals. The same per-model gap exists there (unverified whether its subagents used other models; D14) |
| Replay (not in the design) | `buildLocalRequestTrace` (`jsonl/local-request-trace.ts`) reads `main.jsonl` only, so the trace is the main chain, as replay D6 wants. The replay's measured figure per turn comes from `turn.usage` (`session-replay-service.ts`) | New: after the fold, measured would include runs the replay leaves out (§4.7, D11) |
| MCP App views (not in the design) | U1 drill-down uses `toTurnDetailViewModel` (`mcp-apps/src/view-models/turn-detail.ts`); U4 shows `byModel` (`cost-rollup.ts`) | New: U1's turn detail lists runs (SA14) |
| Statements (not in the design) | Issued statements are diffed against a re-run (step 15.11) | New: a statement issued before this step shows a diff where a period has affected sessions (D13) |
| Tool audit sees the parent's call | `tool-kind-resolver.ts` maps `runsubagent` to kind `subagent` | Holds |
| Fixtures under `packages/server/fixtures/jsonl/subagents/` | `fixtures/jsonl/` exists, no `subagents/` | Holds as a task |
| "`ext-v0.1.0` shipped without this fix" | Extension 0.8.0 and app 0.12.0 are released (implementation-plan.md) | Changed: the fix targets the next release pair (D9) |
| "Make it step 10.17" (open question 9) | 10.17 is the release UI gate, 10.18 empty-window sessions | Changed: step 10.19 (§5) |

## 4. Design

Option A of the design (fold runs into the parent turn) with E's unknown rules, plus three additions the code now needs: the turn's own usage kept beside the folded total, cost lines per model, and a replay rule.

### 4.1 Domain (`packages/domain`)

`turn-usage.ts`, all optional and additive:

```ts
export const subagentRunUsageSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), // childSessionId (the tool call id)
  label: z.string().regex(/^(runSubagent-[A-Za-z0-9_ -]{1,64}|searchSubagent)$/),
  agentName: z.string().max(64).optional(),        // from the `subagent` event
  model: z.string(),                               // latest known model of its requests
  roundsCount: z.number().int().nonnegative(),     // its llm_requests
  uncachedInput: tokenCountSchema,
  cacheWrite: tokenCountSchema,
  cacheRead: tokenCountSchema,
  reasoning: tokenCountSchema,
  output: tokenCountSchema,
  costAiCredits: tokenCountSchema,
  startedAt: z.string().datetime().optional(),
  attribution: z.enum(["child-session-ref", "timestamp"]),
});

// TurnUsage gains:
subagents: z.array(subagentRunUsageSchema).optional(), // absent = none read
ownUsage: ownTurnUsageSchema.optional(),              // the main agent's own figures; present iff subagents is
```

- The turn's existing fields become "everything billed for this turn" (design §4.2).
- `ownUsage` (same token fields plus `costAiCredits` and `model`) is new. It keeps the main agent's figures when a run is unknown, so a per-model line stays known for the parent's model. Without it the parent's part would be a subtraction from an unknown total (D10).
- `sessionSchema` gains `subagentSpend?: { runs: number; costAiCredits: TokenCount }`, computed by `summarizeSessionUsage` for both list and detail (D12). The Sessions view tooltip needs it; the list never holds turns.
- `insightTurnRowSchema` (`insights.ts`) gains `lines?: CostLine[]`: one per model (the main agent's, then each run's), each with the token figures, `aiCredits`, `cost: TurnCostFigures` and `subagent: boolean`. Present only for turns with runs; the lines sum to the row.
- A pure `costLinesOf(row)` (domain or `services/cost/cost-aggregation.ts`) returns `row.lines ?? [row]`.

### 4.2 Reader (`packages/server/src/data-sources/jsonl/`)

New files, one responsibility each (§11.5):

| File | Exports | Rule |
|---|---|---|
| `main-jsonl-reader.ts` (changed) | `KNOWN_ATTRS_KEYS` + `childSessionId`, `childLogFile`, `label`, `parentSessionId`, `agentName`; `JsonlEnvelope.parentSpanId` | Ids and labels only, no content |
| `child-session-refs.ts` | `collectChildSessionRefs(envelopes)` → `{ logTurnIndex, childSessionId, childLogFile, label, ts }[]` | A ref before the first `user_message` has no log turn (unplaceable) |
| `subagent-log-path.ts` | `SUBAGENT_LOG_NAME`, `resolveSubagentLogPath(sessionDir, childLogFile)`, `listSubagentLogFiles(sessionDir)` | `^(runSubagent-[A-Za-z0-9_-]+|searchSubagent-[A-Za-z0-9_-]+)\.jsonl$`; same folder only; `lstat` must be a regular file (no symlink); at most `MAX_SUBAGENT_FILES_PER_SESSION` (proposed 200) |
| `subagent-run-usage.ts` | `extractSubagentRunUsage(envelopes, rawLineCount, ref)` | Sums with `extractLlmRequestUsage`; AI Credits all-or-nothing; 0 requests → known 0; a nested `child_session_ref` → unknown "nested subagents are not read" |
| `subagent-attribution.ts` | `attributeSubagentRuns(refs, runs, logTurnWindows, folderId)` → `{ byLogTurn: Map<number, SubagentRunUsage[]>, unplaceable: string[] }` | Refs first; then orphans by `parentSessionId` and the log turn's `user_message.ts` window |
| `subagent-usage-merge.ts` | `mergeSubagentUsage(turnUsages, byLogTurn)` | Design §4.2 sums with `sumTokenCounts`; sets `subagents` and `ownUsage`; a `null` turn stays `null` |
| `classic-usage-reader.ts` | `readClassicUsage({ mainJsonlPath, storeTurns, agentTracesDbPath? })` → `{ availability, turnUsages, unplaceableReason?, envelopes }` | The one function both `summarizeSessionWithCost` and `readClassicSession` call; only `readSession` passes `agentTracesDbPath` (as today) |

Subagent files stream through `readMainJsonlFile` with the same projector, so no prompt, response, tool or hook text is kept. They are read only when the folder has a ref or a file matching the name pattern (design R3).

### 4.3 Turn placement

1. `extractTurnUsages(envelopes)` gives usage per **log** turn, as today.
2. `attributeSubagentRuns` gives runs per **log** turn.
3. `mergeSubagentUsage` merges them per log turn.
4. `placeByStoreIndex(merged, alignLogTurnsToStore(...))` lays them on store turns, as today.

Merging before placement keeps one alignment for usage and runs. When alignment returns all `null`, the merged usages drop with the turns they belong to, and the session is already unknown through `summarizeSessionUsage`'s fallback (no new silent loss).

### 4.4 Unknown rules

The design's §4.3 table holds unchanged, with these additions:

| Case | Effect |
|---|---|
| A file that is a symlink or not a regular file | As "missing", reason "not a regular file" |
| More than `MAX_SUBAGENT_FILES_PER_SESSION` matching files | Session AI Credits unknown, reason "too many subagent logs to read" |
| Ref on a log turn before the first `user_message` | Unplaceable: session AI Credits unknown |
| Session folder is the global folder (10.18) | Same rules; SA0 confirms the layout |

### 4.5 Cost lines by model (Phase 15)

- `TurnCostFigureBuilder.figuresFor` prices each line on its own model and sums them; any unknown line makes the priced figure unknown with that line's reason. Billed sums the lines' AI Credits. Reported stays "no cost of its own" for Copilot.
- `turnRow` in `insights-dataset-builder.ts` emits `lines` from `usage.ownUsage` and `usage.subagents`, each with its own `TurnCostFigures`; the row's `cost` is their sum.
- Turn counts stay one per turn: the cube (`cost-cube.ts`) keeps one row per turn and gains `lines`. Only model-keyed code calls `costLinesOf`:

| Consumer | File | Change |
|---|---|---|
| `get_session_cost` `byModel` | `services/cost/session-cost-builder.ts` | Group lines, not rows |
| `get_cost_rollup` `byModel`, monthly by model | `services/cost/cost-rollup-builder.ts` (lines 102, 158) | Same |
| Compare / project by model | `services/cost-analysis/cube-aggregation.ts` | The model dimension groups lines; a turn counts once per model it used |
| Price-change markers | `services/cost-analysis/time-series-builder.ts` (line 107) | (channel, model) pairs from lines |
| Variance by model | `services/cost-analysis/variance-analyzer.ts` | Items per line |
| Statement lines | `services/billing/statement-builder.ts` (line key at 60) | Lines keyed per line's model; `coverage.turns` still counts rows |
| Observed price changes | `services/insights/price-change-finding-detector.ts` | Billed vs priced per line |
| First-time model | `services/insights/behavior-change-detector.ts` | Also sees run models |

A property test asserts: for any row, Σ lines = row on every figure; per-model totals sum to the overall total; turn counts equal row counts.

### 4.6 Every consumer

| Consumer | Effect | Change |
|---|---|---|
| Sessions view (tree), Sessions list (web) | Correct totals | Tree tooltip line "incl. X AI Credits from N subagent runs" (`sessions-tree-model.ts`, `sessions-by-repository-tree-model.ts`) |
| Status bar | Correct | None; a test proves it |
| Session detail: KPI tiles, sparkline, cumulative column | Correct (`session-kpis.ts` sums turns) | KPI tile sub-line from `subagentSpend` |
| Turns table | Cells include runs | Marker on the AI Credits cell, tooltip "incl. X from N subagents" (`TurnsTable.tsx`) |
| Explanation panel | — | "Subagents this turn" block (`ExplanationPanel.tsx`); `describeTurnUsage` (`services/turn-usage-sentence.ts`) names the share |
| Turn inspector | Unchanged | Note "N subagent runs not shown" (`TurnInspector.tsx`, D4) |
| `get_turn` | `usage` with `subagents` | Description and server instructions (`mcp/session-tools.ts`, `mcp/mcp-identity.ts`) |
| `get_session_cost` | Totals, top turns, `byModel` correct | Optional `subagents` summary in `cost.ts` |
| `get_cost_rollup`, cost cube, statements, estimates, variance | Correct via lines | §4.5 |
| `list_findings` | Session z-scores and price-change findings use true figures | §4.5 |
| Replay, `compare_models_for_session`, `estimate_cost` with `model` | Main chain only | §4.7 |
| MCP App U1 turn drill-down | — | Runs listed (`turn-detail.ts`, `views/session-cost/`) |
| MCP App U4 | `byModel` split | None beyond data |
| Agent Host, Claude Code, pi, mitmproxy, Learn | Unchanged | None |

### 4.7 Replay

- The trace stays main chain (D6 of the replay plan).
- The measured figure the replay compares per turn becomes `ownUsage` where present, so simulated and measured cover the same requests (D11).
- Coverage gains "N subagent runs not replayed (X AI Credits)"; the session's full measured total stays visible next to it.
- The self-check is unaffected (it compares the trace with its own replay).

### 4.8 Presentation

The mock-ups (SA0b) settle the exact layout. Proposed:

- Turns table: a small "subagent" glyph after the AI Credits value; the tooltip and the accessible name say "incl. 42.06 AI Credits from 1 subagent run (Explore)".
- Explanation panel: a "Subagents this turn" table with label, agent, model, requests, AI Credits, and "matched by time" when `attribution` is `timestamp`.
- KPI tile: "incl. 54.65 from 3 subagent runs" under the session's AI Credits.
- Sessions view tooltip: the same line under the cost.
- Unknown runs show the reason text, never 0.

### 4.9 Fixtures

Made-up data only: invented ids, `user_message` texts like "Fixture prompt 1", no real chat text, no real paths.

- `packages/server/fixtures/jsonl/subagents/`: one folder per case (the design's task 1 list, plus a symlink case created at test time, a file-count cap case generated at test time, and a ref before the first `user_message`).
- A store row set for each case through `test-support/copilot-session-store.ts`.
- The provider contract fixture (`log-providers/contract.ts`'s list-equals-detail test) gains a session with runs.
- The UI fixture (`packages/vscode-extension/scripts/ui-automation/ui-fixture.mts`) gains two classic sessions: one with a `runSubagent` and a `searchSubagent` run, one with a dangling ref. `listedSessionCount` rises by 2.
- The web e2e fixture home (`packages/web/e2e/support/fixture-home.mts`, `copilotSession`) gains one classic session with a run.

## 5. Step id and release

- **Step 10.19** in Phase 10's table (implementation-plan.md) and `plans/vscode-extension.md`.
- Why Phase 10: its steps 10.13–10.15 and 10.18 are the Copilot provider steps; each changes the shared server reader that both products use. 10.19 is the next free number.
- Not Phase 4: that phase is closed. Not Phase 15: the cause is the reader; §4.5 is a consequence.
- Release: the next extension release after 0.8.0 and app 0.13.0 (D9).

## 6. Tasks

Every task writes its failing test first (architecture.md §11.4). No local model in this repo. The specs and the fixture seeding are TDD exceptions as in step 10.16 (only a real run tests them); their pure helpers are unit-tested.

| ID | Work | Exit criterion | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| SA0 | **Re-measure.** **Done 2026-11-12 (§14).** Read-only script over the owner's `Code` and `Code - Insiders` user data (both `workspaceStorage` and `globalStorage` debug-log folders): counts and sums only, as design §1.1. Confirm the file layout and field names still match design §2. | A findings note in this plan with today's baseline (missing AI Credits per session); layout confirmed or §4 changed | low | Sonnet (script), owner (run) | — |
| SA0b | **Approved 2026-11-13** (#244; answers in [mockups/classic-subagents/README.md](mockups/classic-subagents/README.md)). **Mock-ups.** Turns table marker and tooltip, Explanation panel block, KPI sub-line, Sessions view tooltip, U1 turn detail; states: known, 0.00 run, unknown run, matched by time; light, dark, High Contrast; 320 px and 640 px. In `docs/plans/mockups/classic-subagents/`. | Owner approves before SA13–SA15 | medium | Sonnet (frontend-design skill) + owner | — |
| SA1 | **Threat-model rows** (§8) added to `docs/threat-model.md` §4 before any reader code. | Rows merged | low | Haiku | — |
| SA2 | **Fixtures** (§4.9) for the server. | Fixture files exist; a test reads each with `readMainJsonlFile` and finds the expected event counts | medium | Sonnet | SA0 |
| SA3 | **Domain.** `subagentRunUsageSchema`, `TurnUsage.subagents` and `ownUsage`, `Session.subagentSpend`, `InsightTurnRow.lines`, `costLinesOf`. | Schema tests: valid, unknown figures, absent, hostile `label`/`id` rejected; Learn fixtures still parse | medium | Sonnet | D1, D10, D12 |
| SA4 | **Reader keys and refs.** Allow-list keys, `parentSpanId`, `collectChildSessionRefs`. | Tests: refs with and without `parentSpanId`, before the first turn, content keys still dropped | low | Sonnet | SA2 |
| SA5 | **Subagent log paths.** `resolveSubagentLogPath`, `listSubagentLogFiles`. | Tests: `../`, `/`, absolute, other names, symlink, directory, cap; global and workspace folders | low | Sonnet | SA2 |
| SA6 | **Run usage.** `extractSubagentRunUsage`. | Tests: sums, all-or-nothing AI Credits, 0 requests, unknown model, `startedAt`, `agentName`, nested ref, partial last line | medium | Sonnet | SA3, SA4 |
| SA7 | **Attribution.** `attributeSubagentRuns` per log turn. | Every row of design §4.3 and §4.4 here is a test; none yields a known total that leaves a request out | high | Opus | SA5, SA6, D5, D6 |
| SA8 | **Merge.** `mergeSubagentUsage`; `summarizeSessionUsage` takes the unplaceable reason and returns `subagentSpend`. | Tests per design §4.2 rule; `cacheWrite`/`reasoning` stay known only when every part is | high | Opus | SA3, SA7, D1 |
| SA9 | **Provider wiring.** `readClassicUsage` used by `summarizeSessionWithCost` and `readClassicSession`; the agent-traces join on runs' `responseId`s in `readSession` only. | Contract test "list equals detail" passes on the session with runs; provider tests for every unknown reason; the §3.5 performance budget test (200 sessions) still passes with runs in 10 % of them | medium | Sonnet | SA8 |
| SA10 | **Cost lines.** §4.5: `TurnCostFigureBuilder`, `turnRow`, cube `lines`, and the eight consumers. | Property test (§4.5); golden tests in `cost-analysis.golden.test.ts`, `statement.golden.test.ts`, `estimate.golden.test.ts` updated only where a fixture has runs; no false price-change finding on the fixture | high | Opus | SA3, SA9, D2 |
| SA11 | **Replay.** Measured per turn from `ownUsage`; coverage line for runs. | `session-replay-service` tests: a turn with runs compares like with like; coverage names the runs; self-check unchanged | medium | Sonnet | SA9, D11 |
| SA12 | **Explanation and MCP text.** `describeTurnUsage` names the subagent share; `SessionCost.subagents`; `get_turn`/`get_session_cost` descriptions and server instructions. | Sentence tests; `mcp/security.test.ts` passes; the tool-list snapshots (`packages/server/src/mcp/__snapshots__/tool-list-standalone.json` and `packages/vscode-extension/src/mcp/__snapshots__/tool-list-extension.json`) updated on purpose for the output schema, descriptions and instructions | medium | Sonnet | SA9 |
| SA13 | **Web panel** per the approved mock-ups: `TurnsTable`, `ExplanationPanel`, `SessionKpiTiles`, `TurnInspector` note. | Component tests incl. a11y (axe), keyboard and hostile-text cases; the 10.11 UI check covers the new marker | medium | Sonnet | SA0b, SA9, SA12, D4, D8 |
| SA14 | **MCP App U1.** `toTurnDetailViewModel` and the drill-down list runs. | View-model and view tests; a spec in `packages/mcp-apps/e2e/specs/` (§7) | medium | Sonnet | SA0b, SA10, SA12 |
| SA15 | **Extension.** Tree tooltips; status bar test; UI fixture sessions (§4.9); a list-equals-detail unit test like `ui-fixture-credits.test.ts`; the wdio spec (§7). | `extension` and `extension-ui` CI jobs pass | medium | Sonnet | SA0b, SA9, SA13 |
| SA16 | **Standalone app.** Fixture home session; Playwright spec (§7). | `web-e2e` passes | medium | Sonnet | SA10, SA13 |
| SA17 | **Docs** (§10). | Docs match the code; Gantt updated | medium | Sonnet | SA10–SA16 |
| SA18 | **Real-data check and release.** Re-run SA0's script against the built server: list, detail, status bar figure, `get_session_cost`, `get_cost_rollup`. Then the release gate. | The exit criterion (§12) | low | owner, Sonnet (script) | SA17 |

Critical path: SA0 → SA2 → SA4/SA5 → SA6 → SA7 → SA8 → SA9 → SA10 → SA16 → SA17 → SA18. SA0b and SA1 run beside SA2–SA9; SA11 and SA12 beside SA10.

## 7. UI checks (automated, owner rule of 2026-11-11)

No manual checklist rows. Each spec runs in the existing required CI job and in the release workflows.

| Spec | Tool, job | Asserts |
|---|---|---|
| `packages/vscode-extension/test/ui/specs/subagent-credits.e2e.ts` | wdio, `extension-ui` | Over the seeded classic session with runs: the Sessions view row shows the folded total and its tooltip the subagent line; the panel's turn row has the marker with the tooltip text; the Explanation panel lists both runs (the `searchSubagent` run at 0.00 per D8); the session with a dangling ref shows "AI Credits unknown" and the missing-log reason; the status bar total equals the sum of the seeded sessions started today |
| `packages/vscode-extension/test/ui/specs/layout-theme.e2e.ts` (extended) | wdio, `extension-ui` | The marker and the block in Light, Dark and both High Contrast themes, non-text contrast ≥ 3:1, at 320 px |
| `packages/web/e2e/specs/subagent-credits.spec.ts` | Playwright, `web-e2e` | The standalone app's turns table and Explanation panel as above; the Dashboard's by-model view credits the run's model |
| `packages/mcp-apps/e2e/specs/` (one new spec) | Playwright fake host, `mcp-apps-e2e` | U1: expanding the turn with runs lists them; unknown run shows its reason; Claude and VS Code theme sets with axe |

The real-Copilot suite gets no new spec: the feature reads files, and a real classic subagent run would need the Local harness and cost AI Credits.

## 8. Threat-model rows to add (`docs/threat-model.md` §4)

| Component | Threat | Finding to record |
|---|---|---|
| Classic subagent log reader (`subagent-log-path.ts`, `child-session-refs.ts`) | Path traversal through `childLogFile`, which comes from a log file | Mitigated: a bare file name matching the subagent pattern, resolved in the session's own folder only, `lstat` regular file only; traversal and symlink tests |
| Same | Denial of service by many or large subagent files | Mitigated: read only for folders with a ref or a matching name; streamed line by line; a per-session file cap that makes the total unknown, never partial |
| Same | Information disclosure: subagent prompts, tool results and hook output | Mitigated: the same attrs allow-list as `main.jsonl`; only ids, labels, counts and model names are kept |
| `label`, `agentName`, `id` reaching the UI and MCP tools | Hostile text, prompt injection through a crafted label | Mitigated: schema patterns and length caps (§4.1); React text nodes; MCP output is data |
| Tool audit and security findings | Subagent tool calls are not scanned | Residual (§7 of the threat model) until the follow-up for D3 |

## 9. Owner decisions

The design's open questions 1–9 map to D1–D9; D10–D15 are new.

| # | Question | Recommendation |
|---|---|---|
| D1 | Rounds column: the main agent's round trips, or with the runs' requests added? (Q1) | **Accepted 2026-11-12:** Main agent only; runs' requests in the breakdown |
| D2 | Ship the per-model split with the fold, or fold first? (Q2) | **Accepted 2026-11-12:** With the fold: Phase 15's priced basis, statements and price-change findings are wrong without it (§3) |
| D3 | Subagent tool calls in the audit and findings? (Q3) | **Accepted 2026-11-12:** A follow-up step (10.20), as Agent Host already does it; record the residual now |
| D4 | Inspector: rounds, a note, or nothing? (Q4) | **Accepted 2026-11-12:** A note |
| D5 | Orphan file: attribute by time, or always unknown? (Q5) | **Accepted 2026-11-12:** By time, labelled "matched by time" |
| D6 | Nested subagents: read recursively, or unknown? (Q6) | **Accepted 2026-11-12:** Unknown until one is seen |
| D7 | A dangling ref turns a known total unknown (Q7) | **Accepted 2026-11-12:** Accept (constraint 6) |
| D8 | Show 0.00 `searchSubagent` runs? (Q8) | **Accepted 2026-11-12:** Show them: the source says 0 |
| D9 | Which release? (Q9) | **Accepted 2026-11-12:** Step 10.19, in the next extension release after 0.8.0 and app 0.13.0; not before SA0 confirms the gap still exists in retained logs |
| D10 | Keep the main agent's own figures (`ownUsage`) beside the total? | **Accepted 2026-11-12:** Yes; subtraction fails when a run is unknown |
| D11 | Replay compares the main chain with `ownUsage` and lists runs as not replayed? | **Accepted 2026-11-12:** Yes |
| D12 | A session-level `subagentSpend` for the Sessions view tooltip and KPI tile? | **Accepted 2026-11-12:** Yes |
| D13 | Issued statements re-run with higher figures and show a diff | **Accepted 2026-11-12:** Accept; note it in both CHANGELOGs |
| D14 | Agent Host per-model split (its subagent calls sit under the turn's model) | **Accepted 2026-11-12:** Out of scope; investigate in a follow-up |
| D15 | If SA0 finds no classic subagent logs left in retention | **Accepted 2026-11-12:** Ship anyway (users with the Local harness still produce them), or park the step; recommend ship, as the cost is bounded and the gap is silent |

## 10. Docs to update (SA17)

- `docs/architecture.md`: §5 (the new schemas), §6.2.2 (subagent files, refs, placement, unknown rules), §6.4 (cost lines per model), §6.5 (replay: runs not replayed), §11.2 (the name allow-list).
- `docs/UserGuide.md` and `docs/vscode-extension-guide.md`: what the marker, block, tooltip and "matched by time" mean; unknown reasons.
- `CHANGELOG.md` and `packages/vscode-extension/CHANGELOG.md` `[Unreleased]`: totals now include classic subagents; some totals rise, some become unknown; issued statements may show a diff.
- `docs/implementation-plan.md`: Phase 10 table row 10.19; replace the "no step number yet" sentence.
- `docs/plans/vscode-extension.md`: step list row and §6 status note.
- `docs/plans/classic-subagent-credits.md`: status points to step 10.19; its §3 corrections.
- `docs/threat-model.md` (SA1), `docs/terminology.md` ("subagent run").
- `docs/implementation-plan-gantt.md`: a 10.19 bar, Phase 10 percentage, Open items.

## 11. Risks

| Risk | Effect | Handling |
|---|---|---|
| Undocumented format (`child_session_ref`, file names) changes in a Copilot Chat update | Runs show as orphans or missing | Unknown with a reason, never a lower number; SA0 re-checks; fixtures from the real structure |
| Known totals turn unknown (dangling ref, cap, unplaceable orphan) | Users see "unknown" where a number was | Intended (D7); each reason says what is missing |
| Few or no classic subagent logs remain in retention | Little visible benefit | SA0 measures; D15 |
| List read gets slower | Sessions view lags | Read only flagged folders; streaming; SA9's performance budget test |
| §4.5 misses a model-keyed consumer | One view still shows a wrong per-model figure | The property test over lines; a search for `.model` in `services/` during SA10's review |
| Turn counts change by mistake when lines are added | Wrong "per turn" figures, statement coverage | Rows stay one per turn; the property test checks counts |
| Replay measured figure moves (D11) | Replay summaries change for classic sessions | Tests in SA11; CHANGELOG note |
| `responseId` repeats (design R5) | The agent-traces join may pair a run's request with the wrong span | Unchanged behaviour; the run's `cacheWrite`/`reasoning` stay all-or-nothing |
| Statements issued earlier differ on re-run | A diff on an issued period | D13; the diff is the designed signal |
| Hostile label text | Rendering or prompt-injection surface | Schema patterns, text nodes (§8) |

## 12. Exit criterion

On the owner's machine, the classic sessions' AI Credits rise by exactly SA0's measured missing amount (±0.01) per session, with the same figure in the Sessions view, the panel, the status bar, `get_session_cost`, `get_cost_rollup` and U1; `byModel` credits each run's model; every unknown rule in §4.4 and design §4.3 has a test; and CI plus the release gate pass with the specs in §7.

## 13. Not verified

- That Copilot Chat 0.74 still writes subagent files: the newest classic session (2026-11-10, 0.74) ran no subagent. Versions 0.60–0.69 do (§14).
- Subagent files in the `globalStorage` folder for empty windows: its one session ran no subagent (§14).
- Whether Agent Host subagents ran on other models than their turn's (D14).
- How the replay currently treats measured figures of Agent Host turns that include subagent calls (read only for classic; checked in SA11).
- The exact list of model-keyed consumers in §4.5 comes from a search of `services/`; `packages/web` charts that group by model client-side were not searched.
- That `MAX_SUBAGENT_FILES_PER_SESSION` = 200 is a sensible cap (design §1.1 saw at most 3 per session).

## 14. SA0 findings (2026-11-12)

Script: `packages/server/scripts/measure-subagent-spend.mts` (pure helpers in `subagent-spend-lib.mts`, tested). Run from the repo root: `npx tsx packages/server/scripts/measure-subagent-spend.mts [--json] [--user-data <dir>]`. Output is counts, sums, session ids, model names and dates only.

- **Layout:** unchanged from design §2. `runSubagent-<agent>-<id>.jsonl` and `searchSubagent-<id>.jsonl` sit next to `main.jsonl`; `child_session_ref.attrs.childLogFile`; `llm_request` attrs `copilotUsageNanoAiu`, `model`, `inputTokens`, `outputTokens`, `debugName`. §4 needs no change.
- **Where:** `Code` has no debug logs; all are in `Code - Insiders` (28 `workspaceStorage` roots, 1 `globalStorage` root).
- **Sessions:** 259 with `main.jsonl`; 13 have subagent files (max 3 per session); 17 files: 12 `runSubagent`, 5 `searchSubagent`; 191 requests, all with numeric AI Credits.
- **Baseline:** 177.64 AI Credits missing, all from `runSubagent`; `searchSubagent` runs are 0.00 (`copilot-search-a`). Main totals count 6856.53. Per-session figures equal design §1.1.
- **Edge cases seen:** dangling refs 0, orphan files 0, nested refs 0, subagent-named requests inside `main.jsonl` 0.
- **Models:** `claude-haiku-4.5` 155 requests, `gpt-5.6-luna` 21, `copilot-search-a` 15.
- **Versions:** every classic session with a subagent tool call has a ref and a file (Aug–Sep 2026, Copilot Chat 0.60–0.69). Sessions 2026-03 to 2026-07 (0.43–0.60) have none. Newest subagent file 2026-09-29; retention removed none since 2026-11-05.
- **D15:** not triggered; logs with the gap remain.

| Session | Date | Counted | Missing | Runs |
|---|---|---|---|---|
| a3aca176 | 2026-09-21 | 46.53 | 54.65 | 3 run |
| ec9857ae | 2026-09-12 | 99.42 | 42.06 | 2 run |
| 94dfedf7 | 2026-09-23 | 83.08 | 29.78 | 2 run |
| 739434f5 | 2026-09-21 | 172.54 | 23.83 | 1 run |
| f98af48a | 2026-09-29 | 231.22 | 13.59 | 1 run |
| 69477d27 | 2026-09-21 | 38.58 | 8.33 | 1 run |
| 466d29f8 | 2026-09-12 | 26.69 | 4.03 | 1 run |
| 8a80d1cf | 2026-09-12 | 9.05 | 1.38 | 1 run |
| 19e7f1ab, 4e20fad3, 65c7bd11, 2dc18e24, c921b7b9 | 2026-08-08/09 | 44.99–460.69 | 0.00 | 1 search each |
