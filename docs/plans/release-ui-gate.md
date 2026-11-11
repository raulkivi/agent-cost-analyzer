# Automated pre-release UI gate (step 10.17)

**Last changed:** 2026-11-11 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **done 2026-11-11: G0 (#203), G1 (#202), G2 (#207), G3 (#208, #210), G4 (#211), G5 (#205, #206), G6 (#204) and G7 (with the D11 chart fixes) all built; G7's PR is the last to merge.** Owner rule, 2026-11-11: every UI check
before a release is automated. VS Code and Copilot checks use wdio
(`wdio-vscode-service`, [vscode-ui-automation.md](vscode-ui-automation.md));
web-only checks use Playwright (or the integrated Chrome for exploratory
runs). No hand checklist gates a release. Builds on step 10.16 and the
standalone app's `web-e2e` suite (Phase 15 step 15.9).

Progress: G5 is built (2026-11-11, `packages/mcp-apps/e2e/`, CI job
`mcp-apps-e2e`, and the same steps in `release-app.yml` and
`release-extension.yml`). Every row of A24 §2 and A16 §2 that a fake host can
check is a spec named after its row, run in Claude light and dark with axe
in the frame at each stop ([README](../../packages/mcp-apps/e2e/README.md)
has the row table). What a fake host cannot check:

- A24 2.10: the fake host has no permission prompt, so the spec proves only
  that a drill-down is one plain `tools/call`; whether Claude Desktop asks
  stays outside the gate (R4).
- A24 2.6: `compare_costs` never returns an empty project result from the
  real server (two ids are required, an unknown id gives a zero-turn row),
  so the "No projects here" title is covered by a component test, and the
  spec asserts what the server answers.
- A24 2.3 for U11: the fixture has no priced AI Credits turn, so U11 shows
  one currency block; a view-model test covers two.
- A24 2.9: U9's fullscreen layout is task A31; the spec asserts that U9
  renders in fullscreen.

The first run found one view bug: with two currencies, U9's Currency control
listed USD first and started on USD (§9.1 answer 5 says AI Credits first).
Fixed test-first in `cost-series.ts`.

## 1. Owner decisions (2026-11-11)

| # | Decision |
|---|---|
| D1 | The real-Copilot wdio suite runs on the owner's machine before tagging, never in CI (no Copilot credential in GitHub). A passing run is recorded against the commit; the release workflow refuses a tag without one. |
| D2 | §3 of the manual checks (Remote-SSH, WSL, Dev Container) leaves the release gate; it stays an occasional check. |
| D3 | The Claude Desktop hand checks (MCP Apps A16 §2, A24 §2) are replaced by Playwright over the real `views.html` in a fake MCP Apps host with Claude's recorded theme sets. |
| D4 | The `extension-ui` CI job is required on every PR (`continue-on-error` removed) and also runs in `release-extension.yml`. This closes 10.16's T15 and Q2. |
| D5 | The analyzer's `aiCreditsAnalyzer.internal.*` test hooks register in `ExtensionMode.Test` as before, and in `ExtensionMode.Development` only when the environment variable `AICA_TEST_HOOKS=1` is set (the real-Copilot suite sets it for the VS Code it launches). A plain F5 Development host registers none; Production none. |
| D6 | The real-Copilot suite approves only the AI Credits Analyzer's MCP tools, not every tool: no global auto approve. The run's profile copy also has no terminal and no other MCP server (discovery from other apps' configs off). |
| D7 | A Copilot chat in an empty window (no folder open) must be visible to the analyzer. Fixed in a separate step, not in 10.17: step 10.18, done 2026-11-11 (#209). |
| D8 | A real-Copilot release run costing up to about 2 AI Credits is acceptable; keep the prompts minimal. |
| D9 | Any skip of a required test blocks a release (confirms G2's tightened rule). |
| D10 | The Increment 2 release (extension 0.6.0, app 0.11.0) waits for G4 and the empty-window fix (D7). *Superseded for G7 by D11.* |
| D11 | The chart findings G7's judge found are fixed, not pinned: G7 merges with no exceptions, and the fixes ship in the Increment 2 release, which therefore also waits for G7 (`npm run test:ui` runs in the required `extension` job and in `release-extension.yml`, so findings would block both). |
| D12 | **Proposed (2026-11-11), for the owner to confirm:** hard cap 3 AI Credits per real-Copilot run. `COPILOT_E2E_MAX_AI_CREDITS` (default 3; `0` sends no chat) is checked before every chat against what the run's chats have cost so far; a refused chat skips with "budget exceeded", and the gate refuses the skip (D9). Checked between chats, so a run can pass the cap by at most one chat: about 0.6 AI Credits on the right model, but 16 on Sonnet 5.5 (VS Code 1.146, R5). |

## 2. What gates each release today, and what replaces it

| Check today | Replacement | Task |
|---|---|---|
| Extension manual checks 1.2, 1.3, 1.5-1.7, 1.9-1.13, 2.1, 2.2, 2.5, 2.6 | Already in `extension-ui`; made required and run in the release workflow | G1 |
| 1.1 "doesn't reopen after a reload" | `WalkthroughOffer` unit tests plus `first-run.e2e.ts`; accepted as automated | G7 |
| 1.8 "charts still distinguishable" | Non-text contrast (≥ 3:1) between adjacent chart marks and against the ground, in the probe and judge, in both High Contrast themes | G7 |
| 1.4, 2.3, 2.4 (real chat), 2.1's *Configure Tools* wording, 1.14 on a real repository | The opt-in real-Copilot suite (`test:ui:vscode:copilot`), first run end to end, then gated by D1 | G2, G3, G7 |
| App: usage scenarios S1-S10, R1 | `web-e2e`, required in CI; added to `release-app.yml` | G1 |
| MCP Apps in VS Code Copilot Chat (A16 §1, A24 §1): views render inline, drill-downs, Back focus, themes, 360/600 px, footer | wdio specs in the real-Copilot suite: tool call in agent mode, enter the view's frame, assert | G4 |
| MCP Apps in Claude Desktop (A16 §2, A24 §2) and every view state | Playwright: real `views.html` in a fake host built on ext-apps `AppBridge`, tool results from the real server over stdio on the `web-e2e` fixture home, Claude and VS Code theme sets, axe, probe and judge | G5 |
| A24 1.7a: the owner records VS Code's High Contrast colour sets | A wdio spec reads every `--vscode-*` variable in the webview for Dark and Light High Contrast and writes the sets `host-sets.ts` reads | G6 |
| A24 §3: Claude Code CLI answers stay text | Server test: a client without the UI capability gets the same text and no view reference | G6 |
| §3 remote, §4 screenshots, README review | Out of the gate (D2); screenshots and README stay owner reviews of docs, not UI tests | — |

## 3. Tasks

Every code task starts with a failing test (architecture.md §11.4). YAML,
wdio config and specs that only a real VS Code or browser run can test are
TDD exceptions, recorded in the PR as in step 10.9. No local model in this
repo.

| # | Task | Cx | Model | Depends | Exit |
|---|---|---|---|---|---|
| G0 | Docs: the rule in architecture.md §11, CLAUDE.md's repo rules, manual-checks doc reframed as "what the suites cover", mcp-apps.md A24/A33 as automated tasks, vscode-ui-automation.md T15/Q2 closed by D4 | low | Haiku | — | Docs say the same thing; no CHANGELOG entry |
| G1 | CI: drop `continue-on-error` from `extension-ui`; `release-extension.yml` runs `test:ui:vscode` under xvfb with the cached download; `release-app.yml` builds web and runs `test:e2e`. Owner: mark `extension-ui` and `web-e2e` required in branch protection. **Done 2026-11-11:** ruleset 27004539 on `main` (created on the owner's go) requires `extension-ui`, `web-e2e`, `mcp-apps-e2e`, `test`, `extension`, `scan`, `Analyze (actions)`, `Analyze (javascript-typescript)` and `CodeQL`; branches needn't be up to date; repository admins may bypass. Scorecard (`analysis`) is left out: it never runs on a PR. `claude-review` stays advisory | low | Haiku | — | Both release workflows fail on a red suite; green on a dry-run tag in a fork or a `workflow_dispatch` run |
| G2 | Release evidence for D1: the real-Copilot suite writes its result (commit, VS Code version, tests passed, skipped with reasons, AI Credits spent) as a git note under `refs/notes/release-ui`; a release check reads the note for the tagged commit and refuses a missing, failed or skipped result (tightened from "skipped without reason", see below) | high | Opus | — | Unit tests for the note format and the check; the release workflow fetches notes and fails without one |
| G3 | First end-to-end run of the real-Copilot suite with the owner (sign-in, model, `chat.tools.global.autoApprove`), fix what breaks | medium | Opus + owner | — | 3 tests green on the owner's machine; note written (G2) |
| G4 | MCP App views in Copilot Chat (wdio, real-Copilot suite): spike entering the view's iframe inside the chat; then specs for U1-U3 and U9-U11 over seeded repositories (A16 §1, A24 §1): render, drill-down and Back focus, Light/Dark/both High Contrast through the probe and judge, 360 and 600 px, footer | high | Opus (spike), Sonnet (specs) | G3 | A24 §1 rows each named in a spec title; green on the owner's machine |
| G5 | Fake MCP Apps host (Playwright, `packages/mcp-apps/e2e/`): a host page with ext-apps `AppBridge` loads `dist/views.html`, relays `tools/call` to the real server over stdio on the `web-e2e` fixture home, applies Claude's recorded and VS Code's sets; specs per A16 §2 and A24 §2 (including two currencies, the full U10 → U9 → U1 chain, permission-free drill-down, narrow and fullscreen) with axe | high | Opus (host), Sonnet (specs) | — | New required CI job `mcp-apps-e2e`, also in both release workflows |
| G6 | High Contrast sets recorded by wdio (replaces A24 1.7a) into `packages/mcp-apps/test/theme/`, added to the contrast tests; CLI text check for non-UI clients | medium | Sonnet | — | Contrast tests cover Dark and Light High Contrast; server test green |
| G7 | Remaining extension rows: chart-mark contrast in the judge (1.8), *Configure Tools* wording (2.1) and a seeded git folder (1.14) in the real-Copilot suite, 1.1 accepted as automated | medium | Sonnet | G3 | Manual-checks doc lists no release-gating hand row; **done 2026-11-11 (branch `claude/g7-extension-rows`)** |

**G6 built (2026-11-11).** `npm run record:host-themes` in
`packages/vscode-extension` (`wdio.record.conf.mts`, run under xvfb; not part
of `test:ui:vscode` or CI) switches to Default High Contrast and Default High
Contrast Light, runs *Developer: Generate Color Theme From Current Settings*
and writes `docs/plans/mcp-apps-a24-results/vscode-hc-{dark,light}-theme.jsonc`.
`host-sets.ts` reads both palettes from them (pure parser
`vscode-theme-recording.ts`, vitest-tested), so `theme-contrast.test.ts` covers
Dark and Light High Contrast. Light High Contrast reuses the Light Modern A0
style-variable report (references only; the recording supplies the colours).
The CLI text check is `register-app-views.test.ts` ("answers the three
Increment 2 tools with plain text"). Re-record after a VS Code version bump.

**G2 built (2026-11-11).** The real-Copilot run (`wdio.copilot.conf.mts`, only
with `COPILOT_E2E=1`) records its result as a git note on the commit it started
on, under `refs/notes/release-ui`, and prints the gate's verdict and the push
command; it never pushes. The release workflow fetches the notes ref and runs
`release-evidence-check.mts` on the tagged commit right after `release-check.mts`,
before any test or publish step. Only `ext-v*` tags are gated; the app's release
has no Copilot part.

- **Record** (JSON, schema 1): `schema`, `suite` (`copilot-e2e`), `commit`
  (full SHA of HEAD when the run started), `dirty` (tracked or untracked
  changes; ignored files don't count), `extensionVersion`, `vscodeVersion`,
  `model` (`requested`, `observed` ids), `tests` (each `title`, `state`
  passed/failed/skipped, `skipReason`), `aiCreditsSpent` (null if unmeasured),
  `ranAt`. Format and judge: `scripts/release-evidence/evidence.mts`.
- **Blocks a release:** no note; a note that isn't schema-1 JSON; a run on
  another commit; a dirty tree; a required test (1.4, 2.3, 2.4; since G4 also the 13 view rows) missing,
  failed or **skipped**; any failed test. Every problem is listed by name
  (`missing-note`, `malformed`, `unknown-schema`, `wrong-commit`,
  `dirty-tree`, `test-missing`, `test-failed`, `test-skipped`).
- **Skip rule tightened.** The plan refused only a skip without a reason. A
  required test that skipped, with any reason, now blocks: a run where Copilot
  never called the tool, or ran another model, proves nothing about the
  release. The message quotes the recorded reason so the owner knows what to
  fix before rerunning. A test the release doesn't require may skip.
- **Stable ids.** Spec titles start with the ids in
  `REQUIRED_COPILOT_E2E_TESTS` (`copilotTestTitle`), so a renamed or deleted
  test shows up as `test-missing` instead of dropping out of the gate.
- **Readiness wait** (owner request, 2026-11-11). `suiteSetup` no longer checks
  the sign-in once: it polls every 2 s for up to 120 s until a GitHub account
  is signed in, Copilot Chat (`GitHub.copilot-chat`) is active and
  `vscode.lm.selectChatModels({ vendor: "copilot" })` returns a model, and
  logs how long that took. Only then does it skip, with a reason naming each
  part that wasn't ready; the reason goes into the evidence. A slow start-up
  no longer skips the run (and so no longer blocks a release). A failed read
  of the signals is logged, never passed off as "not ready".
- **Password store** (owner's first real run, 2026-11-11). All three tests
  skipped in 1.2 s with "no GitHub account" although the copied profile held
  the sign-in: the sign-in script used `--password-store=basic`, the suite
  didn't, so its VS Code used the OS keyring and couldn't decrypt the secret.
  Both now take their arguments from `scripts/ui-automation/copilot-vscode-args.mts`
  (unit-tested). The suite also drops `--disable-extensions` and runs with
  `--ozone-platform=x11`, so under `xvfb-run` it never opens on a Wayland
  desktop.
- **Latest run wins.** A later run on the same commit replaces the note, pass
  or fail.
- **Residual:** the run tests `dist/` as built; build at that commit first.
  The note is a self-gate for the owner, not a defence against someone with
  push access (threat-model §8).

How the owner uses it:

1. Commit everything; `npm run build` at the repo root.
2. `COPILOT_E2E=1 COPILOT_E2E_USER_DATA_DIR=<profile> xvfb-run -a npm run test:ui:vscode:copilot --workspace=packages/vscode-extension`
   (or on a display). The run ends with the verdict: `PASS` or `BLOCKED` with
   each problem.
3. `npm run release:evidence --workspace=packages/vscode-extension` (or
   `-- <sha>`) shows the note and the verdict the release workflow will give.
4. `git push origin refs/notes/release-ui`, then push the `ext-v*` tag on the
   same commit. On a fresh clone, `git fetch origin refs/notes/release-ui:refs/notes/release-ui`
   first.

Verified: unit tests for the record, judge, builder, run log, git commands
(fake runner, plus one temporary repository) and the check; a run with
`COPILOT_E2E` unset still exits 0 with its message; a run with `COPILOT_E2E=1`
and an empty profile waited 120 s (Copilot Chat active; no account, no
model), skipped all three tests with the readiness reason, wrote a note, and
the check refused it (dirty tree, three skips). Those test notes were deleted
from the local repository; nothing was pushed. TDD
exceptions: the wdio config hooks, the results reporter, the readiness polling
and the workflow YAML; only a real run tests them. Not verified: the workflow
steps on GitHub (they run on the next `ext-v*` tag), and the readiness signals
with a signed-in profile (G3; since verified, see below).

**G3: normal mode (2026-11-11).** The owner's run on `main` skipped all three
tests after the 120 s wait ("no GitHub account; no Copilot language model")
although the test profile is signed in.

- **Root cause.** wdio-vscode-service always starts VS Code with
  `--extensionTestsPath` (its proxy, which serves `browser.executeWorkbench`).
  VS Code 1.145's main process then keeps application storage, shared storage
  and so the secret store in memory (`getStorageOptions()` returns
  `useInMemoryStorage: !!extensionTestsLocationURI`), so a copied profile's
  sign-in is never read. The password-store fix above was needed but not
  enough.
- **Fix: normal mode.** `vscodeArgs` override the service's own
  `extensionTestsPath` key with `""` (the service merges
  `{ ...its args, ...vscodeArgs }`; VS Code treats an empty path as no tests
  location). The same proxy is then loaded by a throwaway bridge extension
  (`scripts/ui-automation/workbench-bridge.mts`) that the launcher writes into
  the run's extensions dir and lists in its `extensions.json`; on start-up
  (`activationEvents: ["*"]`) it imports the service's `proxy/index.js` and
  calls `run(vscode)`, as the test runner would. It is generated into the
  temporary copy only: never in the `.vsix` (allow-listed `.vscodeignore`) or
  the default suite.
- **What normal mode changed, and the fixes.** Each found by a run:
  - VS Code opened the owner's real `~/.vscode-shared/sharedStorage/state.vscdb`
    (shared storage lives outside `--user-data-dir`): the suite passes
    `--shared-data-dir=<run>/storage/shared-data`. The first spike run touched
    the owner's file once before this fix.
  - The analyzer under development runs in `ExtensionMode.Development`, not
    `Test`, so its test hooks were missing. Per D5, `extension.ts` registers
    them in `Development` only with `AICA_TEST_HOOKS=1`, which
    `wdio.copilot.conf.mts` sets; VS Code's extension host inherits it
    (checked: the variable reads `1` there and all 7 hooks register).
  - Nothing auto-confirms dialogs: `chat.tools.global.autoApprove: true`
    raised its one-time "Enable global auto approve?" dialog and the chat
    waited on it. First fixed by seeding the opt-in; replaced per D6 (next
    item).
  - **Tool approval (D6).** What VS Code 1.145 offers, read from its
    `workbench.desktop.main.js`: `chat.tools.global.autoApprove` takes `true`
    or a map of tool id to `true` (per-tool approval, still behind the
    one-time opt-in); `chat.tools.eligibleForAutoApproval` (keyed
    `server/tool`) only makes a tool *ineligible*; terminal commands have
    their own `chat.tools.terminal.*` rules. But an MCP tool asks for
    approval only when it lacks `readOnlyHint` (`canRequestPreApproval:
    !readOnlyHint`, no confirmation message otherwise), and every analyzer
    tool is annotated read-only (`READ_ONLY` in `packages/server/src/mcp/tool-helpers.ts`).
    So the analyzer's tools run without approval and the suite approves
    nothing: no global auto approve in any form, no opt-in seed,
    `chat.tools.terminal.enableAutoApprove: false`. A tool that would ask
    stalls the chat and fails the test rather than acting. On top, the specs
    chat in a test-only agent, `User/prompts/aica-e2e.agent.md` in the
    profile copy, with `tools: ['ai-credits-analyzer/*']` (the tool set
    VS Code names after the server's label), so no other tool is offered,
    and `chat.mcp.discovery.enabled` is off for every source. The owner's
    `jcodemunch` came from discovery (`~/.copilot/mcp-config.json`, the
    `copilot` source), not from the profile, which has no `mcp.json`.
    Settings and agent file: `copilot-e2e-settings.mts` (unit-tested).
  - The panel model: the profile had no `chat.currentLanguageModel.panel`
    (the owner's pick was stored for the Copilot CLI session type), so the
    chat ran on Auto, routed to GPT-6 Luna. The launcher seeds it with
    `copilot/<COPILOT_E2E_MODEL>`, so the run uses the requested model
    without the manual picker step. On VS Code 1.146 the seed is not
    enough: every chat now selects the model and checks the picker (R5).
  - With no folder open, Copilot Chat writes its debug logs to
    `User/globalStorage/github.copilot-chat/debug-logs/`, which the analyzer
    doesn't read (it reads `workspaceStorage/*/GitHub.copilot-chat/debug-logs`),
    so no session appeared. The suite opens an empty temp folder. **Product
    gap for the owner:** a user's chat in an empty window is invisible to the
    analyzer.
- **Verified** (VS Code 1.145.0, xvfb, owner's test profile copy): main log
  creates shared storage under the run (not `:memory:`), `executeWorkbench`
  answers `vscode.version` in 0.4 s, one GitHub account (label present) and
  33 Copilot models after 4.1 s.

- **First green run** (commit `1f2027e`, global auto approve): Copilot ready
  after 1.0 s; 1.4, 2.3 and 2.4 passed in 27.9 s on `claude-haiku-5.5`
  (observed log id `claude-haiku-5.5`, the picker id); 0.7643 AI Credits;
  gate `PASS`.
- **Run with D5 and D6** (commit `7bc1d36`, clean tree, owner's test profile,
  xvfb): Copilot ready after 0.7 s; 1.4, 2.3 and 2.4 passed in 27.9 s;
  model requested and observed `claude-haiku-5.5` in all three sessions;
  0.9313 AI Credits (within D8); gate `PASS`. Tools the chat called, from the
  sessions' Copilot debug logs: `manage_todo_list` and `tool_search`
  (Copilot's to-do list and its loader for deferred tools, which searches
  only the request's available tools), then `mcp_ai_credits_an_list_log_providers`
  (2.3) and `mcp_ai_credits_an_list_sessions` (2.4); no terminal, file,
  browser or other MCP tool. No approval dialog appeared and no setting
  approved anything. **Not proven:** the full list of tools offered to the
  model (`tools_0.json`; the capture script didn't parse its format, and the
  copy is deleted at exit). The notes of both runs were removed from the
  local `refs/notes/release-ui` (reset to the owner's note on `16389dc`) and
  never pushed: the owner reruns on the release commit.
- **TDD exceptions:** the wdio config, the generated bridge's run against a
  real VS Code and the real runs. Unit-tested: `workbench-bridge.test.ts`
  (argument override, shared-data dir, proxy path, install and
  `extensions.json`, the generated bridge running a stand-in proxy),
  `profile-seed.test.ts`, `copilot-e2e-settings.test.ts`, and the
  bundle-load tests for hooks in `Development` mode with and without
  `AICA_TEST_HOOKS`.
- **Exposure** (threat-model.md): the bridge evaluates what the service's
  WebSocket server sends, exactly as the service's test runner did; it opens
  no port of its own (it connects out to the service's `localhost` port).
  Normal mode does not change that. Since D6 the chat is offered only the
  analyzer's read-only MCP tools and nothing is auto-approved.

**G3/G4 follow-up: audit race (2026-11-11).** The owner's release run on `d666a43` failed 2.3 (`list_tool_calls`, kind `mcp`, `total: 0`); it had passed three times. The spec read the audit once, right after the session appeared, before Copilot's debug log held the MCP call. 2.3 and 2.4 now poll every 2 s for up to 90 s and, on timeout, list the tool names the audit held (all kinds), so a repeat says whether Copilot never called the tool or the audit did not record it. Only a real run tests the wiring.

**G4: MCP App views in Copilot Chat (2026-11-11).** The spike worked (risk R1
closed): the views are reachable and driven like any VS Code webview. The
spec is `test/ui/copilot-e2e/specs/copilot-views.e2e.ts` in the real-Copilot
suite; page objects in `support/chat-view.ts`.

- **Frame path** (VS Code 1.145, Copilot Chat in the secondary side bar):
  workbench → `.webview-overlay-content > iframe.webview` → its
  `iframe#active-frame[title="MCP App"]` → the view's document (title "Cost
  views"). Two `switchFrame` steps, as for the analyzer's own panel. The
  overlay is **not inside the chat's DOM**: each tool call renders a
  placeholder `.chat-tool-invocation-part .mcp-app-part > .mcp-app-webview`
  in the chat list (`.interactive-list`, a virtualised monaco list), and
  VS Code lays an overlay webview over it. Nothing links the two, so the
  spec picks the overlay that covers the placeholder (`view-overlay.mts`,
  unit-tested). Overlays exist only for views near the visible part of the
  list (others are `visibility: hidden`); the placeholder starts at 300 px
  high and grows to the view's height, at most 75 % of the window.
- **Moving and clicking.** The list has no `scrollIntoView`: the spec
  scrolls it with the mouse wheel over the list's margin until the view's
  placeholder sits below the request VS Code pins at the top. Another
  view's overlay can lie over a click point; the click then falls back to
  the element's own `click()` and says so in the log. Keys reach a view only
  while its frame has focus.
- **Reading a view:** one script returns kicker, title, the line under it,
  `role=group` tiles with their text, table, chart and button names, alerts,
  footer and text (`ViewSnapshot`), in the vocabulary of G5's `ViewFrame`.
- **One chat, eight views.** A fixed prompt (`view-prompt.mts`, unit-tested)
  asks the `aica-e2e` agent to call `get_repository_cost` (portal, weekly,
  90 days), `get_project_cost` (`demo`), `compare_costs` (both
  repositories, last 28 days), `explain_cost_change` (portal, days 42-22
  against 21-1), `get_repository_cost` (`no-such-repo`), `get_session_cost`,
  `get_cost_rollup` and `list_findings`, all in one step. Haiku 5.5 makes
  the eight calls in parallel. Fewer views than asked skips the suite with
  the count as the reason (R2), which the gate refuses.
- **Data.** Before VS Code starts, the copy is cleared of earlier chats
  (`clearChatHistory`: the Agent Host catalog, empty-window chats, Copilot
  Chat's store rows and debug logs) and seeded (`seedChatHistory`): eight
  made-up sessions in S9's two repositories over 38 days, each with the
  server fixture's real debug log under its own id, so AI Credits are known.
  `COPILOT_HOME` points at an empty folder in the run. Why: the owner's
  test profile held Agent Host sessions from real work, which the analyzer
  listed (the first spike run saw them); no view now shows them.
- **Drill-downs make no model turn:** after each drill-down and Back the
  chat still shows one request (`.interactive-request`), and at the end the
  analyzer reports the chat's session at one turn.
- **Required:** all 13 tests are in `REQUIRED_COPILOT_E2E_TESTS`
  (`COPILOT_VIEW_ROWS`, ids such as `A24 1.4` and `A16 U1`; `testIdOf` reads
  them). None is left optional: over seeded data each asserts only on the
  views, so the model's words never decide them.

| Test | Checks |
|---|---|
| A24 1.1 | U9 repository: kicker, title, weekly period line, the four basis tiles (Billed in AI Credits, Reported Unknown), the cost-per-week chart; no top sessions, vendor or token tables; no currency control |
| A24 1.2 | U9 project: No projects here, the extension's reason, What to ask instead, `Unknown project id "demo"`, no chart |
| A24 1.3 | U10: title, units sentence, rows most expensive first (as buttons), a signed change in percent, Together, never "from 0" |
| A24 1.4 | U10 → U9 in place: kicker, trail, U9 loaded with its chart, no top sessions; Back with focus on the row; a second row by keyboard only (Tab, Enter, Tab to Back, Enter) with focus and ring back on it; no new chat request |
| A24 1.5 | U11 with nothing priced (below): kicker, the period line, the priced-basis note, "No priced figures in either period.", Not explained counted per period with the reason, never 0, the documented price changes section |
| A24 1.6 | Unknown repository: U9 with every basis tile Unknown, "0 sessions, 0 turns.", no bars (see the finding below) |
| A24 1.7 | U9, U10, U11 and A16's U1-U3 in Light Modern, Dark Modern, Dark and Light High Contrast, switched mid-run: each view follows (body class, `data-theme`), every text reaches WCAG AA on the chat's own ground (the probe and judge of `layout-theme.e2e.ts`), a focus ring on Tab |
| A24 1.8 | The six views at about 360 px and at the widest the chat allows (576 px in the suite's window, against the checklist's 600): no sideways scroll; at 360 px U10's per-session figures move under the row name |
| A24 1.9 | All eight views end with `Read-only · local logs · v<extension version>` and their text can be selected |
| A16 U1 | Tiles, per-turn chart, top turns; a turn opens in place and hides; Copy title names *AI Credits Analyzer: Open Session*; no "0 AI Credits"; no new chat request |
| A16 U2 | Daily chart, by model, by provider, top sessions; a session opens U1 in place, Back to cost rollup returns focus to it; no new chat request |
| A16 U3 | Severity tiles; the kind filter reloads in place; no new chat request |
| A16 keyboard | U1: Tab to a top turn, Enter opens it; U2: Enter drills in, Back by keyboard returns focus to the session |

Not checkable here, and why (each is covered elsewhere):

- **U11's priced states** (1.5's tiles, waterfall colours, model table and
  its rows, the disabled Price changes button; 1.8's columns at 360 and
  600 px): Copilot's debug logs record no cache-write count, so no Copilot
  turn is priced and U11 shows only its "nothing priced" state. G5 covers
  them (A24 2.7-2.9) with priced Claude Code turns.
- **1.1's partial-week hatching and price-change markers, 1.3's "no earlier
  figure" and Unknown rows:** the seeded turns are all known and no price
  changes in range; G5 and the view tests cover them.
- **1.6's second bullet** (stop the server, click a row, Retry, Back): not
  automated; the drill-down's error state is a view test
  (`CompareDrillDown`).
- **1.7's chart marks** (hatching, markers, waterfall bars in High
  Contrast): the judge checks text only; chart-mark contrast is G7.
- **A16 U1's paste into Open Session:** outside the view (the command is
  hidden and takes an id, A15).
- **A16 U2's Ask about this session:** it starts a new model turn in the
  real chat (an agent run, more AI Credits); G5 asserts the fixed template.
- **A16 U3's severity filter and evidence rows:** the seeded history has no
  findings; G5 covers them.

Findings:

- **View bug, fixed test-first:** U11's Not explained reasons sit in two
  grid columns; a reason with a long unbroken word (Copilot's
  `github.copilot.chat.otel.dbSpanExporter.enabled`) in both widened the
  view to 658 px in a 561 px chat, so it scrolled sideways in every theme.
  A G5 spec reproduced it at 560 px (both periods holding the fixture's
  Copilot turn); `cost-change.css` now uses `minmax(0, 1fr)` columns and
  `overflow-wrap: anywhere` on the reasons.
- **Checklist vs server, for the owner:** A24 1.6 expects "Couldn't load the
  cost over time." for an unknown repository, but `get_repository_cost`
  answers an unknown key with an empty series, not an error (as
  `compare_costs` does, G5's A24 2.6). The spec asserts the real answer.
- **VS Code's workspace-storage clean-up:** 30 s after start-up the shared
  process deletes every `workspaceStorage` folder whose name isn't 32
  characters and that no window uses. The suite's second VS Code launch then
  found no seeded debug logs (run 7 below); the seeded folder now has a
  32-character id. `ui-fixture.mts`'s `integration-workspace` folder has the
  same exposure in runs longer than 30 s.

Real runs (owner's test profile, xvfb, `claude-haiku-5.5` requested and
observed every time; each run's note removed from the local
`refs/notes/release-ui`, never pushed):

| Run | Specs | Result | AI Credits |
|---|---|---|---|
| 1 | spike: one `get_repository_cost` | view found, frame path recorded | not measured (one short chat) |
| 2 | spike: the eight-call prompt | eight views, overlays and wheel scrolling recorded | 0.4723 |
| 3-6 | views spec while it was built | setup width, then wheel over views, then U11 overflow (the bug) | 0.5732, 0.5748, 0.5785, 0.5798 |
| 7 | whole suite | 1.4, 2.3, 2.4 and 10 view tests passed; 1.1, 1.3, 1.5 failed: VS Code had deleted the seeded debug logs before the second launch | 0.7357 + 0.5473 = 1.2830 |
| 8 | whole suite on commit `7ddb37f`, clean tree | **all 16 passed** (3 chat checks in 27.9 s, 13 view tests in 13 min 6 s); one click fell back to the element's own `click()`; gate `PASS` | 0.7722 + 0.4634 = 1.2356 |

TDD exceptions: the spec, the page objects in `chat-view.ts`, the wdio config
and the real runs. Unit-tested first: `chat-history-seed.test.ts` (through the
extension's own MCP server), `view-prompt.test.ts`, `view-overlay.test.ts`,
and the evidence ids and required set in `evidence.test.ts`, `check.test.ts`
and `record.test.ts`.

**G7 (2026-11-11).** Built on `claude/g7-extension-rows`, not merged; D11 fixes included.

- **1.8 charts.** The judge's chart-mark rule (`scripts/ui-check/chart-marks.mts`, unit-tested in `chart-marks.test.ts`): (1) every data mark (bar, line, marker, legend swatch, hatching that carries meaning) reaches 3:1 against the ground it is painted on (WCAG 1.4.11), translucent paints composited first; (2) each pair of neighbouring series in a chart (order of first appearance) is told apart by ONE of: paints 3:1 apart, a different non-colour cue (stroke dash pattern or a fill pattern), or a direct label on both in the chart. A legend alone does not count (it makes the reader match colours), and neither does "View as table"; the threshold is not relaxed for light grounds. Applied in `layout-theme.e2e.ts` (default suite, CI) in four themes. Findings, all fixed test-first in `packages/web` (D11), nothing pinned: the High Contrast column fill and the sparkline stroke; the light steps of series 2-5 (orange, aqua, yellow, magenta; 1.9-2.9:1 on a light ground, now 3.7-4.3:1); the hard-coded token-type and tool-status palettes (themed `--color-series-*` and new `--color-status-*` tokens, every one 3:1 or more on light, dark and High Contrast grounds); and success against error (1.1:1 apart) and cache read against output (2.1:1 apart), which now also differ by a fill pattern (solid, hatching, dots, cross, lines), in the charts and their legends.
- **2.1 Configure Tools** and **1.14 on a real git folder:** `copilot-e2e/specs/extension-rows.e2e.ts`, titles `2.1 ...` and `1.14 ...`; both ids are required (`COPILOT_EXTENSION_ROWS` in `REQUIRED_COPILOT_E2E_TESTS`). 2.1 sends no message; 1.14 is one chat in a real `git init` workspace with a made-up remote. First run: 6 passed, 0.1800 AI Credits (D8). A window reload does not end the wdio session in normal mode, so the persistence of the grouping is tested for real.
- **1.1** accepted as automated (D10): `first-run.e2e.ts` and `WalkthroughOffer`'s unit tests; the manual-checks row says so.
- TDD exceptions: the picker's DOM read, the polling and the real runs. Unit-tested: `chart-marks`, `git-folder`, `repository-status`.

Order: G0 and G1 first (small, unblock D4); G5 and G6 in parallel (CI,
no Copilot); G2 and G3 next; G4 and G7 last.

## 4. Effect on other plans

- **Phase 12:** A24 (owner's checks of U9-U11) becomes G4 + G5 + G6; the
  Increment 2 release (extension 0.6.0, app 0.11.0) waits for G4 and the
  empty-window fix (D7, step 10.18, done #209), and G7 (D11, which superseded D10 on G7). A33
  (Increment 3 checks) is written as specs from the start.
- **Phase 10:** the open "manual checks before release" item closes when G1,
  G3 and G7 are done.
- **Step 10.16:** T15 closes with D4.

## 5. Risks

- **R1 Copilot Chat frames (G4).** MCP App views render in a nested iframe
  inside the chat webview; selectors and frame order are unverified. The
  spike decides; if it fails, G5's fake host covers the views and G4 is
  limited to "a view appears under the tool call". **Closed by G4's spike
  (2026-11-11):** the views are overlay webviews entered in two frame
  steps; see G4.
- **R2 Real-Copilot flakiness.** A live model may not call the tool; the
  suite skips with a named reason and G2 refuses the skip (any skip of a
  required test, explained or not): the owner reruns until it passes. A slow
  Copilot start-up is waited for (up to 120 s), not skipped.
- **R3 Required wdio job.** One flake in 78 runs; a red PR now blocks the
  merge. Mitigation: state-based waits; a flake gets a fix, not a retry.
- **R4 Fake host fidelity (G5).** It proves the views against the
  protocol and Claude's recorded theme, not Claude Desktop's own chrome.
  Accepted by D3.
- **R5 Normal mode leans on internals (G3).** The real-Copilot suite depends on
  wdio-vscode-service's arg key (`extensionTestsPath`) and proxy module path,
  and on VS Code state keys (`chat.tools.global.autoApprove.optIn`,
  `chat.currentLanguageModel.panel`). A service or VS Code update can break
  it; the symptom is a readiness skip, a stuck chat or the wrong model, all of
  which block the release (G2) rather than pass it. Recheck after a bump.

  **Incident, VS Code 1.146 (2026-11-11).** The owner's release run on
  `5922f21` (#215 pinned 1.146.0; the same suite passed 22/22 on 1.145.0 at
  `a4e1764`) went wrong twice:

  1. *Wrong model, 16.38 AI Credits.* The three `copilot-agent.e2e.ts` chats
     ran on `claude-sonnet-5.5` and `gpt-6-luna`, not the seeded
     `claude-haiku-5.5` (about 1.3 expected, D8 about 2). The after-chat
     model check skipped each test, but only after the chat had been paid
     for. Cause, found without sending a chat: the storage key and the code
     that reads it are the same in 1.145 and 1.146, and the chat's first
     start shows the seeded model. But on 1.146,
     `workbench.action.chat.newChat`, which the specs run before every chat,
     can start the new chat on another model. Read from the picker in
     no-chat runs: Copilot Fusion (Copilot's router), GPT-6 Luna and Claude
     Fable 5. (The owner's profile stores GPT-6 Luna for the Copilot CLI
     session type, `chat.currentLanguageModel.panel.agent-host-copilotcli`.)
     The 1.146 code path that does this wasn't pinned down; the fix doesn't
     depend on it.
  2. *`session not created: Chrome instance exited`* for `copilot-views.e2e.ts`
     and `extension-rows.e2e.ts`. Every spec file starts its own VS Code on
     the same profile copy, and VS Code is single-instance per profile: a
     second launch hands over to a running one and exits (tested: it exits
     0 within 6 s). After the real chats the previous VS Code didn't quit.
     The likely reason, read from the code and not reproduced with a real
     chat: with a chat request or a local agent session still in progress,
     VS Code's `chatLifecycleHandler` vetoes the quit with a confirmation
     nobody answers. chromedriver then kills only wdio-vscode-service's
     launcher shim (`dist/chromium/index.js`, which starts `code` with
     `execFile` and never passes signals on), and the orphaned VS Code keeps
     the profile. Reproduced without a chat: an unsaved file with
     `files.hotExit: "off"` blocks the quit in the same way, and the next
     spec file failed with the owner's exact error. chromedriver's
     Chromium (150.0.7871.124) matches 1.146's Electron (Chromium
     150.0.7871.250, the same as 1.145's), so the driver is not the cause.
     The no-account smoke run had no chat in progress, so its VS Code quit.

  Fixes (test-only, no product change):

  - **Model selection:** `sendToAgent` (`copilot-chat.ts`) starts each chat
    with `workbench.action.chat.open` and `modelSelector: { vendor:
    "copilot", id: COPILOT_E2E_MODEL }`, which both 1.145 and 1.146 support
    (it throws `No language models found matching selector` for an unknown
    id). The prompt goes into the input with `isPartialQuery`, which does
    not send it. The seed stays for the first start.
  - **Pre-send guard:** before every message it reads the model from the
    chat input's picker (its accessible name, `Models, Claude Haiku 5.5`),
    not from the state the suite wrote. If that isn't the requested model
    (exact match on Copilot's name or id, so Auto, a fast variant or a
    failed selection all refuse), nothing is sent and the test skips,
    naming the model shown. A picker on the wrong model costs 0 AI Credits,
    and the gate still refuses the skip (D9). The real run below shows the
    picker isn't enough on 1.146. Then a plain `workbench.action.chat.open` with
    the query sends from the same chat. The decision is
    `pre-send-model.mts` (unit-tested). The after-chat check of the logged
    model id stays.
  - **AI Credits cap (D12, proposed):** `credit-budget.mts` (unit-tested)
    sums the run log's `credits` entries, which every spec file appends to,
    and `sendToAgent` refuses to send once the sum reaches
    `COPILOT_E2E_MAX_AI_CREDITS` (default 3): "AI Credits budget exceeded:
    the run has spent X of COPILOT_E2E_MAX_AI_CREDITS=Y; nothing was sent".
    The skip reason goes into the release evidence. 1.14's chat moved into
    its suite's `suiteSetup`, so a refusal skips its four tests instead of
    failing three of them.
  - **Launch between spec files:** the config's `onWorkerEnd`, which the
    wdio launcher awaits before the next spec file, runs `releaseProfile`
    (`scripts/ui-automation/profile-release.mts`, unit-tested). It waits up
    to 30 s for every process started with the run's `--user-data-dir` to
    exit, then sends SIGTERM, then SIGKILL after 5 s, and logs what it had
    to do. Verified on the unsaved-file reproduction: the profile was
    released after 35.1 s (SIGTERM, then SIGKILL) and the next spec file
    started.

  No-chat runs on 1.146 (0 AI Credits, notes reset afterwards): the whole
  suite with `COPILOT_E2E_MODEL=no-such-model` (every chat refused by the
  guard; 2.1 passed) and with `COPILOT_E2E_MAX_AI_CREDITS=0` (every chat
  refused by the cap; 2.1 passed). All three spec files launched in both.

  **Still open: the guard doesn't stop the wrong model on 1.146.** One real
  run on `bc9b46f` (clean tree, `COPILOT_E2E_MAX_AI_CREDITS=2`, a watchdog
  that stops the run when one chat costs more than 1 AI Credit). Before
  1.4's chat the picker showed "Claude Haiku 5.5", so the guard sent it.
  The session was logged as `claude-sonnet-5.5` and cost **16.0553 AI
  Credits**, about what the owner's run spent on its Sonnet chat (16.38 for
  one Sonnet and two GPT-6 Luna chats). The after-chat check skipped 1.4.
  The cap then skipped 2.3 and 2.4 unsent, and the watchdog stopped the run.
  Its process-group kill also made the next two spec files fail to start, so
  this run says nothing about the launch fix after real chats. Gate:
  `BLOCKED`; note removed, never pushed. So on 1.146 the picker is not what
  decides the first chat's model. Not yet known: whether the window's first
  chat always goes to another model (Copilot Fusion, Copilot's router, was
  the picker's model for the first new chat in the no-chat runs), or whether
  the request takes the session's model and not the picker's. Finding out
  needs more paid chats. Until then:

  - **Don't run the real-Copilot suite on VS Code 1.146.** The pre-send
    guard catches a picker that shows another model, but not this. The cap
    limits the loss to one chat (about 16 AI Credits on Sonnet 5.5), not 0.
  - Options for the owner: run the release gate on 1.145.0 (22/22 at
    `a4e1764`; the guards work there too, since 1.145 has the same open
    command, `modelSelector` and picker name), or allow a paid
    investigation. The next guard to try: while the chat runs, read the
    session's model from Copilot's debug log as soon as its first request is
    logged, and cancel the chat (`workbench.action.chat.cancel`) on a
    mismatch. That limits a wrong model to one request.
