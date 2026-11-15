# Monthly AI Credits allowance in the standalone app (MA13)

**Last changed:** 2026-11-15 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **Plan approved 2026-11-14** (D1–D11 accepted). Task MA13 of [monthly-allowance.md](monthly-allowance.md) (step 10.21), 1.0 criterion C9 and build task V20 in [implementation-plan.md](../implementation-plan.md) ("1.0.0 release"). Build next.

## Contents

1. Why
2. Goals and non-goals
3. What exists, what is reused, what is new
4. Design
5. Mock-ups
6. MCP
7. Threat-model rows
8. Tasks
9. Owner decisions
10. Risks
11. Exit criterion
12. Docs to update

## 1. Why

- The extension shows month-to-date AI Credits against the user's monthly allowance in its status bar and Sessions view (step 10.21, shipped in extension 0.12.0).
- The standalone app "Agent Cost Analyzer" reads the same Copilot logs but has no gauge. A user who runs only the app must add up days on the Dashboard to answer "how much of my month is left?".
- monthly-allowance.md D8 deferred the app because it had no settings store for the value and its views span providers whose AI Credits are partial. This plan answers both.
- The owner made it a 1.0 criterion (C9) on 2026-11-14.

## 2. Goals and non-goals

Goals:

- G1. The user sets the monthly AI Credits allowance, reset day and warning percentage in the app; the values persist in the app's own settings folder.
- G2. Analyze mode shows month-to-date billed AI Credits against the allowance, with days left, coverage and a words-first level (normal, near limit, over).
- G3. The same honesty rules as the extension: unknown is never 0, a partial sum reads "at least", only sessions recorded on this machine count.
- G4. One computation for both products: the extension's pure allowance logic moves to a shared package; neither product copies it.
- G5. An MCP tool answers the same question with the same figures.
- G6. Every check is automated: unit tests, Playwright specs in light and dark, and a `REAL_DATA` check against an oracle from raw Copilot logs.

Non-goals (checked against [vision.md](../vision.md) §6, [architecture.md](../architecture.md) §2 and monthly-allowance.md §2):

- No live fetching of plan, quota or price data (constraint 1). The user types the number.
- No plan amounts in code or docs.
- No month-end projection or run rate (monthly-allowance.md D3).
- No notification or toast (monthly-allowance.md D6).
- No write to VS Code's `settings.json`; the app never writes outside its own settings folder (architecture §8, §11.2).
- No US dollar figure in the gauge. The allowance unit is AI Credits; the Dashboard's currency switch stays where it is.
- No reading of both VS Code Stable and Insiders at once (D5): that is a provider change for the whole app, not a gauge change.
- No gauge in the extension's panel (monthly-allowance.md D5 stays "later").
- No allowance line on the Cost over time chart (D3, reasons there).

## 3. What exists, what is reused, what is new

### 3.1 The extension (step 10.21)

Paths under `packages/vscode-extension/src/`. All are pure and free of `vscode`:

| Module | What it does | Fate |
|---|---|---|
| `time/billing-period.ts` | `periodOf(now, timeZone, resetDay)` → `{ startKey, endKeyExclusive, daysLeft, dayOfPeriod }` | Moves to domain |
| `time/local-time.ts` | `dayKeyOf`, `dayStartInstant` (binary search, DST-safe), `previousDayKey`, `timeOfDayOf` | `dayKeyOf` and `dayStartInstant` move to domain; the extension imports them |
| `status-bar/session-credits.ts` | `knownSum`, `billedCredits` (an `estimated` value is not billed), `knownCredits`, `sessionDayKey` | `knownSum`, `billedCredits`, `knownCredits` move to domain |
| `status-bar/monthly-allowance.ts` | `buildMonthlyAllowance`: period filter by boundary instants, known-only sum, level, percent (rounded down), remaining ("up to"), coverage, oldest session counted, and the translated status-bar text, tooltip, `ariaLabel`, row label | Split: the figures move to domain (`computeMonthlyAllowance`); the shared wording moves with them (MS2); codicons and "Open Sessions." stay in the extension |
| `settings/allowance-settings.ts` | `AllowanceSettings`, `readAllowanceSettings` (lenient: a bad value is "not set" or the default), `DEFAULT_RESET_DAY = 1`, `DEFAULT_WARN_AT_PERCENT = 80` | The type, defaults and lenient parser move to domain; the VS Code setting ids stay in the extension |

Their tests (`billing-period.test.ts`, `monthly-allowance.test.ts`, `session-credits.test.ts`, `allowance-settings.test.ts`, `sidebar/monthly-allowance-performance.test.ts`) are the safety net for the move: they move with the code or stay and import from domain, unchanged in what they assert.

### 3.2 The standalone app

- **Settings.** `packages/server/src/data-sources/log-providers/app-settings.ts` reads and writes `settings.json` in `resolveAppSettingsDir()` (read-merge-write, so one key never clobbers another). It holds `activeProviderId` and `minRetainedSessionLogsThreshold`. The port `AppSettingsStore` is shared with the extension's `globalState` store and has a contract test (`app-settings-store-contract.ts`).
- **Write patterns.** `PUT /api/config/retention-threshold` (body `{ value }`, a positive integer, else 400; returns the fresh `ConfigStatus`) and `PUT /api/projects` (whole file, zod plus `validateProjectsFile`, 400 with `problems`, nothing written on error, temp file 0600 then rename). Both rely on the CORS preflight the server never answers (threat-model §4).
- **Header.** `packages/web/src/components/AppHeader.tsx`: brand, Learn/Analyze switch, provider select, the Retention number input (commit on blur), status text, the colour-mode switch, Config.
- **Sessions with AI Credits.** Only the VS Code provider (`providerId: "vscode"`) records billed AI Credits. `VscodeLogProvider.listSessions()` merges classic sessions (SQLite plus `main.jsonl`, with classic subagent spend since step 10.19) and Agent Host and Copilot CLI sessions (`copilotHarness: "agent-host"`). Claude Code, pi and mitmproxy sessions have none.
- **One VS Code variant.** `resolveUserDataDir()` (`platform/vscode-paths/resolve-user-data-dir.ts`) returns the first existing of "Code - Insiders" and "Code". The session store, debug logs and Agent Host paths all derive from it, so the app reads Insiders or Stable, never both.
- **Time zone.** `createStandaloneApiService` passes `timeZone` (the machine's IANA zone) to the statement service; statement periods are calendar days there and the Billing tab names the zone. The Playwright suite runs the server with `timeZone: "UTC"` and a fixed clock (`e2e/support/fixture-clock.ts`, `FIXTURE_NOW`).
- **Product flags.** `productFeaturesSchema` (`packages/domain/src/product-profile.ts`) drives what the shared web UI shows per product.
- **Cost over time.** `GET /api/cost/timeseries` buckets by UTC day, week or month over every provider and basis.

### 3.3 New

| Piece | Where |
|---|---|
| `allowance/` module: period, day keys, known sum, `computeMonthlyAllowance`, wording, settings type, lenient parser and strict write schema, `monthlyAllowanceAnswerSchema` | `packages/domain/src/allowance/` |
| `AllowanceSettingsStore` port and `FileAllowanceSettingsStore` | `packages/server/src/data-sources/log-providers/` beside `app-settings.ts` |
| `MonthlyAllowanceService` | `packages/server/src/services/allowance/` |
| `GET /api/monthly-allowance`, `PUT /api/config/monthly-allowance` | `app.ts` routes over two new `ApiService` methods |
| `ProductFeatures.monthlyAllowance` | domain flag: standalone true, extension false |
| MCP tool `get_monthly_allowance` | `packages/server/src/mcp/allowance-tools.ts`, group `allowance` (D7) |
| Header gauge, details dialog, settings dialog | `packages/web/src/components/allowance/` |
| View model | `packages/web/src/lib/allowance/allowance-view.ts` |
| Playwright spec | `packages/web/e2e/specs/ma-monthly-allowance.spec.ts` |
| Real-data check and oracle | `packages/server/scripts/allowance-exit.real.test.mts`, `allowance-oracle.mts` |

## 4. Design

### 4.1 Shared logic (SOLID, CUPID)

- **Single responsibility.** Four units, as in the extension: the period (`periodOf`), the sum (`knownSum` with `billedCredits`), the figures (`computeMonthlyAllowance`), the wording (`describeMonthlyAllowance`). Each product adds only its adapter: the extension's status bar and Sessions row, the app's header and dialogs.
- **Home: `packages/domain`** (D8). Every package already depends on it, it is pure TypeScript with `zod`, and the extension's bundle-boundary test already admits it. A new workspace package would add build, bundle and test configuration for five small files.
- **Figures, not text, cross the HTTP boundary.** `computeMonthlyAllowance({ sessions, now, timeZone, settings })` returns `hidden` or `{ level, allowance, used | null, atLeast, percent | null, remaining | null, daysLeft, period, coverage, countedSinceKey }`. Exactly the fields `MonthlyAllowance` has today, minus the strings.
- **Wording in one place.** `describeMonthlyAllowance(figures, t = identityTranslate)` returns the figure text ("at least 812.40 of 1,000 AI Credits · near limit"), the coverage line, the days-left text and the detail lines. The "at least" and "unknown" wording is the trust rule, so both products must say it the same way. The extension keeps its codicons and its aria strings that end in "Open Sessions."; its strings stay byte-identical, which its unchanged tests prove.
- **Open-closed.** The extension's `buildMonthlyAllowance` becomes a thin text layer over the domain figures; no behaviour changes. The app adds new adapters and touches no existing behaviour.
- **Interface segregation.** The allowance store is its own port, not three more methods on `AppSettingsStore`: the extension's `globalState` store must not grow allowance methods its settings never use (its value lives in VS Code settings).
- **Dependency inversion.** `MonthlyAllowanceService` takes `listCopilotSessions: () => Promise<Session[]>`, `settings: AllowanceSettingsStore`, `now: () => Date`, `timeZone: string` and `source: CopilotSourceInfo`. Tests pass fakes; composition passes `registry.getProvider("vscode")`.
- **Predictable.** Same input, same figures, in both products and in the MCP tool. No caching that outlives a request.
- **Domain-based names.** Allowance, period, reset day, coverage, level; no "quota" or "budget".

### 4.2 Where the setting lives

- **`settings.json` in the app's settings folder** (D1), key `monthlyAllowance`:

  ```json
  { "monthlyAllowance": { "aiCredits": 1000, "resetDay": 1, "warnAtPercent": 80 } }
  ```

- Not `projects.json`: that file holds projects, channels and price versions, is replaced whole by `PUT /api/projects` and edited in the Projects editor. An allowance there would couple a one-number edit to the whole-file validation and the editor.
- Same semantics as the extension's three settings: `aiCredits` a finite number above 0 or not set (`null`/absent hides the gauge); `resetDay` integer 1 to 28, default 1; `warnAtPercent` integer 1 to 100, default 80; over at 100 percent.
- **Read is lenient**, as in the extension: a missing, corrupt or out-of-range value reads as "not set" or the default; never an error page, never a figure the user did not type.
- **Write is strict**: the PUT validates the whole object and writes nothing on any problem.
- **Atomic write** (D10): the shared settings writer moves to a temporary file in the same folder, mode 0600, then rename, as `FileProjectStore` does. Two processes now read the file (the web server and the stdio MCP server), and a torn write must never read as a different allowance.

### 4.3 How it is edited

- **Settings dialog** (D2), opened from the gauge's details or from the "Set monthly allowance" button. Three labelled number fields with their units and ranges in the label text ("Monthly allowance (AI Credits)", "Reset day (1 to 28)", "Warn at (percent of allowance)"), a hint "Set it to match your GitHub billing page", **Save**, **Remove allowance** and **Cancel**.
- Client-side checks mirror the server's for messages only; the server decides. A 400 shows its message beside the field it names; nothing changes.
- **`PUT /api/config/monthly-allowance`**, beside `/api/config/retention-threshold`:
  - Body: `{ "aiCredits": number | null, "resetDay": integer, "warnAtPercent": integer }`, parsed with `allowanceSettingsWriteSchema` (domain, `.strict()`): `aiCredits` finite, above 0 and at most 1,000,000,000 (a sanity cap, not a plan amount) or `null`; ranges as above. Unknown keys, strings and non-integers are 400.
  - `null` removes the allowance (the key stays with `aiCredits: null`, so the reset day and threshold survive).
  - Returns the fresh `MonthlyAllowanceAnswer`, so the header updates from one response (the retention route's pattern).
  - JSON only: `express.json()` parses nothing else, so a form post reaches validation with no body and gets 400; a JSON PUT from another origin needs a preflight the server never answers.
- The extension's `ApiService` has no allowance store: both methods answer 404 there (as statements do). No webview RPC method is added.

### 4.4 What the gauge counts

- **Sessions:** `registry.getProvider("vscode").listSessions()`, whatever provider is active in the app (D5). Claude Code, pi and mitmproxy sessions never count; they record no billed AI Credits.
- **One figure** for classic, Agent Host, Copilot CLI and empty-window sessions: one GitHub allowance pays for all of them. The details dialog splits it by harness (`copilotHarness`: "local" as "Copilot Chat", "agent-host" as "Agent Host and Copilot CLI"), each with its own known-of-total.
- **One VS Code variant:** the one `resolveUserDataDir()` picked. The details name it with a fixed label ("VS Code Insiders" or "VS Code"), never the path. With both installed the app counts Insiders only; the User Guide says so, and that the extension in each variant counts its own.
- **Billed only:** `billedCredits` leaves out `estimated` values, which count as unknown (extension MA2).
- **Whole sessions:** a session's `costAiCredits` is all-or-nothing (constraint 6); one unknown turn makes the session unknown and the sum "at least" (monthly-allowance.md D7, measured on the owner's data in its §14).
- **Attribution by start:** a session counts wholly in the period it started in (monthly-allowance.md §3.5).
- **VS Code provider unavailable** (no Copilot logs on this machine): state `no-source`, "No Copilot Chat logs found on this machine", never 0.

### 4.5 Period, time zone, threshold

- Period: `periodOf(now, timeZone, resetDay)` from the shared module; reset day as the extension's D1.
- Time zone: the server's `timeZone` dependency, the machine's zone, as statements use. The browser runs on the same machine, so the header's "today" and the server's agree. The details show the zone: "Period 2026-11-01 to 2026-11-30 (Europe/Tallinn)".
- Cost over time buckets in UTC; its November bar can differ from the gauge near midnight on the period's edges. The User Guide says so.
- Threshold: `warnAtPercent`, default 80; over at 100; percent rounded down so it never reads above the level (extension rule).
- Days left: inclusive of today, "1 day left" on the last day.

### 4.6 The answer

`GET /api/monthly-allowance` returns `MonthlyAllowanceAnswer` (zod schema in domain, used by the route, the client and the MCP tool's `outputSchema`):

| Field | Content |
|---|---|
| `settings` | `{ aiCredits, resetDay, warnAtPercent }` as read |
| `state` | `not-set`, `no-source`, `no-sessions`, `unknown`, `known` |
| `period` | `{ startKey, endKeyExclusive, timeZone, daysLeft, dayOfPeriod }` |
| `figures` | with `known`: `level`, `used`, `atLeast`, `percent`, `remaining`, `coverage`, `countedSinceKey`; with `unknown`: `coverage` and `countedSinceKey` (the oldest session, as the extension's tooltip shows it); with `no-sessions`: `coverage` only; none with `not-set` and `no-source` | <!-- codespell:ignore atleast -->
| `source` | `{ providerId: "vscode", available, reason?, variant: "VS Code" \| "VS Code Insiders" \| null, byHarness: [{ harness, known, total, used \| null }] }` |
| `asOf` | the instant computed |

No session id, title, path or repository name is in it: every object is strict. The top level stays one object (an MCP tool's output schema must be one), so the schema's refinement, not a union, ties each state to its figures: `not-set` exactly when `aiCredits` is null, `no-source` exactly when the source is unavailable, `known` needs a session with cost data and its "at least" flag matches the coverage, `unknown` has sessions and none with cost data, and a harness has `used` exactly when one of its sessions has cost data.

### 4.7 Where the gauge shows

- **The header, in Analyze mode only** (D3, D4), after the provider select. A button whose text is figure-first and level last, as the extension's status bar (owner decisions 1 to 3 of 2026-11-13):
  - normal: "312.40 of 1,000 AI Credits"
  - near: "812.40 of 1,000 AI Credits · near limit"
  - over: "1,042.10 of 1,000 AI Credits · over"
  - partial: "at least 812.40 of 1,000 AI Credits · near limit"
  - unknown: "AI Credits this month: unknown"
  - no sessions: "No sessions this month"
  - no source: "AI Credits this month: no Copilot logs"
  - not set: a muted "Set monthly allowance" button; no figure, no colour, no banner (D6).
- `aria-label` spells out everything, level sentence first when near or over (the extension's label without "Open Sessions."). Colour and any meter only add to the words. A meter, if the mock-up has one, never looks exact when the sum is "at least" (an open, dashed end) and is absent when unknown.
- **Click or Enter opens a details dialog**, not a hover tooltip (keyboard and touch): the tooltip's lines (allowance, percent, "up to N remain", days left, period and zone, coverage, oldest session counted, "may be higher", "Only VS Code Copilot sessions recorded on this machine are counted"), the by-harness split, the VS Code variant, the missing-spend list in one line each (monthly-allowance.md §3.5), **Change allowance**, **Recount**. Focus returns to the gauge on close.
- **Narrow windows:** the gauge keeps its figure and drops the level word to the details at the narrow breakpoint ([dense-ledger-ui.md](dense-ledger-ui.md) layout rules); no horizontal scroll at 320 px.
- **Ledger theme:** mono text, hairline border, light and dark from the existing `[data-color-mode]` tokens; near and over use existing warning and error roles that pass the contrast tests (`theme-contrast.test.ts`). No new colour token unless the mock-up needs one, and then it passes 4.5:1 in both modes.
- **Not on the Dashboard or in the session list** (D3): the Dashboard's tiles follow its selections, the gauge does not; the session list follows the active provider, the gauge does not.

### 4.8 When it loads

- On entering Analyze mode, after a save, and on **Recount**. No timer and no polling (as the extension).
- One `listSessions()` per request; no server cache. The same read `GET /api/sessions` makes for the VS Code provider. MS5 measures it on a large fixture and adds a short-lived memo only if the budget fails.

## 5. Mock-ups

Task MS0 draws `docs/plans/mockups/monthly-allowance-standalone/` in the `.dc.html` format of [mockups/savings-report/](mockups/savings-report/README.md), with a `README.md` and `canvas.json`. Every board in the standalone ledger theme, light and dark (Phase 17):

- `Header.dc.html`: the header at 1440 px in each state of §4.7, beside the provider select and Retention.
- `Details.dc.html`: the details dialog for known, partial ("at least"), unknown, no sessions, no source; with the by-harness split.
- `Settings.dc.html`: the settings dialog empty, filled, with a server 400 on a field, and Remove allowance.
- `Narrow.dc.html`: 320 px and 768 px header, the dialog full width.
- `A11y.dc.html`: the aria-label list for each state and the focus order.

The owner approves the boards before MS7 starts. MS1 to MS6 and MS9 proceed without them.

## 6. MCP

Recommendation (D7): a new read-only tool **`get_monthly_allowance`** in a new tool group `allowance`, registered by the standalone stdio server.

- No arguments. Output: `MonthlyAllowanceAnswer` (`outputSchema`), plus the usual one-line sentence ("At least 812.40 of 1,000 AI Credits used this period (81 %), 12 days left; 13 of 20 sessions have cost data.").
- Description: the allowance is the user's own number; figures are billed AI Credits of VS Code Copilot sessions on this machine; "at least" is a lower bound; unknown is never 0; no projection.
- It reads `settings.json` through the same `FileAllowanceSettingsStore`, so the web header and the tool agree.
- Not an extension of `get_cost_rollup`: that tool takes an arbitrary window over every provider; an allowance block there would change its output schema and snapshot for a figure that only means something for the current period of one provider.
- The extension's MCP server can join later by passing a store that reads its VS Code settings (the port allows it); not in 1.0.
- `mcp-identity.ts` instructions gain one sentence: "For 'how much of my monthly allowance is left?' use get_monthly_allowance." Tool count 22 → 23 (architecture §8, threat-model §4).

## 7. Threat-model rows

Rows for [threat-model.md](../threat-model.md) §4 (task MS11, test names cited when written):

| Component | Threat | Finding to record |
|---|---|---|
| `PUT /api/config/monthly-allowance` | Tampering, CSRF from a web page, oversized or malformed input | Same CSRF protection as the retention row: JSON PUT needs a preflight the server never answers; `allowanceSettingsWriteSchema` (`.strict()`, ranges, sanity cap) before any write; fixed file name; 100 kB body limit; nothing written on error |
| `settings.json` (now holding a user value read by two processes) | A torn or hand-corrupted file faking or hiding the gauge | Atomic write (temp file 0600, rename); lenient read turns anything unusable into "not set" or the default, never a figure the user did not type. Residual: the OS user can edit the file, by design |
| Gauge text, details dialog, MCP output | Logged text reaching the UI or a model | Built from numbers, day keys, the zone, a fixed variant label and fixed strings; no session title, path or repository name. Test: a hostile session title in a fixture never appears in the answer |
| `get_monthly_allowance` | Disclosure to a third-party model | Read-only annotation, no arguments; discloses the allowance number and month-to-date totals only. Added to the MCP server row's tool count (23) |
| Gauge: no notification, no network | Interrupting or sending data out | No toast, no fetch outside `/api`; the allowance modules make no network call |
| Screen sharing | Amounts visible in the header | Same exposure as the session list and Dashboard; accepted |

## 8. Tasks

TDD in every code task: the failing test is written and seen red first ([CLAUDE.md](../../CLAUDE.md), architecture §11.4). No local model in this repo. The extension's existing allowance tests stay unchanged in what they assert.

| ID | Task | Exit | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| MS0 | Mock-up boards (§5), light and dark | Boards in `docs/plans/mockups/monthly-allowance-standalone/`; owner approval recorded here | medium | Sonnet (frontend-design skill) + owner | D2, D3, D4, D6 accepted |
| MS1 | **Done 2026-11-15.** Move the pure logic to `packages/domain/src/allowance/`: `periodOf`, `dayKeyOf`, `dayStartInstant`, `knownSum`, `billedCredits`, `knownCredits`, `computeMonthlyAllowance` (figures), `AllowanceSettings`, defaults, the lenient parser, `allowanceSettingsWriteSchema`, `monthlyAllowanceAnswerSchema`. The extension imports them; its `buildMonthlyAllowance` becomes text over the figures | Domain tests green (moved tests red first against the empty module); every extension allowance test unchanged and green; `bundle-load.test.ts` and the bundle-boundary test green | high | Opus | D8 |
| MS2 | `describeMonthlyAllowance` (shared wording) in domain; the extension's text built from it | Extension strings byte-identical (its tests unchanged); domain wording tests for each state | medium | Sonnet | MS1 |
| MS3 | `AllowanceSettingsStore` port, `FileAllowanceSettingsStore` over `settings.json`; the shared writer made atomic (temp 0600, rename) | Store contract test (round trip, other keys kept in both orders, corrupt file reads "not set", out-of-range reads default); `app-settings.test.ts` and the `AppSettingsStore` contract still green | medium | Sonnet | MS1, D1, D10 |
| MS4 | `MonthlyAllowanceService`, the `ApiService` methods, both routes, `ProductFeatures.monthlyAllowance`, the variant label from the resolved user-data dir | `app.monthly-allowance.test.ts`: every state of §4.6; active provider pi still counts VS Code sessions; 400 cases (0, -1, NaN as string, 29, 101, unknown key, form body) write nothing; extension `ApiService` 404; hostile title absent | medium | Sonnet | MS1, MS3 |
| MS5 | Performance: the service over 5,000 summaries, and the GET on the e2e fixture | Compute under 50 ms for 5,000 (the extension's budget); one `listSessions` per request; memo only if over | low | Sonnet | MS4 |
| MS6 | Web client `api-client/monthly-allowance.ts` (parses with the domain schema) and `lib/allowance/allowance-view.ts` (labels, aria-label, details lines from `describeMonthlyAllowance`) | Tests per state: "at least", "unknown", never "0 of"; aria level sentence first | medium | Sonnet | MS2, MS4 |
| MS7 | Header gauge, details dialog, settings dialog (`components/allowance/`), behind the product flag, Analyze mode only | Component tests for each state, keyboard, focus return, field errors from a 400; `a11y.test.tsx` axe pass; narrow layout test | medium | Sonnet | MS0 approved, MS6 |
| MS8 | Playwright `ma-monthly-allowance.spec.ts` and fixture seeds (allowance in the fixture's `settings.json`; known, unknown and Agent Host sessions in the fixture period at `FIXTURE_NOW`) | Specs of §11 green in the light and dark projects locally and in CI | medium | Sonnet | MS7 |
| MS9 | MCP `get_monthly_allowance` (group `allowance`, standalone), identity sentence | `tool-list-contract.test.ts`, `tool-groups.test.ts`, `mcp/security.test.ts` (no title or path), `stdio.test.ts` green; answer equals `GET /api/monthly-allowance` in a test | medium | Sonnet | MS4, D7 |
| MS10 | `REAL_DATA` check `allowance-exit.real.test.mts` and `allowance-oracle.mts`; npm script `test:real-data:allowance`, added to `test:real-data` | Passes on the owner's logs (§11); owner signs off its output | high | Opus | MS4, MS9 |
| MS11 | Threat-model rows (§7) | Rows written with test names | low | Haiku | MS3, MS4, MS9 |
| MS12 | Docs (§12) | Each doc updated with its header; links resolve | low | Sonnet | MS7, MS9 |
| MS13 | Review: code review, accessibility pass, full suite, `npm run headers:check`, `npm run lint`, the real-data run | §11 met; one `main` commit per CLAUDE.md; Gantt updated | medium | Opus | MS5, MS8, MS10, MS11, MS12 |

Parallelism: MS0 with MS1 to MS6; MS9 with MS6 to MS8; MS10 once MS4 lands.

## 9. Owner decisions

Decided 2026-11-14: the owner accepted each recommendation.

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | Where does the allowance live? | (a) app `settings.json`, key `monthlyAllowance`; (b) `projects.json`; (c) (a) plus a read-only fallback to the extension's `aiCreditsAnalyzer.monthlyAllowance.*` in VS Code's user `settings.json` | **(a).** App preferences already live there; `projects.json` is replaced whole and edited in the Projects editor. (c) couples the app to the extension's setting ids and the variant the app reads, and adds an "inherited" state; revisit after 1.0 if users ask. |
| D2 | How is it edited? | (a) a settings dialog from the gauge, three fields, Save and Remove; (b) a header number input like Retention; (c) hand-edit only | **(a).** Three related values with ranges and a removal need labels and errors; the header has no room for three inputs. |
| D3 | Where does the gauge show? | (a) header, with a details dialog; (b) a Dashboard Overview tile; (c) a row above the session list; (d) an allowance line on Cost over time (MA13's first wording) | **(a) only.** Persistent like the status bar and independent of the active provider. (b) and (c) follow selections or the provider, the gauge does not. (d): Cost over time buckets are UTC calendar months over every provider and basis, so a reset day other than 1 or any non-Copilot selection makes the line wrong. |
| D4 | Learn mode? | show; hide | **Hide.** Learn shows simulated scenarios; real spend beside them mixes the two. |
| D5 | Several Copilot sources | (a) one sum of classic, Agent Host, CLI and empty-window, split in the details; (b) separate gauges; (c) also read Stable and Insiders together | **(a)**, naming the one VS Code variant read. One allowance pays for all harnesses. (c) changes what every view reads; a separate step after 1.0 if wanted. |
| D6 | Not set | (a) hidden entirely; (b) a muted "Set monthly allowance" button in Analyze mode | **(b).** The app has no command palette, so a quiet button is its discoverable entry; no banner, no colour, no toast. |
| D7 | MCP | (a) new tool `get_monthly_allowance`, standalone; (b) a block in `get_cost_rollup`; (c) none | **(a).** One question, one tool; `get_cost_rollup`'s windows and providers don't match a period of one provider. Extension parity later. |
| D8 | Home of the shared logic | (a) `packages/domain/src/allowance/`; (b) a new workspace package | **(a).** Every package already depends on domain; no new build or bundle config. |
| D9 | Notification | none; opt-in | **None**, as the extension's D6. |
| D10 | Atomic settings write | (a) temp 0600 and rename for `settings.json` in this step; (b) as today | **(a).** A second reader process (MCP) and a user value now depend on the file. |
| D11 | Real-data check scope | current period only; current and the two previous full periods | **Current and two previous**, through the service's injected clock: more sessions and both period edges checked, no wait for a month to pass. |

## 10. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| The sum is a lower bound (unknown sessions, pruned logs, other machines, github.com and cloud agent spend) | The user trusts it and exceeds the allowance | "At least" wording, coverage and oldest session in the details, "recorded on this machine", the User Guide's missing-spend list. **Biggest risk.** |
| With Stable and Insiders both installed, the app counts Insiders and each extension counts its own | Three different numbers for one allowance | The variant named in the details; User Guide paragraph; D5 (c) as a later step |
| Moving the extension's logic breaks it | Status-bar regression | MS1 keeps every extension test unchanged; bundle-load and boundary tests; MS2 keeps strings byte-identical |
| `listSessions()` per request is slow on a large store | Header lags on Analyze entry | MS5 budget; memo only if needed; the gauge loads after the session list, never blocks it |
| Torn `settings.json` between two processes | A wrong or missing allowance | Atomic write (D10), lenient read |
| Oracle and product disagree at period edges (start from SQLite `created_at` vs first log line; unverified which the oracle can read independently) | Flaky or false failures | MS10 records the start source; edge sessions listed by id and date in the output; tolerance 0.01 AI Credits on sums, exact on counts |
| Cost over time and gauge differ near midnight | Confusion | UTC note on Cost over time in the User Guide; the gauge names its zone |
| Mock-up approval stalls UI | Delay | MS1 to MS6, MS9 and MS10 go ahead |
| Header crowding at medium widths | Controls wrap | Narrow rule in §4.7; mock-up board at 768 px; layout test |

## 11. Exit criterion

With an allowance set in the app's settings dialog, Analyze mode's header shows month-to-date billed AI Credits of the VS Code provider's sessions against it, whatever provider is active, with days left, coverage, the period's time zone and a words-first level at the threshold, never counting an unknown session as 0; the value persists in the app's `settings.json` through the validated, atomic PUT; `get_monthly_allowance` returns the same answer; the extension's allowance tests pass unchanged; and these automated checks pass:

- Unit and component tests of MS1 to MS9, and the full suite.
- **Playwright** `ma-monthly-allowance.spec.ts`, in the light and dark projects:
  - Not set: the "Set monthly allowance" button, no figure.
  - Set through the dialog: the gauge appears; after a reload it is still there (the file was written).
  - Invalid values (0, -1, reset day 29, warn 101): the field shows the server's message and a GET is unchanged.
  - Remove allowance: back to not set.
  - Near and over: the button text has "near limit" or "over" (words, not colour).
  - Partial and unknown: "at least" or "unknown", never "0 of".
  - Active provider switched to another provider: the gauge's figure unchanged.
  - Learn mode: no gauge.
  - Details: period with zone, coverage, by-harness split, VS Code variant; keyboard open and close, focus returns; axe passes on the header and both dialogs.
  - 320 px: no horizontal scroll; the figure visible.
  - MCP: `get_monthly_allowance` through `e2e/support/mcp-stdio.ts` equals the header's figures.
- **`npm run test:real-data:allowance`** on the owner's logs:
  - The oracle (`allowance-oracle.mts`) reads raw Copilot logs and shares no code with the product: classic `main.jsonl` and subagent logs through the SA18 scanners, Copilot CLI `events.jsonl` through the V3 oracle's reader; it applies the plan's rules (billed only, whole-session known, start-time attribution in the machine's zone, reset day from the settings).
  - For the current period and the two previous full periods (D11): `used` within 0.01 AI Credits of the oracle's sum of known sessions; `coverage.known` and `coverage.total` exact; the by-harness split equal; `state` `unknown` exactly when the oracle knows no session; never `used: 0` with `known: 0`.
  - `GET /api/monthly-allowance` and `get_monthly_allowance` answer the same.
  - Output carries ids, dates, sums and counts only, never titles, prompts or paths. The owner signs off the output.
- Docs and threat-model rows updated; the owner approved the mock-ups.

## 12. Docs to update

- [UserGuide.md](../UserGuide.md): a "Monthly allowance" section under Analyze mode (set, change, remove; what "at least" and "unknown" mean; what counts and the missing-spend list; the VS Code variant; the period, reset day and zone; no projection); the header line in "The shared layout"; the MCP section gains `get_monthly_allowance`; the Cost over time UTC note.
- [architecture.md](../architecture.md): §4.1 module table (store, service), §4.2 (`components/allowance`), §4.3 (domain `allowance/`), §5 (`MonthlyAllowanceAnswer`), §8 (two routes, 23 tools), §11.2 (the app's writes, atomic settings write), §12 (the extension's allowance imports domain), §13 (settings file now holds the allowance).
- [threat-model.md](../threat-model.md): §7 of this plan; the MCP row's tool count.
- [monthly-allowance.md](monthly-allowance.md): the MA13 row points at this plan and its status.
- [standalone-app.md](../standalone-app.md): the settings folder's contents if it lists them.
- Root `CHANGELOG.md` `[Unreleased]` `### Added`: the gauge, the settings dialog, the MCP tool. The extension's CHANGELOG only if a user-visible string changes (it must not).
- [implementation-plan.md](../implementation-plan.md) and [implementation-plan-gantt.md](../implementation-plan-gantt.md): C9 and V20 progress per task, by each build PR (CLAUDE.md rule). Linking this plan from the implementation plan and [docs/README.md](../README.md) is the main session's PR.
- Every changed doc gets the last-changed header.
