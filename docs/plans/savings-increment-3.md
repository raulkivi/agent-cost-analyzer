# Savings report Increment 3: pi, per-tool tokens, per-session figures, titles

**Last changed:** 2026-11-16 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

**Status: Plan approved 2026-11-14 (task V23 in
[implementation-plan.md](../implementation-plan.md#100-release), criterion
C11).** Decisions D22–D32 accepted. No UI code before the
owner approves the boards (V23b). **Scope change 2026-11-14 (owner):** the
owner runs pi only on a local model (unpriced), so V28 (the pi request trace
and O2–O4 for pi, §7.2) moves after 1.0; V27 (pi O1 per tool, wasted tokens
shown, amounts "Not priced" with the reason) stays in 1.0. **V24–V27 done
2026-11-15/16; V29 (review, docs, exit check) done 2026-11-16 (§17): 6
findings fixed, 6 recorded; the exit check (§14) passed on the owner's logs,
and the owner's sign-off of its output is pending.** Scope decided by the owner 2026-11-14 in
[savings-report.md](savings-report.md) §2, goal G6. Increments 1 and 2, their
design, honesty rules and owner decisions D1–D21 are in that plan and are not
repeated here; decisions in this plan continue its numbering from D22.

## Contents

1. Why
2. Goals and non-goals
3. What exists
4. Design: (c) each session's date and saving
5. Design: (d) session titles in the app's report
6. Design: (b) per-tool tokens for unused tools
7. Design: (a) pi coverage
8. SR22 review findings R12–R16
9. What reaches the model
10. UI changes and mock-ups
11. Threat-model rows
12. Owner decisions
13. Risks
14. Exit criterion
15. Tasks
16. Docs to update
17. V29 review

## 1. Why

- pi is the one provider the report covers least: O1 is unverified for it
  and O2–O4 are missing, because pi has no request trace (Phase 14 D1
  waited for Phase 11's real captures). A pi user sees "Not analysed" where
  a Claude Code user sees their cache breaks.
- An unused-tools row for an MCP server says "N tools, about T tokens on
  each request" but not which tools cost the most. SR16 deferred the
  per-tool list (§16 follow-up).
- A row's session list shows bare ids. The U18 boards showed each session's
  date and saving; the detectors already compute each session's priced high
  end to order them (D16), then drop it.
- An id tells the user nothing about which session it was. The app already
  holds the titles; SR16 deferred showing them, provided they never reach a
  model (§16 follow-up, D19).

## 2. Goals and non-goals

**Goals** (G6 (a)–(d), owner 2026-11-14)

- I1 (G6 (c)). Each session in a row's session list carries its start date
  and its own saving over the window, with the row's basis and label, in the
  report, the Savings tab (both products), `get_savings_report` and U18.
- I2 (G6 (d)). The Savings tab in both products shows each session's title,
  looked up in the browser from data the app already loads. Titles are
  never in the report, the RPC or HTTP result, the MCP tool output or
  anything sent to a model.
- I3 (G6 (b)). An unused-tools row lists its tools with each tool's
  estimated definition tokens: at most 20, largest first, names through
  `savingsName`, tokens labelled "estimate".
- I4 (G6 (a)). pi sessions get O1 per tool, checked against Phase 11's real
  captures, and O2–O4 from a pi request trace built and verified against
  those captures.
- I5. `npm run test:real-data:savings` covers pi and every new field; the
  owner signs off its output (§14).

**Non-goals**

- O6 (cheaper model) and Phase 14 replay for pi. The pi trace is read by
  the savings report only (D28); replaying it needs a pi harness in the
  simulator and its own self-check, a post-1.0 follow-up.
- O1 for Agent Host (no per-tool inventory, SR0 (c)) and O3 causes for
  Agent Host (`promptCacheBreakState` stays undecoded).
- mitmproxy coverage.
- A grand total (D4 stands), the AI-advice bundle (D11 stands), widening
  `openSetting` (D6 stands).
- Titles in U18 or in any MCP output (D19 stands).
- Fixing the Dashboard's own cost totals for forked pi sessions (§7.4); it
  is raised with V14, not changed here.

## 3. What exists

Read in the code on 2026-11-14.

| Capability | Where | Used for |
|---|---|---|
| Per-session priced high end, computed to order a row's sessions (D16), then discarded | `contribution` maps in `unused-tools-detector.ts`, `cache-break-detector.ts`, `failed-calls-detector.ts`; `sessionsByContribution` in `savings-session-order.ts` | (c): keep the figure (and the low end) on the session ref |
| `savingsSessionRefSchema = { providerId, sessionId }`; the tool output cuts it to 10 per row with `sessionsTotal` | `domain/src/savings.ts`; `server/src/mcp/savings-tool-output.ts` | (c): additive fields |
| `Session.startedAt` (optional; pi from the header line) | `domain` `Session` | (c): the date; absent reads "date unknown", never blank |
| Insights dataset rows: `key` (`providerId:sessionId`), `title`, `startedAt`, `date`, for every provider in the window, loaded by the Dashboard | `insightSessionRowSchema` in `domain/src/insights.ts`; `fetchInsights`; `InsightsDashboard.tsx` | (d): client-side title lookup (D24) |
| `GET /api/sessions` lists the **active** provider's sessions only | `server/src/app.ts` | (d): the alternative D24 rejects |
| Per-tool `definitionTokens` (estimate) on `ToolInventoryEntry`; the detector sums a group's tools per session and averages over sessions | SR2; `UnusedToolsDetector.groupTokens` | (b): keep each tool's figure instead of only the sum |
| pi tool inventory from the session file's `role: "system"` messages, per-tool tokens through `toolDefinitionTokenLookup`; a tool removed before the branch's end has unknown tokens; no inventory when the file has no system messages (sidecar only: names, no definitions) | `pi-agent-log-provider.ts` (`PI_TOOL_DEFINITION_REASONS`), `system-message-replay.ts`, `system-prompt-components.ts` | (a) O1: built in SR2, never checked against a real pi file |
| pi usage per assistant message: `input`, `output`, `cacheRead`, `cacheWrite`, `cacheWrite1h`, `reasoning`, `cost.total`; two times per message (entry `timestamp` ISO, message `timestamp` ms); `model_change`, `compaction` (with its own usage), `branch_summary` and `usage` entries; `roundsCount` = assistant messages | `usage-extractor.ts`, `turn-grouper.ts`, `fixtures/pi-agent/schema-v3-session.jsonl` | (a) the trace's numbers and events |
| `CacheBreakTraceReader` (savings-only port: trace plus `promptChanges` from hashes and flags); `RequestTraceReader` (replay port). The loader tries the first, then the second | `log-provider.ts`; `savings-session-loader.ts` | (a): pi implements the savings port only (D28) |
| `harnessSchema`: `vscode-local`, `copilot-agent-host`, `claude-code` | `domain/src/vendor-profile.ts` | (a): a trace needs a harness value (D28) |
| One session per pi leaf branch; each holds the whole root-to-leaf path, so a shared prefix appears in every sibling | `session-tree.ts`, `pi-agent-log-provider.ts` | (a): double counting (§7.4, D27) |
| Real-data check and its independent oracle (Claude Code only) | `packages/server/scripts/savings-exit.real.test.mts`, `savings-oracle.mts` (imports only `gpt-tokenizer`) | §14: extended per task |
| Phase 11 status: V13 is replaced by automated generation (owner 2026-11-14); V14 (generated fixtures, field diff, fixes, `context_edit`) is done and in review | [implementation-plan.md](../implementation-plan.md) Phase 11, [providers/pi-provider.md](../providers/pi-provider.md) | (a) depends on V14 |

## 4. Design: (c) each session's date and saving

**Data.** `savingsSessionRefSchema` gains two optional, additive fields:

- `startedAt`: the session's `startedAt` (ISO timestamp). Absent when the
  log has none; the views read "date unknown", never an empty cell. The
  view formats it as a date in the viewer's time zone (D23).
- `perWindow`: a `savingsAmountSchema`, the session's own saving over the
  window, with the row's basis, label and price versions. Not per week: a
  weekly rate of one session means nothing (D22). Unknown with the reason
  when that session couldn't be priced, never 0.

**Detectors.** Each detector already prices each session before summing
(the `contribution` maps keep only `high`). They keep the low end too and
put the per-session amount on the ref:

- O1: the session's `PricedPart` (range).
- O2–O4: the session's breaks summed (upper bound; a range where cache
  writes are unknown, as the row).
- O5: the session's affected turns (upper bound).
- O6: one session per row; its amount equals the row's (Simulated).

A refinement in the domain checks every known per-session amount has the
row's basis, label and currency. A detector test checks the known
per-session amounts add up to the row's `perWindow` (floating-point order
only). `sessionsByContribution` then reads `perWindow.high` from the ref
instead of a side map (one source).

**SOLID / CUPID.** The ref stays a plain value (composable); the ordering
function reads the field it orders by (predictable); no new port. The
amount type is the existing `savingsAmountSchema`, not a new one
(idiomatic).

**Surfaces.** `GET /api/savings` and RPC `getSavingsReport` carry the
fields through the domain schema. `get_savings_report` carries them on the
10 shown sessions; the text answer prints each shown session as
`<id> (<YYYY-MM-DD>, up to $1.20)`. Both tool-list snapshots change on
purpose (output schema).

## 5. Design: (d) session titles in the app's report

**Source (D24).** The Savings tab looks titles up in the insights dataset
rows (`key` = `providerId:sessionId`), which the Dashboard already loads for
every provider in the window, through a small pure function
`sessionTitleLookup(rows) → (ref) → string | undefined` in
`web/src/lib/savings/`. When the tab is shown without a dataset (or the row
is past the dataset's session cap) the lookup returns nothing and the list
shows the id alone. The report, HTTP and RPC results, and the MCP tool are
unchanged: no title field anywhere server-side.

**Rendering.** Title as text, folded to one line and capped at 120 code
points (§6.1's free-text title rule, threat-model §6.1), with the id in
monospace beside it so the row still names the exact session. The "Open in
Analyze" button's accessible name keeps the id and adds the title. Copy
never includes a title (Copy is the action template only).

**Extension (D25).** The same `SavingsDetail` component, so Copilot titles
appear there too, from the extension's own dataset. U18 stays ids only
(D19).

**SOLID / CUPID.** Dependency inversion: `SavingsDetail` takes a
`titleOf?: (ref) => string | undefined` prop; `SavingsTab` (or
`App.tsx`) builds it from the dataset. The component never fetches; tests
pass a fake lookup. One responsibility per piece: the report says what to
change, the dataset says what a session is called.

**Tests.** A component test with a hostile title (bidi, line break, 500
characters, markup) renders text only, capped; a test that the HTTP and RPC
results hold no title (the fixture's titles searched in the JSON); the
existing `mcp/security.test.ts` title check stays.

## 6. Design: (b) per-tool tokens for unused tools

**Data.** Unused-tools opportunities gain, additively:

- `tools`: at most 20 entries `{ name, tokens, sessions }`, largest tokens
  first, name ascending on ties. `name` through `savingsName`; `tokens` an
  `estimatedTokenCount` (the tool's definition tokens per request, averaged
  over the row's sessions where it was loaded, rounded); `sessions` the
  count of those sessions.
- `toolsTotal`: how many tools the group has (`actionParams.tools`), so
  "and N more" is a count, not a guess.

Name form (D26): for an exact `mcp__<server>__<tool>` group, the tool part
only (the server is the row's subject); for an inferred `mcp_` group, the
whole name (the boundary is a guess); for a non-MCP tool, the name.

**Schema refinements.** Only `unused-tools` carries `tools`; at most 20;
`toolsTotal ≥ tools.length`; every known `tokens` has `estimated: true`
(D12, as R3 did for the row).

**Detector.** `groupTokens` returns the per-tool figures as well as the sum
(one pass, no second read). The row's `evidence.tokens` stays the averaged
group sum; per-tool averages can differ from it by rounding (at most one
token per tool), which the view does not hide: the list says "about".

**Surfaces.** In the report, the RPC and HTTP results and
`get_savings_report` (names are already allowed to the model by §8). The
text answer lists the first 5 tools with tokens and "and N more", to keep
the answer short; the structured result carries up to 20.

**Action text and R14.** The unused-tools template's "(1 tools" is fixed
here (R14, D31): every template pluralises its counts.

## 7. Design: (a) pi coverage

Both parts build on V14's real, redacted pi captures and the field diff.
If V14 changes a field name or a rule below, V14's answer wins and this
section is updated in the same PR.

### 7.1 O1 per tool for pi (V27)

SR2 already gives pi per-tool `definitionTokens` from the session file's
system messages. V27 verifies and completes it:

1. Test first against V14's real fixtures: the inventory's names, `loaded`,
   `invokedInTurns` and per-tool tokens; an unused-tools golden over a
   two-session pi window.
2. A read-only count (as SR0) over V14's captures and the owner's pi logs,
   counts only: how often a branch's tool list changes between requests.
   If it does, add an optional `loadedRequests` (per tool, the requests
   while it was declared) to `ToolInventoryEntry`, and the detector
   multiplies by it instead of the session's request count (VS Code's
   per-request list, SR2, is the precedent). Keep the definition a removed
   tool had when it was declared, so it is no longer unknown.
3. Sidecar-only sessions (no system messages in the file): D29.

**Done in V27 (2026-11-16).**

- *Tool-list-change count (step 2), counts only.* V14's ten generated
  files: 10 branches, 52 requests, all with system messages, none changing
  its tool list (one list per branch). The owner's `~/.pi/agent/sessions`
  (261 files, 261 branches, 8,966 requests): 125 branches have system
  messages and 136 only the sidecar (D29); 2 of the 125 change their list
  between requests (both by adding a tool, none by removal or compaction;
  up to 3 distinct lists in one branch); no file is forked (no D27 case).
  In the 30-day window of the check: 58 branches, all with system
  messages, none changing. Lists do change, so `ToolInventoryEntry` gains
  the optional `loadedRequests` and the detector uses it.
- *Inventory.* `replaySystemMessages` keeps, per declared tool, its last
  definition (a removed tool is no longer unknown) and the assistant
  requests it was declared for; the pi provider fills `definitionTokens` and
  `loadedRequests` from it. Claude Code and Copilot entries have no
  `loadedRequests` (every request).
- *Detector.* A group's tokens per request stay the sum of its tools'
  definitions (what the row and its per-tool list show); the money weights
  each tool by `loadedRequests` ÷ the session's own requests (capped at 1),
  per model, so a tool dropped or added mid-session is not charged for
  requests that never carried it.
- *Not priced.* A session whose channel is unknown (pi on a local model:
  "the vendor is unknown") is no longer "Not analysed": its tokens and <!-- codespell:ignore analysed -->
  requests are counted and its amount is unknown with the channel's reason,
  in a row of its own (`unused-tools:<group>:unpriced`) ranked last. This
  holds for every provider, not only pi. A session whose tool sizes are
  unknown stays under Not analysed. <!-- codespell:ignore analysed -->
- *Forked files (D27).* `Session.sharedPrefixRequests` (requests, not turns,
  so a fork inside a turn is exact) counts the leading assistant requests a
  branch shares with an earlier branch of its file; the pi provider fills it
  and the detector leaves them out of the row's requests and money. A
  branch with no request of its own gives no row. The O2–O4 side (breaks,
  the unchecked first request) is V28's.
- *Check.* The real-data check's pi half (§14) runs over a symlinked view
  of `~/.pi/agent/sessions`, as for Claude Code.

### 7.2 A pi request trace (V28) — after 1.0 (owner 2026-11-14)

A pure builder `buildPiRequestTrace(branchEntries, turns)` in
`data-sources/pi-agent/pi-request-trace.ts`, tested over the hand-made
fixtures and V14's real ones:

- **Requests.** One per assistant message with usage on the branch, in
  order, in the session's own turns (the turn grouper's turns, as
  Phase 14's traces reuse their provider's turn building).
  `uncachedInput` = `input`, `cacheRead`, `cacheWrite` (pi records writes:
  never null), `extendedCacheWrite` = `cacheWrite1h` where present,
  `output`, `reasoning`. A message with unknown counts puts its turn under
  `notTraced` with the reason, never zeroed.
- **Time.** `startedAt` from the message's own `timestamp` if V14 shows it
  marks the request's start, else the entry's `timestamp`. If only an end
  time exists, the classifier gets an `end-to-end-gap` caveat (a new fixed
  sentence beside `start-to-start-gap`), so the gap is not presented as
  idle time it may not be.
- **Events.** A `model_change` entry before a request sets
  `event: "model-switch"`; a `compaction` entry sets `"compaction"` (an
  intended reset, left out as for the others).
- **Helper requests.** The usage on `compaction`, `branch_summary`, `usage`
  (cache warm) and tool-result entries is not part of the main chain's
  cache: counted in `helperRequests` (AI Credits unknown with the existing
  reason), never folded into a main request.
- **Prompt changes.** From the system messages the provider already
  replays: a changed tool list → `tools`; a changed system prompt section →
  `systemPrompt`; a changed context-file section (`AGENTS.md` and the like,
  as pi names them) → `instructions`. Compared by content hash in memory;
  no text is kept or returned. pi therefore gets O3 causes, like VS Code
  local and Claude Code.
- **Harness.** `harnessSchema` gains `pi` (D28). The cache rules come from
  the vendor profile of each request's model (`cacheRulesOf`); a model with
  no profile is unknown with the existing reason.
- **Port.** `PiAgentLogProvider` implements `CacheBreakTraceReader` only
  (ISP, D28). It does not implement `RequestTraceReader`, so replay and O6
  still refuse pi with their existing reason.

### 7.3 O2–O4 for pi

No new detector: `CacheBreakDetector` and the classifier run on the pi
trace (open/closed). Golden tests over V14's real captures and a hand-made
pi fixture with an idle gap, a model switch and a tool-list change.

### 7.4 Forked pi sessions (D27)

Each leaf branch is its own session holding the whole root-to-leaf path,
so a prefix shared by two branches appears in both. Counted per session,
its breaks, unused-tool requests and failed calls would count twice. And
the first request after a branch point follows the sibling branch's
requests in time, which are not on this path, so its gap and cache read
measure the wrong predecessor.

Recommendation: the pi provider reports, per branch, how many leading
requests and turns it shares with an earlier branch of the same file (leaf
order), as two numbers on `CacheBreakTrace` (`sharedPrefixRequests`) and
on the session (`sharedPrefixTurns`, optional). The detectors skip those
(O1 requests, O2–O4 breaks, O5 calls) and list them once under coverage
with the fixed reason "Counted under another branch of the same pi session
file." The first request after a branch point goes to the classifier's
`unchecked` list with the fixed reason "pi resumed this branch from an
earlier point; the cache state depends on the other branch." Numbers only;
no entry id leaves the provider.

The Dashboard's cost totals appear to count a shared prefix once per
branch as well. That is outside this plan; V28 records what V14's fork
capture shows and raises it for Phase 11.

## 8. SR22 review findings R12–R16

| # | Finding ([savings-report.md](savings-report.md) §17) | Recommendation (D31) |
|---|---|---|
| R12 | Simulated rows carry `rank` in the tool output and are numbered in its text | Fold into V24: drop `rank` from Simulated rows and number them as bullets; V24 changes the output schema and both tool-list snapshots anyway |
| R13 | The tool ranks across currencies; U18 numbers each currency from 1 | No change: by design (one list per currency, never converted). V24's text answer says "ranked by the high end; 1 AI Credit = $0.01" once, which it already implies |
| R14 | Action templates don't pluralise ("1 tools", "1 sessions") | Fold into V26: it changes the unused-tools goldens anyway; fix every template, update the goldens and the specs that quote action text in one PR |
| R15 | U18's "N had no request trace" form never fires on real reasons | Fold into V24: remove the dead special case, so fixtures and real rows read the same "N not analysed: <reason>"; V24 already edits `view-models/savings.ts` |
| R16 | Session ids reach the model uncapped | No change: they must round-trip to `get_session_cost`. V28's test checks a pi branch id (`<hash>__branch__<uuid>`) round-trips from `get_savings_report` to `get_session_cost` (V29 wrote that test, since V27's pi rows are in 1.0 and V28 is not: §17 R22) |

## 9. What reaches the model

`get_savings_report` gains, per shown session, a start timestamp and a
priced amount; per unused-tools row, up to 20 tool names (through
`savingsName`) with estimated token counts and `toolsTotal`. All are
numbers, ids, model ids or capped, redacted names, as §8 of the main plan
already allows. No title, prompt, response, path or file content. pi's
trace adds nothing to the output beyond the rows it produces. U18 renders
from `structuredContent` only and makes no new host call, message or
`updateModelContext`.

## 10. UI changes and mock-ups

**Mock-ups (V23b).** Amend the existing boards rather than drawing new
ones, in the same `.dc.html` format, approved by the owner before any UI
code (as SR11, SR18):

| Board | Change |
|---|---|
| `savings-report/Detail.dc.html`, `DetailMore.dc.html` | Session list: title (or id alone), id, date, the session's saving with its label, Open in Analyze; the per-tool list for an MCP server row with "estimate" and "and N more" |
| `savings-report/Narrow.dc.html`, `VsCodeNarrow.dc.html` | The same list at 320 px: title, then id, date and saving wrapping under it |
| `savings-report/VsCodeDark.dc.html`, `VsCodeLight.dc.html`, `VsCodeHC.dc.html` | Copilot titles in the session list; High Contrast without colour cues |
| `savings-report/States.dc.html` | A pi provider with a request trace (rows instead of Not analysed); a session with "date unknown" and one "Not priced" |
| `mcp-apps/Savings.dc.html` (U18) | The opened row's three sessions with date and saving (no title, D19); the per-tool list |

**Web and extension Savings tab.** `SavingsDetail`'s session list gains the
title, date and saving per session; the Evidence block gains the per-tool
list for unused-tools rows. All labels ("estimate", "up to", range, "Not
priced", "date unknown") come from `savings-view.ts`, never CSS, and
component tests assert them (§7 of the main plan).

**U18.** The opened row's sessions show date and saving; the per-tool list
in the row's evidence. No title, no Copy, no new control.

**Specs** (no manual checklist rows, [release-ui-gate.md](release-ui-gate.md)):

- Playwright `web-e2e` `sv1-savings-report.spec.ts`: each shown session's
  date and saving equal the API's; titles equal the dataset's; the API
  response holds no title; the per-tool list; axe.
- wdio `extension-ui` `sv1-savings.e2e.ts`: the session list and per-tool
  list in three themes and at compact width.
- Playwright `packages/mcp-apps/e2e/specs/u18-savings.spec.ts`: session
  date and saving, per-tool list, light and dark, no title.
- G4 real-Copilot rows in `copilot-savings-view.e2e.ts` updated for the
  seeded row (one tool, `create_file`; its sessions' dates and savings);
  written and typechecked, run by the owner before tagging (release-ui-gate
  D1, D12).

## 11. Threat-model rows

Rows to add to or amend in [threat-model.md](../threat-model.md) §4 and
§6.1 in V29. **Done 2026-11-16:** the first three and the last are in
threat-model.md §4 as verified, citing their tests; the pi request trace row
waits for V28 (after 1.0).

| Surface | Threat | Planned mitigation |
|---|---|---|
| Session titles in the Savings tab (both products) | Prompt-derived text reaching a hosted model; markup or bidi text in a title | Looked up in the browser only, from the dataset the Dashboard already shows; never in the report, HTTP, RPC or MCP result (tests search the JSON for the fixture titles); rendered as text, folded, capped at 120; not in Copy |
| Per-session dates and amounts in `get_savings_report` | Activity timing to a hosted model | Dates are metadata `list_sessions` already returns; amounts are numbers with basis and label; at most 10 sessions per row as before |
| Per-tool names and tokens in `get_savings_report` | A crafted or secret-bearing tool name | `savingsName` (fold, `redactSecrets`, 80 code points); at most 20 per row; hostile-name tests in the detector and the tool |
| pi request trace and prompt-change markers | Prompt or system-prompt text leaking through the trace | Numbers and booleans only (strict schemas); system messages compared by content hash in memory; no text, path or entry id leaves the provider |
| pi branch ids in tool output (R16) | An uncapped id from a file name | Unchanged residual (must round-trip); V28 tests the round trip |

## 12. Owner decisions

Decided 2026-11-14: the owner accepted each recommendation (D22–D32).

| # | Decision | Recommendation |
|---|---|---|
| D22 | Which per-session saving | The session's own amount over the window, with the row's basis, label and price versions; unknown with the reason, never 0. Not per week |
| D23 | Which session date | Its start (`startedAt`), as the Sessions list and the dataset use, shown as a date in the viewer's time zone; "date unknown" when absent |
| D24 | Where titles come from | The insights dataset the Dashboard loads (every provider, the same window); the id alone when a session isn't in it. Not a new server route, and not `GET /api/sessions` (active provider only) |
| D25 | Titles in the extension's Savings view | Yes, the same component and lookup (Copilot titles); U18 stays ids only (D19) |
| D26 | How per-tool names read | Tool part only under an exact `mcp__` server; the whole name under an inferred `mcp_` group; up to 20 in the structured result, the first 5 in the text answer |
| D27 | Forked pi sessions | Count a shared prefix once per file, under the first branch in leaf order; the first request after a branch point is unchecked with a fixed reason (§7.4) |
| D28 | Scope of the pi trace | Savings only: pi implements `CacheBreakTraceReader`, not `RequestTraceReader`; `harnessSchema` gains `pi`; replay and O6 for pi stay off until a post-1.0 plan |
| D29 | pi sessions with only the sidecar (no system messages in the file) | Leave them under Not analysed with the reason (the sidecar has tool names, no definitions). If V14 shows the owner's pi writes no system messages, revisit: extend the logger to capture definitions |
| D30 | pi data for the real-data check | Add to V13's capture steps: one pause longer than 5 minutes in the linear session (an idle expiry on Anthropic's default lifetime) and one tool left unused; the check fails, with that instruction, when the window holds no pi session. The generated `pi-linear` fixture has both (310 s pause, `write` unused; 2026-11-14) |
| D31 | SR22 findings | Fold R12 and R15 into V24, R14 into V26; R13 and R16 stay recorded (§8) |
| D32 | Mock-ups | Amend the existing boards (§10) and approve them once (V23b) before V24–V26's UI code; the server halves of V24 and V26 may start before |
| D33 | Unused tools of a session whose model has no known price (V27) | Owner 2026-11-16: every provider gets its own `unused-tools:<group>:unpriced` row, amount "Not priced" with the channel's reason, ranked last, instead of leaving the session under Not analysed | <!-- codespell:ignore analysed -->
| D34 | Row's `requests` when a tool was added mid-session (V27, `loadedRequests`) | Owner 2026-11-16: the row shows the session's request count; the money weights each tool by the requests it was declared, so requests × tokens may not multiply to the money for those rows (documented, rare: 2 of 125 owner branches, none in the window) |

## 13. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| V14 slips or changes pi's field names | V27 and V28 wait; the longest 1.0 chain (V13 → V14 → V28 → V29) | V24–V26 don't depend on it; §7 says V14's answers win and are folded into this plan |
| pi's logged time is the response's end, not the request's start | Idle gaps overstated or understated | V28 checks both timestamps against the captures; an `end-to-end-gap` caveat if only an end time exists |
| Forked pi sessions counted per branch | Inflated pi savings | D27; a fork fixture test; the real fork capture from V13 |
| pi models without a vendor profile (other vendors, local models) | O2–O4 unknown for them | Unknown with the existing reason, in coverage; never 0 |
| The owner's 30-day window holds little pi use | The pi half of the check has nothing to compare | D30: the V13 capture includes an idle pause and an unused tool |
| Title lookup misses (dataset capped below the report's 500) | Some sessions show the id only | The id is always shown; a test covers the miss |
| Per-tool averages don't add up to the row's average | A reader sums the list and gets a slightly different number | "about" in the view; the real-data check allows one token per tool. Only when every tool was in every session (§17 R23) |
| Larger report payload (an amount per session, up to 500 sessions) | Slower RPC to the webview | Measured in V29 instead of V24's service test (§17: a few hundred kB on the owner's window); amounts are small objects; the MCP output stays capped at 10 sessions |
| Output-schema change | A client caching the old schema | Fields are additive except R12's `rank` on Simulated rows, which `review_costs` and U18 don't read; snapshots updated on purpose |

## 14. Exit criterion

On the owner's machine, over 30 days of real Claude Code, Copilot and pi
sessions, `npm run test:real-data:savings` passes and the owner signs off
its output. Each task extends the check for its own field (it skips
without `REAL_DATA`, so CI is unaffected); V29 runs it on the owner's logs.
Added to the existing assertions (savings-report.md §14):

- **pi rows (V27).** At least one pi session is in the window (else the
  check fails with D30's capture instruction), and the standalone report
  (pi provider) lists under "no tool inventory" exactly the pi sessions
  without a system message (D29), no others.
- **pi oracle (V27).** `savings-oracle.mts` gains a pi reader that parses
  the raw pi JSONL itself (no import from the provider, the trace builder,
  the detectors or the pricer; a test checks it). For the top pi
  unused-tools row: the same sessions, requests and tokens per request
  (exact), per-tool tokens (exact), and "Not priced" for a model no price
  book lists, else the same cost range (money within 1e-9 relative).
- **After 1.0 (V28; owner decision 2026-11-14).** The pi bullets that need
  the pi request trace move to V28: no pi session under "no request trace",
  and the top pi idle-expiry (or, if none, unexplained) row with the same
  breaks, lost tokens, sessions and extra cost. They are not part of the 1.0
  check; V28 adds them to this list with its trace.
- **Per-session figures (c).** Every shown session's date equals its
  session's start; the known per-session amounts of each row add up to its
  `perWindow`; `get_savings_report` carries the same values for its 10.
- **Per-tool tokens (b).** For the oracle's unused-tools rows (Claude Code
  and pi), each listed tool's tokens equal the oracle's estimate; the list
  is at most 20, largest first; the tools' sum is within one token per
  tool of the row's figure.
- **Titles (d).** No session title of the window (from each provider's
  session list) appears in any `get_savings_report` answer or in the
  `getSavingsReport` result (compared, never printed).
- **Nothing written.** The fingerprint check covers `~/.pi/agent`
  (sessions by name, size and mtime; settings and the sidecar log by
  content hash).

UI: the Playwright and wdio specs in §10 pass in CI; the G4 rows are
written and typecheck.

## 15. Tasks

TDD in every code task: the failing test first, and the PR names the red
run (architecture.md §11.4; SR22 finding R11). No local model in this repo.
IDs match the 1.0 table in
[implementation-plan.md](../implementation-plan.md#100-release); V23b is
new and needs a row there.

| ID | Task | Exit criterion | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| V23b | **Done 2026-11-15: boards approved by the owner.** Mock-ups: amend the boards in §10 (session title, date and saving; per-tool list; pi in States; U18 sessions and per-tool list) | Boards approved by the owner | medium | Sonnet (frontend-design skill) + owner | V23 approved |
| V24 (done 2026-11-15) | (c) Each session's date and saving: `savingsSessionRefSchema` `startedAt` and `perWindow` with the label refinement; the four detectors fill them; `sessionsByContribution` reads the ref; tool output and text answer; R12 (no `rank` on Simulated rows) and R15 (dead `gapText` case); both tool-list snapshots updated on purpose; `SavingsDetail` and U18 session lists; component, axe, keyboard tests; Playwright `sv1` and `u18`, wdio `sv1`; the real-data check's per-session assertions | Goldens: known per-session amounts add up to each row's `perWindow`; specs pass in CI | medium | Sonnet | V23 approved; V23b for the UI half |
| V25 (done 2026-11-15) | (d) Session titles: `sessionTitleLookup` from the insights dataset, `titleOf` prop on `SavingsDetail` in both products; hostile-title, miss and no-title-in-result tests; Playwright `sv1` and wdio `sv1` assertions; the real-data check's no-title assertion | No title in any report, RPC or MCP result (tests); titles shown in both products; specs pass | medium | Sonnet | V23b; V24 (same list component) |
| V26 (done 2026-11-15) | (b) Per-tool tokens: `tools` and `toolsTotal` on unused-tools rows with refinements; `groupTokens` per tool; D26 name form; tool output (20) and text (5); Evidence block and U18 list; R14 pluralisation in every template; goldens and action-text specs updated; the real-data check's per-tool assertions | Golden per-tool lists over the multi-session fixture and a hostile-name test; specs pass | medium | Sonnet | V23 approved; V23b for the UI half |
| V27 (done 2026-11-16) | (a) O1 per tool for pi: tests over V14's real fixtures; the read-only tool-list-change count; `loadedRequests` and kept definitions if the count shows changes; D29 | pi unused-tools golden over the real fixtures; pi sessions with system messages no longer under "no tool inventory" | medium | Sonnet | V14, V23 approved |
| V28 | (a) pi request trace and O2–O4: `buildPiRequestTrace`; `harnessSchema` `pi`; `CacheBreakTraceReader` on the pi provider with prompt-change markers; D27's shared-prefix counts and the unchecked first request after a branch point; caveat if end times only; pi oracle in `savings-oracle.mts` and the real-data check's pi assertions; branch-id round-trip test (R16) | Trace golden equals the turns' usage over both real captures; cache-break goldens (idle, switch, tool change, fork); replay still refuses pi | high | Opus | V14, V23 approved; after V27 (same provider files) |
| V29 (done 2026-11-16, §17) | Review (as SR16, SR22) of V24–V27 (V28 is after 1.0) against §7 honesty rules, §9 and §11; docs (§16); `npm run test:real-data:savings` on the owner's logs | Findings fixed test-first and recorded in this plan (§17: 6 fixed, 6 recorded); the check passed on the owner's logs (§14); **the owner's sign-off of its output is pending** | medium | Opus | V24–V27 |

Suggested order: V23b and the server halves of V24 and V26 in parallel;
then V24's UI, V25, V26's UI; after V14: V27, then V28; then V29.

## 16. Docs to update

In V29 unless a task changes the doc's subject first:

- [savings-report.md](savings-report.md): §2 G6 status, §6 pi column (O1
  per tool, O2–O4 with trace), §14 the new assertions, a link to this plan.
- [architecture.md](../architecture.md): §4.1 rows (pi trace builder,
  savings fields), §5 types (`SavingsSessionRef`, `tools`, `harness: pi`),
  §6.2.5 (pi trace and the shared-prefix rule), §6.6 (the savings data
  flow), §11.2.
- [threat-model.md](../threat-model.md): §11's rows in §4 and §6.1.
- [providers/pi-provider.md](../providers/pi-provider.md): code map
  (`pi-request-trace.ts`), the trace, D27; the capture steps per D30
  (before V13, by whoever owns V13's instructions).
- [analyze-session-replay.md](analyze-session-replay.md): a note under D1
  that pi has a trace for the savings report only (D28).
- [UserGuide.md](../UserGuide.md) "The savings report" and
  [vscode-extension-guide.md](../vscode-extension-guide.md): titles, dates,
  per-session savings, per-tool list, pi coverage.
- Both CHANGELOGs' `[Unreleased]`.
- `docs/plans/mockups/savings-report/README.md` and
  `docs/plans/mockups/mcp-apps/README.md` (V23b).
- [implementation-plan.md](../implementation-plan.md) (Phase 16, the 1.0
  table with V23b) and
  [implementation-plan-gantt.md](../implementation-plan-gantt.md): by the
  main session, per task.

**Done in V29 (2026-11-16):** savings-report.md (status, §2 G6, §6, §14),
architecture.md (§4.1, §4.2, §5, §6.2.5, §6.6, §11.2), threat-model.md (§4,
§6.1), providers/pi-provider.md (V27's inventory and D27), the User Guide,
the extension guide and both CHANGELOGs. The pi trace's parts wait for V28.

## 17. V29 review

2026-11-16, by Claude Opus 5.5: Increment 3 as built, the way SR16 and
SR22 reviewed Increments 1 and 2. Read in the code, not the PR
descriptions: V24 (#328: `savingsSessionRefSchema`, `sessionRefOf`, the
four detectors' per-session amounts, `sessionsByContribution`, the tool's
`sessionOf` and `sessionText`, `SavingsDetail` and U18's session lists),
V25 (#335: `session-titles.ts`, `use-session-titles.ts`, `SavingsTab`,
`SavingsDetail`'s `SessionItem`), V26 (#336: `savingsToolSchema` and its
refinements, `unlistedTools`, `groupTokens` and `toolsOf`, the tool's
`toolOf` and `toolsLine`, `toolListOf`, both views' tool tables, R14 in
`savings-actions.ts`) and V27 (#349: `replaySystemMessages`' tool history,
`shared-prefix.ts`, the pi provider's inventory, `loadedRequests` and the
unpriced rows in `UnusedToolsDetector`, the pi oracle), against §7 of the
main plan, §9, §11, §14, D22–D34, the approved boards (the V23b answers in
`mockups/savings-report/README.md`) and the real-data check.

**Findings.**

| # | Severity | Where | Finding | Status |
|---|---|---|---|---|
| R17 | Low | `mcp-apps/src/view-models/savings.ts` `PROVIDER_LABELS` | U18 keyed pi's label as `pi`, but the pi provider's id is `pi-agent`. Since V27 put pi rows into the tool, U18 showed "pi-agent" in a currency list's heading and in its list of sessions not checked | Fixed (b25807b7): keyed by `pi-agent`. View-model test red first |
| R18 | Low (wording) | `server/src/mcp/savings-tool-output.ts` `rowText`, `savingsReportText` | R14 fixed the action templates; the tool's own text answer still wrote "1 of 1 sessions" in a row's coverage and "1 sessions." in its lists of sessions not checked and left out | Fixed (3b287df7). Test red first |
| R19 | Low | `server/src/mcp/savings-tools.ts` (description) | The output schema gained each session's start and saving (V24) and the per-tool list (V26), but the description still said "session ids". A model had no hint that a session's saving is over the window (not per week), or that per-tool tokens are estimates | Fixed (6b6323de): two sentences; registration test red first; both tool-list snapshots change on purpose (description only) |
| R20 | Medium (test gap) | `server/scripts/savings-exit.real.test.mts` | §14 (c) and (d) were not fully in the real-data check. A listed session's date only had to exist, not equal its session's start. Nothing checked that the known per-session savings add up to the row's. V25's task row named a no-title assertion, but none was written. pi's per-tool sum was not checked. V26's PR said its per-tool assertions were not run | Fixed (62b5ef84): dates and sums over every row of every report the check builds; titles from each product's insights dataset (D24's source) searched in every report and tool answer, never printed; pi's per-tool sum. Run on the owner's logs (§14) |
| R21 | Medium (test gap) | `server/src/mcp/security.test.ts` (V25's title test) | The test searches `get_savings_report` and the tab's report for every session title, but the cost fixture's savings report has no row (checked: 0 opportunities). No session reference could carry a title, so the test could not fail | Fixed (c4bf5132): `composition/savings-no-titles.test.ts` runs the standalone composition over SR13's Claude Code savings session (two rows that list it) and finds its title in neither answer. The `sv1` Playwright spec already checked `/api/savings` over rows |
| R22 | Low (test gap) | R16, §9 | R16's pi branch-id round trip was V28's test. V28 moved after 1.0, but V27 puts pi rows, and so branch ids, in the 1.0 tool | Fixed (58670243): `composition/pi-savings-branch-ids.test.ts` passes each row's `<hash>__branch__<leaf>` id to `get_session_cost` unchanged. It passed on its first run: a gap closed, not a defect |
| R23 | Low (design, owner) | `unused-tools-detector.ts` `toolsOf`; `domain/src/savings.ts` `unlistedTools`; `web/src/lib/savings/savings-view.ts` `toolListOf` | A tool's figure is its average over the sessions that loaded it; the row's is over all of its sessions. When a tool was loaded in only some of them, its figure is more than its share of the row's average. Then the list's note ("can differ from the per-request total by a few tokens") is off by more than rounding, and "and N more (about X)", X = the row's total minus the listed tools, understates the rest (`unlistedTools` drops X only when the listed sum passes the total). §6's "at most one token per tool" holds only when every tool was in every session. The owner approved X as drawn (V23b question 6) | Recorded for the owner. Recommendation: show X only when every listed tool was loaded in all of the row's sessions (`tool.sessions` = `evidence.sessions`), else the count alone, and word the note for that case. The User Guide now says when the few-tokens bound holds. On the owner's logs the check's per-tool assertions passed |
| R24 | Low (design, owner) | `cache-break-detector.ts` `opportunityOf`, `sessionAmount` | A session with one priced and one unpriced break keeps an "up to" of its priced breaks only, while the row's coverage leaves it out with the price reason. The row's own amount has done the same since SR6. O5 instead leaves such a session out of the amount ("an upper bound that leaves a turn out is no upper bound"). V24 makes the partial figure visible per session | Recorded for the owner. Recommendation: make O2–O4 match O5 (such a session's saving is unknown with the reason, and its breaks leave the row's amount), or keep it and label it "priced breaks only". On the owner's logs every idle-expiry break was priced |
| R25 | Low (performance) | `web/src/lib/savings/use-session-titles.ts` | The first detail opened per window loads the whole insights dataset again for the titles: every provider, up to 200 sessions each, each session parsed and the findings run. The server keeps no copy, so on a large window the titles arrive seconds later (the check's summary times the same load), while the list shows ids | Recorded. Options for the owner after 1.0: reuse the Dashboard's dataset when the windows match, or a titles-only listing (D24 chose the dataset over a new route) |
| R26 | Info | `savings-tool-output.ts` `sessionText` | The text answer prints a session's date as the UTC day of its start; the views show the viewer's day (D23). Near midnight one session can read a day apart in the chat text and in U18 | Recorded: by design (V23b question 7: ISO dates in the tool's text) |
| R27 | Info | `unused-tools-detector.ts` `requestsByModel`, `pi-agent/shared-prefix.ts` | D27 counts a shared prefix under the first branch in leaf order. If that branch is not in the report (past the 500-session cap; the window cannot split a file's branches, which share the header's start), the prefix is counted in neither branch | Recorded. No forked pi file on the owner's logs |
| R28 | Low (wording) | `web/src/lib/savings/savings-view.ts` `coverageText`; `mcp-apps/src/view-models/savings.ts` `gapText` | The views' coverage line still reads "1 of 1 sessions" (R18 fixed the tool's text only) | Recorded for the next UI task: wdio and Playwright specs quote these lines |

**Checked, no finding.**

- §7 honesty. A known per-session saving has the row's basis, label and
  currency, and an unknown row has no known part (domain refinement, V24).
  An unpriced session reads "Not priced", with each reason once under the
  list, never 0; a session with no start reads "date unknown". D33's
  `unused-tools:<group>:unpriced` rows carry the channel's reason on the row
  and on every session, rank last, and still count tokens and requests.
  Per-tool tokens must be `estimated` (refinement) and read "about" with the
  "estimate" tag. No total anywhere. D34: the row's requests are the
  session's; the money weights each tool by `loadedRequests` ÷ the session's
  own requests, capped at 1, after the shared prefix.
- §9. Titles are looked up in the browser only (`sessionTitleLookup`); no
  server type has a title field; the tool, both reports and U18 carry none
  (R20, R21, `mcp/security.test.ts`, the `sv1` specs). Tool names pass
  `savingsName` in the detector and again in the tool (`toolOf`); unknown
  reasons on rows, sessions and tools are folded, redacted and capped
  (`amountOf`, `toolOf`). Caps: 10 sessions and 20 tools in the output
  schema, 5 tools in the text. Ids round-trip (R22).
- Accessibility. A title renders as text, folded to one line, at most 120
  code points, cut with an ellipsis and in full in its tooltip. "Open in
  Analyze" keeps its visible label first in its name, then the id, then the
  title. The per-tool tables have column headers with the "estimate" tag.
  axe is clean in `sv1-savings-report.spec.ts` (titles, tools, 320 px) and
  `u18-savings.spec.ts` (sessions, tools, light and dark). No new control,
  so the keyboard paths are SR14's and SR20's. The tooltip is not
  keyboard-reachable, but the full title is in the button's name.
- Performance. `groupTokens` is one pass per session and `toolsOf` keeps the
  top 20. A date and an amount on each session reference grew the report
  (§13's risk, measured here rather than in V24's service test): on the
  owner's 30-day window, about 350 kB of JSON for about 1,000 references;
  the capped tool answer stays under 100 kB.
- Consistency. Both tabs and U18 use the same `savings-view.ts` helpers
  (`sessionDateText`, `sessionSavingText`, `notPricedReasons`,
  `toolListOf`). Sessions: 5 in the tabs, 3 in U18 (D16), 10 in the tool.
  Tools: 5 in every view, 20 in the structured result. The extension uses
  the same `SavingsDetail` and `useSessionTitles` over its own Copilot
  dataset (D25); the check finds both products' Copilot reports equal.
- R12 (no `rank` on Simulated rows) and R15 (no dead `gapText` case) are
  in; R13 needs no change (the text says "Ranked by the high end").
- V27. `loadedRequests` counts the branch's own requests (after the shared
  prefix); a removed tool keeps its last definition; sidecar-only sessions
  stay under "no tool inventory" (D29), as the check confirms on real data.
- Process. Each PR names its red runs. V25's wdio title spec was written
  and not run in its PR; V26's real-data assertions first ran here.
