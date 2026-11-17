# Demo recordings for the 1.0 features

**Last changed:** 2026-11-17 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **in progress**: DR1–DR5 and DR9–DR12 done 2026-11-17 (PRs #394,
#396–#399, #404–#406, #408); DR6 and DR7 wait for the owner. Approved (owner interview 2026-11-16: D29–D43, all
recommended options accepted). Owner interview 2026-11-17: D44–D51 (GIFs up to
25 s, retakes of N1, W3, W5 and E3, the recorder stops before the end checks). Tracked as step 10.24 in
[implementation-plan.md](../implementation-plan.md) and in the
[Gantt](../implementation-plan-gantt.md). **Start condition:** recording
work starts after C9 (the monthly allowance in the standalone app, MA13)
closes; wave 1 waits for it, waves 2 to 4 wait for their own features (§6).

This plan reviews what shipped or is being built since the demo recordings
of steps 10.22 and 10.23, and proposes for each feature: extend an existing
scene, record a new one, or record nothing. It builds on
[docs-refresh-and-demo-recordings.md](docs-refresh-and-demo-recordings.md):
its tooling, frame (1600×1000, GIFs 1:1), GIF budget (at most 20 s and
8 MB), privacy rules and decisions D1–D28 apply unchanged. Decisions here
continue at D29.

## Contents

1. [What's recorded today](#1-whats-recorded-today)
2. [New features inventory](#2-new-features-inventory)
3. [Proposal per feature](#3-proposal-per-feature)
4. [Fixtures](#4-fixtures)
5. [Docs mapping and alt text](#5-docs-mapping-and-alt-text)
6. [Order and effort](#6-order-and-effort)
7. [Owner decisions](#7-owner-decisions)

## 1. What's recorded today

23 GIFs in `docs/images/demo/` (48.7 MB), recorded 2026-11-14 on the
extension 0.12.0 and app 0.14.0 builds (PRs #260, #262).

| ID | Product, host | Shows | Embedded in |
|---|---|---|---|
| E1 | Extension, VS Code | Get Started walkthrough, Setup flags, **Fix Setting**, retention | Ext guide "First run"; ext README |
| E2 | Extension, VS Code + real Copilot (paid) | A chat, its session under Today with AI Credits, the status bar | README hero; ext guide "The side bar and status bar"; ext README |
| E3 | Extension, VS Code | Panel on a session, subagent marker and runs, turn inspector, System prompt | Ext guide "The analyzer panel" |
| E4 | Extension, VS Code | **Replay on**, Simulated columns, self-check, Compare models | Ext guide "Replaying a session" |
| E5 | Extension, VS Code | Savings tab, windows, a row's detail, Copy text, Include simulated, Not analysed <!-- codespell:ignore analysed --> | Ext guide "The savings report"; ext README |
| E6 | Extension, VS Code | Overview, Cost over time, Compare, Sessions by repository | Ext guide "Sessions view" |
| E7 | Extension, VS Code | Allowance setting, status-bar gauge, Sessions row | Ext guide "Status bar"; ext README |
| E8 | Extension, VS Code | Show Tool Audit, All sessions audit, Copy Advice Bundle | Ext guide "The analyzer panel" |
| E9 | Extension, VS Code + real Copilot (paid) | MCP setting, cost rollup view in the chat, drill-down | README "Ask your AI chat"; ext guide MCP section; ext README |
| E10 | Extension, VS Code | Learn view, compaction scenario, simulate on another model | Ext guide "Learn view" |
| W1 | App, Chromium | Learn mode, Light to Dark, scenario turns | README "Get started: standalone app"; User Guide "Learn mode" |
| W2 | App, Chromium | Claude Code session, turn inspector, Replay on another model | User Guide "Replaying a session on another model" |
| W3 | App, Chromium | Savings tab, windows, a row's detail, Open in Analyze | User Guide "The savings report" |
| M1 | Claude Desktop | Cost rollup for October, side pane, a session, a turn | README "Ask your AI chat"; User Guide "Interactive views in the chat" |
| M2–M7 | Claude Desktop | Cost change, statement, session picker, findings, replay, estimate | User Guide "Interactive views in the chat" |
| F1–F3 | Fake host (Playwright) | Drill-down chain; cost change and currency; replay and statement | Not embedded (fallbacks for the M takes, unused) |

Drivers: wdio (`demo:record`, `demo:record:copilot`), Playwright with
x11grab in headed Chromium (`demo:record -w packages/web`,
`demo:record -w packages/mcp-apps`), Claude Desktop through `xdotool` and
template matching (`demo:record:desktop`); `demo:gif` for every GIF.
Commands: [vscode-ui-automation.md](vscode-ui-automation.md) §8.

## 2. New features inventory

Since the recordings: app 0.15.0, 0.16.0, 0.16.1 and `[Unreleased]`;
extension 0.14.0 and `[Unreleased]`; merged PRs #272–#358; and the 1.0
plans still being built.

| Feature | Product | Where a user meets it | Maturity |
|---|---|---|---|
| `npx agent-cost-analyzer`: starts on 127.0.0.1:5199, opens the browser, reuses a running instance, moves to the next free port | App | Terminal, then the browser | Shipped (0.16.0) |
| `--no-open`, `--port`, `--help`, `--version` | App | Terminal | Shipped (0.16.0) |
| `agent-cost-analyzer mcp` | App | An MCP client's config (`claude mcp add …`) | Shipped (0.16.0) |
| `agent-cost-analyser` alias <!-- codespell:ignore analyser --> | App | Terminal | Shipped (0.16.1) |
| Savings view in the chat (U18), `get_savings_report` | Both | An MCP Apps host's chat | Shipped (ext 0.14.0, app 0.15.0) |
| Each session's date and saving in a savings row (V24) | Both | Savings tab detail; U18 | Shipped (app 0.16.0); ext `[Unreleased]` |
| Session titles in savings rows (V25) | Both | Savings tab detail (not U18) | Shipped (app 0.16.0); ext `[Unreleased]` |
| Per-tool tokens for unused tools, "and N more (about X)" (V26, R23) | Both | Savings tab detail; U18 | Shipped (app 0.16.0); R23 `[Unreleased]` |
| pi unused tools; "Not priced" rows for any unpriced model (V27, D33); cache-break rows leave unpriced sessions out (R24) | App (D33 also ext) | Savings tab | `[Unreleased]` |
| **Added to chat** after **Analyse** and **Ask about this session** (C6) <!-- codespell:ignore analyse --> | Both | U5 session picker, U2 | Shipped (ext 0.14.0, app 0.15.0) |
| "your prices" label (C14) | App, chat views | Figures priced from a user price version | Shipped (0.15.0) |
| Learn Vendors tab, one block per model | Both | Learn | Shipped |
| pi system prompt as sent; "omitted from later context" markers | App | pi sessions in Analyze | Shipped (0.15.0) |
| Replay leaves helper requests out and lists them in coverage | Both | Replay coverage line | Shipped |
| Data and accessibility fixes (helper-named Copilot sessions, untitled Agent Host titles, VS Code `User` folder, statement cap, Overview axe) | Both | Nothing new on screen | Shipped |
| Monthly allowance in the app (MA13, C9): header gauge, details and settings dialogs | App | Analyze mode header | Building: MS7 UI merged (#358); MS8, MS10–MS13 open |
| `get_monthly_allowance` | App MCP | Chat, text answer (no view) | Built (#356), `[Unreleased]` |
| Extension third-party notices | Ext | A file in the .vsix | `[Unreleased]` |
| Subagent tool calls in the audit (10.20, C10) | Both | Tool audit tab, Explanation block, Tools cell, findings, U4 | Building: ST0b–ST5 done; ST6–ST15 open |
| Claude Code subagent usage (C15) | App | Turns table marker, Priced cost KPI tile, Explanation block, U1, replay coverage | Building: CS0b–CS6 done; CS7–CS16 open |

## 3. Proposal per feature

### 3.1 Summary

| Feature | Proposal | Recording | When | Paid takes |
|---|---|---|---|---|
| npx quick start, port reuse | New recording | **N1** | Now; final take from the 1.0 build (D29) | None |
| `--no-open`, `--port`, alias, `mcp` | No recording: README and npm page text; the M scenes show the server's views | — | — | — |
| Savings dates, savings and titles per session (V24, V25) | Retake, extended | **E5**, **W3** | Now (both stale) | None |
| Per-tool list, "and N more" (V26, R23) | New beat in the same retakes | E5, W3 | Now | None |
| pi and unpriced "Not priced" rows (V27, D33), R24 | New beat in W3 | W3 | Now | None |
| Savings view in the chat (U18) | New recordings | **M8**, **F4** | Now | M8: Claude plan messages |
| **Added to chat** (C6) | Retake (M4 shows the old label) | **M4** | Now, with M8 | Claude plan messages |
| Monthly allowance in the app (MA13) | New recording | **W4** | After MS8 and MS13 | None |
| `get_monthly_allowance` | No recording: no view, a one-line text answer | — | — | — |
| Extension third-party notices | No recording: nothing on screen | — | — | — |
| Subagent tool calls in the audit (10.20) | Extend E8, retake E3, new W5 | **E8**, **E3**, **W5** | After ST12 and ST13 | None |
| Claude Code subagents (C15) | Extend W2; check M1 and F1 | **W2** (M1, F1 if changed) | After CS13 | M1 only if retaken |
| "your prices", Learn Vendors tab, pi prompt and markers, helper-request coverage, data fixes | No recording: no scene opens them, or nothing new to watch; text and harness stills | — | — | — |

No proposed recording needs a real-Copilot take or AI Credits. E2 and E9
stay as they are. The Claude Desktop takes (M8, M4, and M1 only if C15
changes its turn) spend a few messages each on the owner's Claude plan;
with the 10.23 driver in place, plan on 2–4 takes per scene.

New ID: **N** for the npm package's terminal recordings. E11 stays
reserved (not recorded, D3).

### 3.2 New recordings

**N1: npx quick start** (terminal and browser)

| # | Beat | About |
|---|---|---|
| 1 | Terminal A, prompt `$`: `npx agent-cost-analyzer` typed at demo pace, Enter | 3 s |
| 2 | The line `Agent Cost Analyzer <version> on http://127.0.0.1:5199 (Ctrl+C to stop)`; the browser opens on the app in Learn mode | 4 s |
| 3 | **Analyze**, Source → Claude Code: the made-up sessions are listed | 5 s |
| 4 | Terminal B: the same command prints `Agent Cost Analyzer is already running on http://127.0.0.1:5199 (opening it)`; the browser comes to the front | 5 s |

- Length: 17–19 s.
- Driver (new route, D30, D31): `demo:record:terminal` next to the Desktop
  driver in `packages/vscode-extension/scripts/demo/`. Xvfb 1600×1000 with
  no window manager, so terminals have no title bar. `xterm` windows
  are placed by the existing `xdotool` adapter, and keystrokes come from
  `prompt-keystrokes`. Waits poll `GET /api/health`, plus a template match
  for the terminal line. Recording uses the Phase 1 recorder and
  `demo:gif`.
- The CLI's own `xdg-open` call goes to a wrapper first on the demo `PATH`.
  It opens the URL in a Playwright-launched Chromium with a throwaway
  profile, a fixed clock and kiosk mode. That keeps the real open path and
  lets the privacy probe read the page.
- The terminal has no DOM, so the owner reviews every frame, as for
  Desktop.

**W4: monthly allowance in the app** (Playwright, dark, as W1–W3)

| # | Beat | About |
|---|---|---|
| 1 | Analyze mode; the header shows the muted **Set monthly allowance** | 2 s |
| 2 | Click: the settings dialog; type an allowance; **Save** | 5 s |
| 3 | The gauge: "at least <used> of <allowance> AI Credits · near limit", meter with its open end | 3 s |
| 4 | Click the gauge: the details dialog with the period and zone, coverage, the Copilot Chat and Agent Host split, **Not counted** | 5 s |
| 5 | Escape; focus returns to the gauge | 1 s |

- Length: 16–18 s. Scene `packages/web/e2e/demo/w4-allowance.demo.ts`.
- Partial coverage ("at least") is the default state, since that
  honesty rule is the point. A fully known near-limit take needs only a
  fixture change.
- Waits for MS8 (fixture seeds) and MS13 (the review may change copy).

**M8: savings in the chat** (Claude Desktop)

Prompt (ASCII, names a period inside the fixture): "What could I have
saved on my coding agents in October?"

| # | Beat | About |
|---|---|---|
| 1 | Take starts 1 s before the view arrives (D17, D19); open the side pane (D18) | 3 s |
| 2 | Savings view: ranked rows per currency, Simulated note, Not analysed <!-- codespell:ignore analysed --> | 4 s |
| 3 | Open the unused-tools row in place: action text, per-tool list, sessions with date and saving | 5 s |
| 4 | **Open cost** on a session: U1 in place | 4 s |
| 5 | **Back**: focus returns to the session button | 2 s |

- At most 20 s. New scene data in `desktop-scenes.mts`. New templates
  (savings kicker, the row, Open cost, Back) are cut from a live frame,
  since fake-host crops of buttons scored too low live (step 2.3).
  Pre-approve `get_savings_report` and `get_session_cost` in the profile
  (D16).

**F4: savings view close-up** (fake host, free)

Beats: the view loads, a row opens in place, then its per-tool list and
sessions, **Open replay** on a session (U12), and **Back**. 14–16 s.
Scene: `packages/mcp-apps/e2e/demo/f4-savings.demo.ts`. Like F1–F3, it
is cropped to the view and never labeled "Claude Desktop". It is the
extension guide's GIF and M8's fallback.

**W5: tool audit with subagent calls** (Playwright, after 10.20)

| # | Beat | About |
|---|---|---|
| 1 | Analyze, Source VS Code Copilot Chat, the fixture's subagent session | 3 s |
| 2 | **Tool audit** tab: KPI sub-line "incl. N calls from M subagent runs", Calls by agent split | 4 s |
| 3 | Agent filter → **Subagents**: Agent column; Subagent runs table with an unread run and its reason | 6 s |
| 4 | All sessions audit: main and subagent totals, the subagent calls column | 5 s |

- 18–20 s.
- The User Guide's "Auditing tool calls" has no recording today.

### 3.3 Retakes and extended scenes

| Scene | Why | Change |
|---|---|---|
| **E5** (now) | Stale: the detail lists session ids only, with no date, saving or title; unused-tools rows have no tool list | New beats: Analyze → Savings; 90 → 30 days; top row: sessions with title, id, date, saving; unused-tools row: per-tool list, "and N more (about X)"; Include simulated; Not analysed. Dropped to stay under 20 s: the 7-day step and Copy text (D37) <!-- codespell:ignore analysed --> |
| **W3** (now) | Stale: same as E5; pi rows under Not analysed are now "Not priced" rows; the header reads v0.14.0; text names "fixture-main-model" <!-- codespell:ignore analysed --> | New beats: Dashboard → Savings; 90 → 30 days; top row: sessions with title, id, date, saving; unused-tools row: per-tool list; scroll to the pi row ranked last, "Not priced" with its reason; Open in Analyze. Dropped: the 7-day step (D37). Realistic model names (D36) |
| **M4** (now) | Stale: recorded before PR #284, so the button keeps its old label after the click | Same prompt and beats; the frame after the click shows **Added to chat** and "Press send in the chat to run it." Recorded in the M8 session (D35) |
| **E8** (after 10.20) | Stale once ST12 lands: the audit gains the Agent filter, Agent column, runs table and split | Insert after Show Tool Audit: Agent → **Subagents** (Agent column, runs table with an unread run); the All sessions audit shows the split. E8 is 14.5 s today; if the take exceeds 20 s, the Advice Bundle dialog is shown but not previewed |
| **E3** (after 10.20) | "Subagent runs this turn" gains calls and failed per run; the Tools cell counts runs | Same beats, retaken |
| **W2** (after C15) | Stale once CS13 lands: every Claude Code session gains the Priced cost KPI tile (CS2 decision 1); turns with runs get the Turn-cell marker | Session with runs: hover the Turn-cell marker (tokens and priced cost from N runs); Explanation's Subagent runs block; replay coverage lists the runs it left out. Dropped: "Close the summary". At most 20 s |
| **M1, F1** (after C15) | U1 shows Tokens, Cache read, Priced cost and AI Credits n/a for a Claude Code turn | Check the drilled turn's provider on the C15 build; retake only if U1 changed (M1 is a paid take) |
| All free scenes (1.0 build) | One look and one header version across GIFs | Re-record E1, E3–E8, E10, W1–W5, F1–F4 in one run from the release build (D41) |

Not stale, no action: E1, E2, E4, E6, E7 (MS2 kept the extension's strings
byte-identical), E9, E10 and W1 (neither opens the Vendors tab), M2, M3,
M5–M7, F2, F3.

## 4. Fixtures

Rules, as in 10.22 and 10.23: made-up data only, never the owner's logs.
Titles are placeholders and prompts are ASCII. The shared e2e fixture's
asserted figures don't move: additions go in the scratch repository (as
SR13 did) or behind a demo option, and a spec that has to change changes
on purpose. Fixture code is written test first (as `demo-fixture.test.ts`).

| Fixture home | Scenes | What to add |
|---|---|---|
| Extension demo fixture (`scripts/ui-automation/demo-fixture.mts`, `ready`) | E5; E3, E8 after ST12 | E5: an unused-tools row whose MCP server group has at least six tools, each loaded in every session of the row (so "(about X)" shows, R23), with seeded titles, inside the 30-day window. E3/E8: child-log tool calls on the subagent session (ok, failed, one unread run with its reason), mirroring ST12's `ui-fixture` additions |
| Web e2e fixture home (`packages/web/e2e/support/fixture-home.mts`, `FIXTURE_NOW` 2026-11-06) | N1, W2–W5, F4; M4, M8 through the Desktop home | W3/F4/M8: a Copilot classic session with an unused MCP group of at least six tools. Also a pi session on a local model (no price) whose file declares tools, some never run, dated in the window (one of the generated pi fixtures, re-dated). W4: MS8's seeds (VS Code sessions from 2026-11-01 to 11-06, one without cost data, one Agent Host session), and a demo start with no allowance set. W5: ST12's child-log calls. W2: a Claude Code `subagents/` transcript linked to a turn (the shape of CS3's linked run) |
| Demo variant with realistic model names | N1, W2–W5, F4 | D21's rename (`DEMO_COPILOT_MODELS`, today used by `createDemoDesktopHome`) for the web and fake-host demos too, so no frame reads "fixture-…" (D36) |
| Desktop demo home (`createDemoDesktopHome`) | M4, M8 (M1 after C15) | Inherits the web additions. Recommended: register the packaged server (`npx -y --prefer-offline agent-cost-analyzer mcp`, from N1's tarball) in the Desktop profile, so the takes run the 1.0 server; invisible in the GIF |
| N1 terminal | N1 | `HOME` = a demo-variant fixture home, `AGENT_COST_ANALYZER_NOW` = `FIXTURE_NOW`, `PS1='$ '`, `npm_config_update_notifier=false`, `npm_config_fund=false`; the package installed into an empty demo folder from the tarball (D29); port 5199 free; `DEMO_FORBIDDEN` set as usual |

**As built (DR1, wave 1).**

- Extension demo fixture (`demo-fixture.mts`): `acmedocs` has six tools, loaded in every session of the
  row (the sessions that carry a tool list now also carry the system prompt file, since the inventory is
  read only from a request naming both). `fixture.savings.unusedToolsRow` names the server and its tool
  count.
- Web demo home: `createDemoFixtureHome` in `packages/web/e2e/support/demo-fixture-home.mts` wraps the
  shared `createFixtureHome`, which is untouched, so no asserted figure moves. It adds two Copilot Chat
  sessions in the scratch repository ("Draft the release notes" on 2026-11-03, "Check the API docs links"
  on 2026-10-29) with the six-tool `acmedocs` group and billed AI Credits, and one pi session on a local
  model ("Tidy the notes folder", 2026-10-31; a re-dated `pi-linear`, no price, `write` never run). It
  then applies `DEMO_COPILOT_MODELS`. The pi session adds an "unexplained cache break" row (the 310 s idle
  gap of the generated file) beside the "Not priced" `write` row.
- Switches: the web `test` fixture's `demo` option (`test.use({ demo: true })`), the fake host's `demoHome`
  option, and `createDemoDesktopHome`, which now calls `createDemoFixtureHome`.
- Not as in the table: a pi session's list id is a hash of its file path, so scenes click it by title, not
  by id.

**As built (DR9).** W4 needed no new fixture code. `createDemoFixtureHome` already passes its options to
`createFixtureHome`, so `test.use({ demo: true, allowanceSessions: true })` gives MS8's seeds (Copilot sessions
on 2026-11-02, 11-03 and 11-05, one without cost data, and the Agent Host sessions) on the demo home, and
the home has no allowance until the scene saves one. The demo home's release-notes session (2026-11-03)
adds to the month, so the gauge reads "at least 32.46 of 36 AI Credits" (8 of 9 sessions known); the
scene's 36 is 90% of the allowance. `demo-fixture-home.test.ts` pins the seeds. The demo home retitles the shared seeds' "Fixture session" rows (`retitleFixtureSessions`), and the web scenes share one privacy probe (`e2e/demo/support/privacy-probe.ts`) that also forbids the word "fixture".

**As built (DR11, W5).**

- No new fixture sessions: ST12's `auditSessions` (the shared home's "Subagent audit session": 2 main
  calls, a read `searchSubagent` run of 3 calls with 1 failed, and an unread run with its reason) already
  has the child-log calls. The scene sets `test.use({ demo: true, auditSessions: true })`, and
  `createDemoFixtureHome` passes the option through, so only W5 has them and W3/F4 lists stay as they are.
  `demo-fixture-home.test.ts` covers it (no "fixture-" text with the sessions on, absent by default).
- Scene: `packages/web/e2e/demo/w5-tool-audit.demo.ts`, 19 s draft GIF.

**As built (DR10).** The extension demo fixture's subagent session is `readSession` ("Add pagination to
the orders API"), not the Copilot CLI audit session, which has no subagent runs. Its child logs now hold
8 calls in 3 read runs (turn 1 Explore: 3 calls, 1 failed; turn 4 Plan: 2; turn 7 Explore: 3) and one
`explore_subagent` call with no log (turn 7, unread, with its reason). The unread run adds no AI Credits
and the session cost stays known, so E3/E4 figures do not move. The runs table labels that unread run
"searchSubagent": the product maps `explore_subagent` to it by design (`labelOfCallName`, plan §14.1).
E8 starts on `readSession` (the CLI session's audit beat is gone as redundant) and keeps the Advice Bundle
preview; its take is 20.1 s. E3 drops the turn inspector and "back to the session" beats: the old scene
already ran about 35 s on this setup (the committed GIF was a trimmed cut that ended on the System prompt
tab), and with them the content is about 22 s. Its new take is 25 s, of which the last 5 s are the
end-state checks and probe, cut by the trim.

**As built (DR12).**

- Web demo home: `claudeSubagentSession` in `demo-fixture-home.mts` adds a two-turn Claude Code session in
  portal-api (2026-11-02): turn two starts one `general-purpose` run (the session opens on turn one, which has none) on `claude-haiku-5-5` through an Agent
  call (`subagents/agent-<id>.jsonl` plus `.meta.json`, CS3's linked shape), the main agent is on
  `claude-sonnet-5-5`, so the marker and the Explanation show priced figures. The shared home is untouched.
- The run is 120 s into turn two and the cache numbers follow the usual chain (each read is the last read plus its write and input), so the replay self-check passes.
- W2 now runs on the demo home with the privacy probe after every beat and asserts each beat's end state.
  Beats: glide to the Turn-cell marker, open turn two for the Explanation's Subagent runs block, Replay on another model, the
  replay summary with "1 subagent run not replayed". "Close the summary" is dropped.
- The marker's words are a native `title` tooltip, which the x11grab take does not show: the beat shows the
  pointer on the marker and the same words are in the Explanation beside it.
- M1/F1 check: F1 opens "Fix the bug", a Copilot Chat turn, so it is unchanged. M1's top session is the
  Claude Code session "scratch" (4 turns, no runs), so its turn view (U1) changed with C15 and M1 needs a
  retake.

## 5. Docs mapping and alt text

| Recording | Doc and section | Alt text draft |
|---|---|---|
| N1 | README "Get started: Agent Cost Analyzer (standalone app)", after the `npx` block (D32); `packages/cli/README.md` "Run it", raw URL (D33); User Guide "Getting started" | A terminal runs npx agent-cost-analyzer: the app starts on 127.0.0.1:5199 and opens in the browser, Analyze mode lists sample sessions, and a second run opens the running app instead of starting another |
| W4 | User Guide "Monthly allowance" (new section, MS12) | Setting a monthly AI Credits allowance in the standalone app's header: the gauge shows at least the month's AI Credits against the allowance, near limit, and its details show the period, coverage and the split between Copilot Chat and Agent Host |
| M8 | User Guide "Interactive views in the chat", after Estimate; linked from "The savings report" ("In the chat"); `packages/cli/README.md` stays on M1 | Claude Desktop answering "What could I have saved on my coding agents in October?" with the savings view in the side pane: a row opened with its tools and sessions, each with its date and saving, then one session's cost and Back |
| F4 | Extension guide "Interactive views in Copilot Chat", as the view in a test host | The savings view on its own in a test host: a ranked row opens in place with its tools and sessions, one session's replay opens, then Back |
| E5 | Extension guide "The savings report"; extension README savings bullet | The Savings tab: a row's sessions with title, date and saving, an unused-tools row listing its tools with estimated tokens, Include simulated and the Not analysed list <!-- codespell:ignore analysed --> |
| W3 | User Guide "The savings report" | The Savings view: a row's sessions with title, date and saving, an unused-tools row listing its tools, a pi row marked Not priced, and Open in Analyze |
| M4 | User Guide "Interactive views in the chat" | A list of Claude Code sessions in Claude Desktop; the button on one reads Added to chat, the request is sent and Claude answers |
| E8 | Extension guide "The analyzer panel" | Show Tool Audit: calls split between the main agent and subagent runs, the Subagents filter with the Agent column and the runs table, then the All sessions audit |
| E3 | Unchanged | Unchanged, unless the retake shows more than the current text says |
| W5 | User Guide "Auditing tool calls" | The Tool audit tab on a Copilot session: calls from subagent runs counted apart from the main agent's, the Subagents filter, and a run that couldn't be read with its reason |
| W2 | User Guide "Replaying a session on another model" | A Claude Code session in Analyze mode: a turn with subagent runs, their tokens and priced cost in the Explanation panel, then Replay on another model with Simulated columns and the runs it left out |

Text fixes in the same docs task:

- User Guide "Interactive views in the chat", "Getting the views", still
  says `npm run build` and `scripts/mcp-server.sh`. With the npm package
  it should give `npx -y --prefer-offline agent-cost-analyzer mcp` first.
- Every changed doc gets its last-changed header. `npm test` must pass,
  since unit tests read the extension README and guide.

## 6. Order and effort

Rules: Claude subagents only (no local model in this repo); TDD for pure
modules; wdio, Playwright and `xdotool` glue as the 10.22 exception, with
each scene asserting its end state. The main session records the final
takes in one sequential run, outside 00:00–01:15 local time. The owner
reviews every GIF.

| ID | Task | Complexity | Model | Depends on | Owner step |
|---|---|---|---|---|---|
| **Wave 1: shipped features, start after C9 (MA13) closes** | | | | | |
| DR1 | Fixture additions (§4) for E5, W3, F4, M8; demo variant with realistic names | medium | Sonnet | D36 | — |
| DR2 | E5 scene, new beat list | low | Sonnet | DR1, D37 | — |
| DR3 | W3 scene, new beat list | low | Sonnet | DR1, D37 | — |
| DR4 | Terminal route: pure parts first (beat list, window layout, health wait), `xdg-open` wrapper to Playwright Chromium, `demo:record:terminal`; N1 scene; draft take | medium | Sonnet | D29–D31 | Install `xterm` |
| DR5 | F4 fake-host scene | low | Sonnet | DR1 | — |
| DR6 | M8 scene data and live templates; M4 unchanged; live takes of M8 and M4 | medium | Sonnet, then main session | DR1, D34, D35 | Claude plan messages; signed-in demo profile |
| DR7 | Owner review of wave 1: every frame of N1, M4 and M8 (no DOM probe) | — | Owner | DR2–DR6 | Review |
| DR8 | Docs (§5): embeds, alt text, the npm page's raw URLs, "Getting the views", [vscode-ui-automation.md](vscode-ui-automation.md) §8 (terminal route); `npm test` | low | Haiku | DR7, D32, D33 | — |
| **Wave 2: after MA13's MS8 and MS13** | | | | | |
| DR9 | W4 scene and its no-allowance start | low | Sonnet | MS8, MS13 | Review |
| **Wave 3: after 10.20's ST12 and ST13 (ideally ST15 sign-off)** | | | | | |
| DR10 | E8 extended, E3 retaken; demo fixture child-log calls | medium | Sonnet | ST12, D39 | Review |
| DR11 | W5 scene | low | Sonnet | ST12, DR10 | Review |
| **Wave 4: after C15's CS13** | | | | | |
| DR12 | W2 extended; check M1's and F1's turn, retake if U1 changed | medium | Sonnet (+ main session for M1) | CS13, D40 | M1 take if needed |
| **Wave 5: the 1.0 release build** | | | | | |
| DR13 | Sweep: every free scene in one run; N1 final take from the 1.0.0 tarball; docs for waves 2–5 | low | Main session + Haiku (docs) | DR1–DR12, version bump, D41 | Review |
| DR14 | Close: this plan's status and session log (the Gantt by the coordinator) | low | Haiku | DR13 | — |

Exit: every recording in §3 re-records with one command plus `demo:gif`,
has an owner-approved GIF within budget, and is embedded with alt text
where §5 says. Links resolve and `npm test` passes.

Size: five new GIFs add about 12 MB (to about 60 MB). Retakes overwrite
files but add about 15 MB to history (D42).

## 7. Owner decisions

Interview 2026-11-16: the owner accepted the recommended option in every
row (D29–D43). Interview 2026-11-17: D44–D51; where the owner chose other than
the recommendation, the row says so. The recommended option is in bold; the alternatives the owner
did not choose follow it. D30's owner step: the owner installs `xterm` with
apt. The last column names the tasks (§6) each answer feeds.

| # | Question | Answer (options as proposed) | Task |
|---|---|---|---|
| D29 | Which build does N1 run? | Accepted (owner, 2026-11-16): **the tarball of the 1.0.0 bump** (`npm pack` of `packages/cli`) installed in an empty demo folder. `npx agent-cost-analyzer` then runs it without the registry and the start line reads 1.0.0; a draft take on today's version comes first. Alternatives: the published 1.0.0 after release, which shows npx's install prompt but reaches the npm page only with the next publish; or today's version, left as is | DR4, DR13 |
| D30 | Which terminal? | Accepted (owner, 2026-11-16): **`xterm`**, which the owner installs with apt (no terminal emulator is installed); large mono font, no title bar under Xvfb. Alternatives: VS Code's integrated terminal through wdio (VS Code on screen in a story about not needing it); a browser terminal (xterm.js and a pty, more code) | DR4 |
| D31 | How does the browser open in N1? | Accepted (owner, 2026-11-16): **the CLI opens it**, through an `xdg-open` wrapper first on the demo `PATH` that starts a throwaway Playwright Chromium. Alternative: `--no-open` with the driver opening Chromium, which shows the flag but hides the automatic open | DR4 |
| D32 | README GIFs | Accepted (owner, 2026-11-16): **N1 replaces W1** under "Get started: standalone app"; W1 stays in the User Guide's "Learn mode", and the README keeps four GIFs. Alternative: N1 beside W1 (five GIFs) | DR8 |
| D33 | Media on the npm page (`packages/cli/README.md`) | Accepted (owner, 2026-11-16): **N1 under "Run it" and M1 under "Ask your AI chat"**, absolute raw URLs to `main` (as D4 for the Marketplace), so retakes update the page without a publish. Alternatives: N1 only; text only | DR8 |
| D34 | The savings view in a chat (U18) | Accepted (owner, 2026-11-16): **M8 in Claude Desktop plus F4 in the fake host** (free; the extension guide's GIF and the fallback). Alternatives: F4 only; also a real-Copilot take, which costs AI Credits while the G4 suite already checks U18 (not recommended) | DR5, DR6 |
| D35 | M4 shows the old button label | Accepted (owner, 2026-11-16): **retake M4 in the M8 session.** Alternative: keep it and note the label in the caption | DR6 |
| D36 | Model names in the web, terminal and fake-host demos | Accepted (owner, 2026-11-16): **D21's realistic names** through a demo variant, so no frame reads "fixture-…" (W3 does today). Alternative: keep the shared fixture's names | DR1 |
| D37 | E5 and W3 get longer | Accepted (owner, 2026-11-16): **drop beats** (E5: the 7-day step and Copy text; W3: the 7-day step) to keep one GIF each. Alternative: two GIFs each (rows, then a row's sessions and tools) | DR2, DR3 |
| D38 | `get_monthly_allowance` | Accepted (owner, 2026-11-16): **no recording**: no view and a one-line answer; the User Guide's MCP table covers it. Alternative: an M9 text answer in Desktop | — |
| D39 | 10.20 recordings | Accepted (owner, 2026-11-16): **extend E8, retake E3, new W5** for the User Guide. Alternative: E8 only, with a still in the User Guide | DR10, DR11 |
| D40 | C15 recordings | Accepted (owner, 2026-11-16): **extend W2** (its story is a Claude Code session) and retake M1 or F1 only if U1 changed. Alternative: a separate W6 for subagents, with W2 retaken unchanged | DR12 |
| D41 | A sweep on the 1.0 build | Accepted (owner, 2026-11-16): **yes.** Re-record every free scene in one run (free, about an hour), so look and header version match; paid scenes only where stale. Alternative: retake only the scenes named in §3.3 | DR13 |
| D42 | Media budget | Accepted (owner, 2026-11-16): **accept about 60 MB** in `docs/images/demo/` and about 15 MB more history from retakes (as D28). Alternative: hold today's size by dropping the unembedded F1–F3 and publishing the largest scenes as MP4 only | DR8 |
| D43 | Tracking | Accepted (owner, 2026-11-16): **a numbered plan step** ("Demo recordings for 1.0") with a Gantt bar, linked by the coordinator (as D7). Alternative: untracked docs work | DR1 |
| D44 | DR6's live takes | Accepted (owner, 2026-11-17): **record M8, the M4 retake and the M1 retake** in one sequential Claude Desktop session once the owner's signed-in demo profile is ready (M1's Claude Code turn view changed with C15, DR12). Alternatives: M8 and M4 only; F4 in place of M8; DR6 after 1.0 | DR6 |
| D45 | W3's opened row | Accepted (owner, 2026-11-17): **the top row on screen** (the `acmedocs` unused-tools row), as §3.3's beats say; the draft opened "Model switched". Alternative: keep the draft | DR3 retake |
| D46 | W5's Subagents view | Owner, 2026-11-17: **show all 3 subagent calls** (the Succeeded chip, as E8 does), not the failed-only default. Recommended was the failed-only default | DR11 retake |
| D47 | N1's draft issues | Accepted (owner, 2026-11-17): **fix all three before the final take**: a smaller terminal beside the browser instead of a full-frame one, the browser ends in front on the second run, no Source dropdown flash | DR4 follow-up, DR13 |
| D48 | GIF length | Owner, 2026-11-17: **GIFs up to 25 s** (was 20 s, the 10.22 rule); the 8 MB size limit stays. E3 keeps all eight beats (turn inspector and back to the session included). Proposed were dropping E3's turn inspector beats, two GIFs, or dropping the editor beat | all scenes; E3 retake |
| D49 | W2's marker tooltip | Owner, 2026-11-17: **a custom, accessible tooltip on the Turn-cell marker after 1.0**, then a W2 retake; the native `title` tooltip doesn't show in an x11grab take, and the Explanation panel shows the same figures. Recommended was to accept it as is | after 1.0 |
| D50 | The recorder's tail | Accepted (owner, 2026-11-17): **stop the recording before the end-state checks and privacy probe** in every demo driver, before the final takes; today they add about 5 s of still frames that a trim cuts | DR13 |
| D51 | Draft review | Accepted (owner, 2026-11-17): **drafts copied to a folder in the owner's home** with an index of what each shows and what to check | DR7 |
