# Monthly AI Credits allowance gauge (extension first)

**Last changed:** 2026-11-12 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **planned; owner decisions accepted 2026-11-12 (every recommendation); implementation started 2026-11-12**. Step **10.21** in [implementation-plan.md](../implementation-plan.md); [classic-subagent-credits-implementation.md](classic-subagent-credits-implementation.md) holds 10.19 and its audit follow-up 10.20.

## 1. Why

The status bar shows today's AI Credits only. A GitHub Copilot plan bills against a monthly allowance, and the question people ask is "how much of my month is left?". Today the user must add up days in their head.

The user types the allowance (a setting). The extension then shows month-to-date AI Credits against it, the days left in the period and a warning as use nears it.

## 2. Goals and non-goals

Goals:
- A user-scoped setting for the plan's monthly AI Credits allowance.
- A status-bar item: month-to-date used of allowance, percentage, state in words.
- A Sessions view header row with the same figures, days left and the remaining AI Credits.
- Honest coverage: unknown sessions are named, never counted as 0.
- No new log reads and no polling.

Non-goals (checked against [vision.md](../vision.md) §6 and architecture constraints):
- **No live fetching** of plan, quota or price data (constraint 1, vision §6). The user types the number.
- **No plan amounts in the code or docs** (no "Pro = N"). The number is the user's.
- **No month-end projection or run rate** (see D3).
- No write to VS Code settings (threat-model §6 "Settings changes": the extension never writes settings).
- No reconciliation with GitHub's billing page. The gauge is a local lower bound (§4.4).
- Standalone app: later increment, not in this plan's exit criterion (D8).

## 3. Design grounded in the code

All names below were read in the repo. Paths are under `packages/vscode-extension/src/` unless stated.

### 3.1 Where today's total comes from

- `status-bar/status-bar-model.ts`: `buildTodayStatus` filters `Session[]` by `sessionStartedOn` (the session's `startedAt` day key in the user's zone via `dayKeyOf` from `time/local-time.ts`), then `knownSum` adds `session.costAiCredits.value` where `known` is true. An unknown session is counted in the coverage text ("3 of 5 sessions today have cost data"), never as 0.
- `buildStatusBarState` wraps it. A required config warning takes the item over ("AI Credits: setup needed").
- `vscode/vscode-status-bar.ts`: `registerStatusBar` creates one left item (priority 100), re-renders on `controller.onDidChange`. It sets `accessibilityInformation` (label, role `button`) and uses `statusBarItem.warningBackground` only as an addition to icon and words.
- `sidebar/sidebar-controller.ts`: `SidebarController` reads sessions once per refresh (`readSessions` via `SidebarSources.listSessions`, which is `api.listSessions()` in `composition.ts`). `statusBar()` rebuilds the state from the cached `this.sessions` on every call. There is no polling and no watching; a refresh is the Refresh command, the Sessions view becoming visible, or a Copilot logging setting change.
- The list summaries come from `VscodeLogProvider.listSessions` (`packages/server/src/data-sources/log-providers/vscode/vscode-log-provider.ts`), which merges classic sessions and Agent Host sessions (`agentHostSessions.listSessions()`), sorted by start.

### 3.2 Reuse

The month figure is the same computation over a wider window, so it needs no new data path:
- Extract `knownSum` and `sessionStartedOn` into `status-bar/session-credits.ts` (shared by today's and the month's model). Existing status-bar tests stay green.
- New pure `time/billing-period.ts`: `periodOf(now, timeZone, resetDay)` returns `{ startKey, endKeyExclusive, daysLeft, dayOfPeriod }` using `dayKeyOf` and calendar arithmetic like `previousDayKey`.
- New pure `status-bar/monthly-allowance.ts`: `buildMonthlyAllowance({ sessions, now, timeZone, allowance, resetDay, warnAtPercent, t })` returns a view model: `used`, `knownSessions`, `totalSessions`, `fraction`, `remaining`, `daysLeft`, `level` (`ok | near | over | unknown`), and the translated text, tooltip, `ariaLabel`.
- New `settings/allowance-settings.ts`: reads and validates the setting values (a number that is finite and above 0 is an allowance; anything else is "not set", with no error toast).

### 3.3 Sessions that count

- The summary's `costAiCredits` is all-or-nothing per session: `summarizeSessionUsage` in `packages/server/src/data-sources/sqlite/session-store.ts` uses `sumTokenCounts`, so one turn without usage makes the whole session unknown (constraint 6).
- Therefore a long session with one unknown turn drops out of the gauge entirely. `SessionCost.totals.aiCredits` (`packages/domain/src/cost.ts`, `knownTurns` of `turns`) has the per-turn detail, but only the cost tools read it, per session, so using it here means opening every session of the month. Not done in v1 (D7).
- Only the billed AI Credits (`costAiCredits` of VS Code sessions) count. The extension's registry is Copilot-only (threat-model §6, D5), so Claude Code, pi and mitmproxy figures are not in this list. Unverified for the extension list: that no `estimated: true` AI Credits value is summed. Task MA2 asserts it.
- Included: classic sessions, Agent Host and Copilot CLI sessions (both in `listSessions`) and empty-window sessions (step 10.18, done 2026-11-11). Task MA9 proves the last two with fixture sessions.

### 3.4 What the gauge shows when data is missing

| Case | Gauge text | Rule |
|---|---|---|
| Allowance not set | item hidden; Sessions row hidden | No nag. The command from MA7 and the docs explain how to set it. |
| Some sessions unknown | "At least 312.40 of 1,000 AI Credits (31 %)" and tooltip "4 of 9 sessions this month have cost data" | The sum covers known sessions only, so it is a lower bound and the words say so. |
| No session has cost data | "AI Credits this month: unknown" | Never 0. No percentage. |
| No sessions this month | "No sessions this month" | A true zero is only shown when sessions exist and every one is known. With none, say so. |
| Over the allowance | "Over: 1,042.10 of 1,000 AI Credits" | Level `over`. With unknown sessions: "At least 1,042.10 ...". |
| Required config warning | today's item takes over as now; the gauge item hides | Numbers are not usable. |

A lower bound can only under-warn. The tooltip says "may be higher" when any session is unknown.

### 3.5 Missing spend the gauge cannot see (state these in the User Guide)

- **Classic-harness subagent spend** ([classic-subagent-credits.md](classic-subagent-credits.md), status proposed). On the owner's machine (2026-11-05 scan) it was 2.5 % of classic spend and up to 117 % of a single session. The gauge reads list summaries, so it is low by that amount until that plan lands, then correct without a change here (that plan's table lists the status bar as "sums list summaries"). Agent Host sessions already include subagents.
- **Pruned logs.** Copilot keeps only the last N session logs (`maxRetainedSessionLogs`, the config check recommends 200, architecture constraint 10). A heavy month can lose its oldest sessions, so the sum is low. The tooltip shows the oldest session counted ("counted since 3 Nov").
- **Spend made elsewhere**: github.com chat, the cloud coding agent, other machines, the IDE of another user-data dir. Not in local logs. The wording is "recorded here", not "your usage".
- **Session attribution by start time.** A session that starts on the last day of a period and runs into the next counts wholly in the first. `Session` has `startedAt` and no per-turn time in the list summary. Turn-level attribution needs turn reads (D7).

### 3.6 Performance

- No new source call. `monthlyAllowance()` filters the cached `this.sessions` array, like `buildTodayStatus`. For a few hundred summaries that is microseconds plus one `Date.parse` and one `Intl.DateTimeFormat` per session.
- `dayKeyOf` builds an `Intl.DateTimeFormat` per call (`partsOf`). For 5,000 sessions that is the cost to watch. Mitigation if the test (MA8) shows it: compare ISO strings against the two period boundary instants (computed once) instead of formatting every session, and memoize the result on (sessions array identity, period start, allowance, settings).
- `statusBar()` is called on every `onDidChange`. Memoize the month model the same way so a settings tweak does not recompute for unchanged inputs.
- A setting change re-renders from the cache; it does not call `relistLogSources` or `listSessions`.
- Budget: MA8 asserts the month model for 5,000 summaries stays under 50 ms (value to be confirmed against the first measurement) and that `listSessions` is called zero extra times per setting change.

### 3.7 Settings

Contributed in `package.json` under `contributes.configuration.properties` (next to `aiCreditsAnalyzer.mcp.enabled`, whose description sits in `package.nls.json`):

| Setting | Type | Default | Notes |
|---|---|---|---|
| `aiCreditsAnalyzer.monthlyAllowance.aiCredits` | number, `minimum: 0`, `scope: "application"` | not set (`null`) | 0 or unset hides the gauge. |
| `aiCreditsAnalyzer.monthlyAllowance.resetDay` | integer 1 to 28, `scope: "application"` | 1 | Only if D1 chooses it. |
| `aiCreditsAnalyzer.monthlyAllowance.warnAtPercent` | integer 1 to 100, `scope: "application"` | 80 | Only if D4 chooses it. |

- **User scope only.** VS Code documents `scope: "application"` as "Settings that apply to all instances of VS Code and can only be configured in user settings" and not overridable by workspace or folder (https://code.visualstudio.com/api/references/contribution-points, read 2026-11-12). So a workspace's `.vscode/settings.json` cannot set it.
- `capabilities.untrustedWorkspaces.restrictedConfigurations` currently lists `aiCreditsAnalyzer.mcp.enabled` (it needs that because that setting has default window scope). If the application scope makes a listing redundant, do not list the new settings; a manifest test asserts the scope instead. Unverified: how an `application` setting reads inside a remote window with `extensionKind: ["workspace"]` (the extension runs on the remote side). Spike MA0 checks it. If it does not read the local value, fall back to `machine-overridable` scope plus the restricted listing and record the trade-off.
- Watch the settings: add a second watcher beside `watchConfigChanges` in `config/config-change-watcher.ts` for these ids, wired in `composition.ts` to a new `SidebarController.settingsChanged()` that only notifies (no re-read of logs). Do not add them to `WATCHED_SETTING_IDS`: that list drives the Copilot config check.
- Read through `ConfigurationReader` (`vscode/vscode-settings-source.ts`), which reads the effective value on each call.

### 3.8 Surfaces

- **Status bar.** A second item, left, priority 99 (after today's item). One item per concept keeps today's item unchanged and lets the gauge show on days with no sessions (today's item hides then). Click opens the Sessions view. Text carries the state in words, and the background colour only adds to it, as `vscode-status-bar.ts` already does:
  - ok: `$(dashboard) 312.40 of 1,000 AI Credits`
  - near: `$(warning) Near limit: 812.40 of 1,000 AI Credits` (warning background)
  - over: `$(error) Over: 1,042.10 of 1,000 AI Credits` (error background; unverified that `statusBarItem.errorBackground` exists for this use, MA0)
  - `ariaLabel` spells out everything, for example "AI Credits this month: at least 312.40 of 1,000 allowance, 31 percent, 12 days left, 4 of 9 sessions have cost data. Open Sessions." Role `button`, as today.
  - The codicon stays outside the translated message (existing rule).
- **Sessions view.** A first `message` node (kind exists in `sidebar/sessions-tree-model.ts`) "This month: 312.40 of 1,000 AI Credits · 12 days left". The tooltip adds remaining ("up to 687.60 remain", since used is a lower bound), the period start and the coverage line.
- **Panel (webview).** Out of scope for v1. The panel shows sessions and turns; a month gauge there needs an RPC method and its zod schema (threat-model §6 allow-list rows). Revisit after the mock-up (D5).
- **Days left.** Inclusive of today, computed from the period end. "1 day left" on the last day.

## 4. Open facts that stay owner decisions

- GitHub's billing-period rule is not asserted here. No source URL was read for it in this draft, so D1 is the owner's call.

## 5. Mock-up (owner approval before UI work)

Task MA0b draws `docs/plans/mockups/vscode-extension/MonthlyAllowance.dc.html`, in the format of the existing boards there (`Main.dc.html`, `States.dc.html`; the mcp-apps tasks A0b, A17b and A25b are the model). Boards:
- Status bar: ok, near, over, partial coverage ("At least"), unknown, today's item beside it, light, dark and high contrast.
- Tooltip text for each state.
- Sessions view header row, with and without a group below it.
- Settings editor entry (the three settings with their descriptions).
- Narrow status bar (item truncation) and a screen-reader label list.

The owner approves the boards before MA5 and MA6 start.

## 6. Tasks

TDD in every task: the failing test is written and seen red first (CLAUDE.md, architecture §11.4). SOLID: the period math, the model, the settings reader and the adapter are separate units; `vscode` appears only in the adapter.

| ID | Work | Exit criterion | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| MA0 | Spike, no product code: (a) read an `application` setting in a remote (`extensionKind: workspace`) window and in a Restricted workspace; (b) which `ThemeColor` ids a status-bar item may use (error and warning); (c) two items' order and truncation; (d) fixture session timestamps can be seeded "now" for wdio (see MA9). Notes in this file. | Each of (a) to (d) answered with how it was checked; D-recommendations updated | low | Sonnet | none |
| MA0b | Mock-up boards (§5) | Boards drawn; owner approval recorded here | medium | Sonnet (frontend-design skill) + owner | MA0 |
| MA1 | `time/billing-period.ts` + tests: period for a reset day (1 to 28), month and year boundaries, February, DST changes, a non-default zone, `daysLeft` on the first and last day. Red first | Tests green; no `vscode` import | medium | Sonnet | D1 |
| MA2 | Extract `session-credits.ts`; `status-bar/monthly-allowance.ts` + tests: known-only sum, unknown never 0, "at least" wording, all-unknown, no sessions, exactly at the allowance, over, near threshold edges (79.9, 80, 100 percent), allowance not set or invalid, sessions at the period edges, a session without `startedAt`, an `estimated` AI Credits value (decide per D7 note), translation through `Translate` | Tests green; existing `status-bar-model.test.ts` unchanged and green | high | Opus | MA1 |
| MA3 | Contribute the settings in `package.json` and `package.nls.json`; `settings/allowance-settings.ts` + tests (non-number, NaN, negative, string, 0); manifest test: scope `application`, minimum, defaults, nls keys present | `manifest.test.ts` and the reader tests green; the setting is absent from the workspace-settable list | medium | Sonnet | MA0, D1, D4 |
| MA4 | Controller wiring: `SidebarControllerOptions.allowance` (a getter, so `sidebar-controller.ts` stays free of `vscode`), `monthlyAllowance()` with memoization, `settingsChanged()`; settings watcher in `config-change-watcher.ts`; wiring in `composition.ts` | Tests: a setting change re-renders without calling `listSessions` or `relistLogSources`; a refresh recomputes; a failing getter is logged through `onInternalError` and hides the gauge | medium | Sonnet | MA2, MA3 |
| MA5 | Status-bar adapter: second item in `vscode/vscode-status-bar.ts` (text, tooltip, `accessibilityInformation`, background for near and over), hidden when not set | `vscode-status-bar.test.ts` extended and green: each level's text, label, background, hide, dispose, and that the colour is never the only signal | medium | Sonnet | MA0b approved, MA4 |
| MA6 | Sessions view header row in `sessions-tree-model.ts` (and its grouped variant `sessions-by-repository-tree-model.ts`) | Tree-model tests green: row first, hidden when not set, with the load-error tree and with the empty tree | low | Sonnet | MA0b approved, MA4 |
| MA7 | Command "Set Monthly AI Credits Allowance" in `commands/command-ids.ts` and the command registry, opening `@id:aiCreditsAnalyzer.monthlyAllowance.aiCredits` in the Settings editor (it writes nothing); `package.json` command and title in nls | Command test green; manifest test lists it | low | Haiku | MA3 |
| MA8 | Performance test: 5,000 synthetic summaries through `monthlyAllowance()`, with a counting `SidebarSources` | Under the budget in §3.6; zero extra source calls per setting change; if over, the boundary-instant optimisation lands | medium | Sonnet | MA4 |
| MA9 | wdio specs (see §7) and the fixture seed | Specs green in the UI suite and in CI (`npm run test:ui:vscode`) | medium | Sonnet | MA5, MA6, MA7 |
| MA10 | Threat-model rows (§8) | Rows written, test names cited | low | Haiku | MA3, MA5 |
| MA11 | Docs (§9) | Each listed doc updated, headers set, doc tests green (`docs.test.ts`) | low | Haiku | MA5, MA6, MA7 |
| MA12 | Review: code review, accessibility pass, full test suite, headers (`npm run headers:fix`), bundle-load tests | One exit criterion (§12) met; `main` commit per CLAUDE.md | medium | Opus | MA8 to MA11 |
| MA13 (later) | Standalone app Cost over time view: allowance line for the month (D8) | Own plan | n/a | n/a | MA12 |

## 7. UI checks (wdio, no manual rows)

Per [release-ui-gate.md](release-ui-gate.md): every check is a spec. New spec `packages/vscode-extension/test/ui/specs/monthly-allowance.e2e.ts`, in the main launch, with the allowance seeded in `userSettings` of the fixture (`scripts/ui-automation/ui-fixture.mts`, which already seeds `userSettings`; the stub `test/ui/support/ui-fixture-stub.ts` shows its shape).

| Spec | Asserts |
|---|---|
| Gauge shows | The status bar items (as `s9-group-by-repository.e2e.ts` reads them with `getStatusBar().getItems()`) include the accessibility label for month-to-date, allowance, percentage, days left and coverage |
| Words, not colour | The item's text contains "Near limit" or "Over" in those states (a fixture with usage above 80 percent and one above 100 percent) |
| Unknown is not 0 | A fixture session with no usage: the label says "at least" or "unknown", and never "0 of" |
| Sessions row | The Sessions view's first row reads "This month: ..." (`SidebarViews.rowTexts`) |
| Not set | With the setting removed, neither the item nor the row exists |
| Settings editor | `@id:` search shows each setting with its description and no "workspace" tab applies (application scope) |
| Restricted workspace | Extend the trust launch (`mcp-trust.e2e.ts` pattern): a folder whose `.vscode/settings.json` sets a huge allowance leaves the gauge hidden or at the user's value |
| Agent Host, CLI, empty-window sessions | Fixture sessions of each kind counted in the month total (needs the same seed as 10.18's fixture) |
| No notification | No notification mentions AI Credits (as `first-run.e2e.ts` asserts today), if D6 says no toasts |

The fixture's sessions need start times inside the current period when the run happens. Unverified how `ui-fixture.mts` stamps `startedAt`; MA0(d) checks it, and MA9 seeds "now minus N hours" relative to the run.

## 8. Threat-model rows to add (§6 of [threat-model.md](../threat-model.md))

- **`aiCreditsAnalyzer.monthlyAllowance.*` settings.** Threat: a workspace sets them to hide or fake the gauge. Finding to record: application scope, user settings only; a manifest test; the Restricted-Mode wdio spec. Residual: none for local workspaces; remote-window behaviour per MA0(a).
- **Status bar and Sessions row text.** Threat: logged text reaching UI. Finding: built from numbers and fixed translated strings only; no session title, path or repository name is used. Test: model test with a hostile title in a fixture.
- **No settings write, no notification, no network.** One row: the settings are read only; the command opens the Settings editor (as `openSetting` does).
- **Screen sharing.** Amounts in the status bar are visible on a shared screen. Same exposure as today's item; recorded as accepted.

## 9. Docs to update (task MA11)

- [UserGuide.md](../UserGuide.md): a "Monthly allowance" section; how to set it; what "at least" means; the missing-spend list of §3.5; no projection.
- [vscode-extension-guide.md](../vscode-extension-guide.md): the "Status bar" section (line 356 and on) and the settings list.
- `packages/vscode-extension/CHANGELOG.md` `[Unreleased]` `### Added` (and the extension README if it lists settings).
- [architecture.md](../architecture.md) §12 (extension): the model, the setting, the no-rescan rule.
- [threat-model.md](../threat-model.md): §8 above.
- [implementation-plan.md](../implementation-plan.md): a new step row, and [implementation-plan-gantt.md](../implementation-plan-gantt.md): the bar, percentage, Open items and detail chart (CLAUDE.md rule). 
- `package.nls.json` and the l10n bundle: every new string.
- Every changed doc gets the last-changed header.

## 10. Owner decisions

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | When does the period start? | (a) calendar month in local time; (b) calendar month in UTC; (c) a user-set reset day, judged in local time | **Accepted 2026-11-12:** (c), default day 1, documented as "set it to match your GitHub billing page". No rule is asserted from memory, and no source was read in this draft. A one-day error at the edge is the risk with (a) and (b). Add the zone choice only if the owner wants it. |
| D2 | Where does the gauge show? | status bar only; status bar and Sessions row; also the panel | **Accepted 2026-11-12:** Status bar and Sessions row now; the panel later (D5). |
| D3 | Month-end projection? | none; a projected total; a range | **Accepted 2026-11-12:** **None.** Estimates deliberately show no run rate: [mcp-apps.md](mcp-apps.md) §9.1 question 15 (U15: "A single `runRate` number would read as an estimate"), repeated in the User Guide ("never one number, and no run rate"). The gauge shows used, remaining ("up to") and days left only. Arithmetic on known figures, not a forecast. |
| D4 | Warning thresholds | fixed 80 and 100 percent; a setting `warnAtPercent` | **Accepted 2026-11-12:** One setting, default 80; over at 100. Two levels keep the states few. |
| D5 | Panel (webview) gauge? | now; later | **Accepted 2026-11-12:** Later: it needs an RPC method and threat-model rows. |
| D6 | Notification (toast)? | none; once per period per threshold, opt-in | **Accepted 2026-11-12:** None in v1. The extension offers no notification today except none about itself (`first-run.e2e.ts` asserts it), and a toast is not needed for a persistent item. If added later: opt-in setting, once per period and level, remembered in `globalState`. |
| D7 | Unknown sessions: how deep? | v1: whole-session known or unknown, "at least"; later: per-turn via cost rollup; attribute by turn date, not session start | **Accepted 2026-11-12:** v1 as listed. The per-turn path opens every session of the month and costs the budget in §3.6. Revisit if "at least" shows too often on the owner's real data (measure in MA12). |
| D8 | Standalone app's Cost over time? | include; later | **Accepted 2026-11-12:** Later (MA13). The app has no settings store for this and its views span providers whose AI Credits are partial; a separate plan. |
| D9 | One item or merge into today's item? | second item; one item | **Accepted 2026-11-12:** Second item (gauge shows on days with no sessions; today's item stays as is). |
| D10 | Scope of the setting | `application`; `window` + restricted listing | **Accepted 2026-11-12:** `application`, pending MA0(a) for remote windows. |

## 11. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Month figure is a lower bound (unknown sessions, pruned logs, subagent spend, other machines) | The user trusts the gauge and exceeds the allowance | "At least" wording, coverage in tooltip, oldest-session date, User Guide list (§3.5). **Biggest risk.** |
| Billing period differs from the user's reset setting | Gauge resets on the wrong day | User-set reset day (D1), wording "matches your billing page" |
| `application` scope unreadable in a remote window | Gauge never shows for remote users | Spike MA0(a); fallback scope |
| `dayKeyOf` per session slows a large list | Status bar lag on refresh | Boundary-instant comparison and memoization (MA8) |
| Status-bar colours unavailable or low contrast in high contrast themes | State lost | Words and icons carry the state; wdio asserts text |
| Spend of cloud agent and other machines is absent | Gauge reads low | Wording "recorded here" |
| Mock-up approval stalls MA5/MA6 | Delay | MA1 to MA4 proceed without UI |
| A user types the plan's amount in the wrong unit (premium requests vs AI Credits) | Wrong percentage | Setting description says "AI Credits" and the unit; no plan amounts or conversions shipped |

## 12. Exit criterion

With `aiCreditsAnalyzer.monthlyAllowance.aiCredits` set in user settings, the extension shows month-to-date AI Credits against it in the status bar and the Sessions view, with days left, coverage and a words-first warning at the threshold, never counting an unknown session as 0, and with no extra log read per refresh or setting change; the unit tests, the new wdio specs and the full suite pass, the docs and threat-model rows are updated, and the owner approved the mock-up.
