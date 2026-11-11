# Automated pre-release UI gate (step 10.17)

**Last changed:** 2026-11-11 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **in progress: G0, G1 (#202), G2 (#207), G5 (#205, #206) and G6 (#204) done 2026-11-11; G3 built and green once on the owner's machine (branch `claude/g3-copilot-normal-mode`), owner rerun on the merged commit pending.** Owner rule, 2026-11-11: every UI check
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
| G1 | CI: drop `continue-on-error` from `extension-ui`; `release-extension.yml` runs `test:ui:vscode` under xvfb with the cached download; `release-app.yml` builds web and runs `test:e2e`. Owner: mark `extension-ui` and `web-e2e` required in branch protection | low | Haiku | — | Both release workflows fail on a red suite; green on a dry-run tag in a fork or a `workflow_dispatch` run |
| G2 | Release evidence for D1: the real-Copilot suite writes its result (commit, VS Code version, tests passed, skipped with reasons, AI Credits spent) as a git note under `refs/notes/release-ui`; a release check reads the note for the tagged commit and refuses a missing, failed or skipped result (tightened from "skipped without reason", see below) | high | Opus | — | Unit tests for the note format and the check; the release workflow fetches notes and fails without one |
| G3 | First end-to-end run of the real-Copilot suite with the owner (sign-in, model, `chat.tools.global.autoApprove`), fix what breaks | medium | Opus + owner | — | 3 tests green on the owner's machine; note written (G2) |
| G4 | MCP App views in Copilot Chat (wdio, real-Copilot suite): spike entering the view's iframe inside the chat; then specs for U1-U3 and U9-U11 over seeded repositories (A16 §1, A24 §1): render, drill-down and Back focus, Light/Dark/both High Contrast through the probe and judge, 360 and 600 px, footer | high | Opus (spike), Sonnet (specs) | G3 | A24 §1 rows each named in a spec title; green on the owner's machine |
| G5 | Fake MCP Apps host (Playwright, `packages/mcp-apps/e2e/`): a host page with ext-apps `AppBridge` loads `dist/views.html`, relays `tools/call` to the real server over stdio on the `web-e2e` fixture home, applies Claude's recorded and VS Code's sets; specs per A16 §2 and A24 §2 (including two currencies, the full U10 → U9 → U1 chain, permission-free drill-down, narrow and fullscreen) with axe | high | Opus (host), Sonnet (specs) | — | New required CI job `mcp-apps-e2e`, also in both release workflows |
| G6 | High Contrast sets recorded by wdio (replaces A24 1.7a) into `packages/mcp-apps/test/theme/`, added to the contrast tests; CLI text check for non-UI clients | medium | Sonnet | — | Contrast tests cover Dark and Light High Contrast; server test green |
| G7 | Remaining extension rows: chart-mark contrast in the judge (1.8), *Configure Tools* wording (2.1) and a seeded git folder (1.14) in the real-Copilot suite, 1.1 accepted as automated | medium | Sonnet | G3 | Manual-checks doc lists no release-gating hand row |

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
  another commit; a dirty tree; a required test (1.4, 2.3, 2.4) missing,
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
    `Test`, so its test hooks were missing: `extension.ts` now registers them
    in any mode but `Production` (threat-model.md row updated).
  - Nothing auto-confirms dialogs: `chat.tools.global.autoApprove` raised its
    one-time "Enable global auto approve?" dialog and the chat waited on it.
    The launcher seeds `chat.tools.global.autoApprove.optIn` in the copy's
    `User/globalStorage/state.vscdb` (`profile-seed.mts`, unit-tested).
  - The panel model: the profile had no `chat.currentLanguageModel.panel`
    (the owner's pick was stored for the Copilot CLI session type), so the
    chat ran on Auto, routed to GPT-6 Luna. The launcher seeds it with
    `copilot/<COPILOT_E2E_MODEL>`, so the run uses the requested model
    without the manual picker step.
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

- **First green run** (commit `1f2027e` on `claude/g3-copilot-normal-mode`,
  clean tree, owner's test profile, xvfb): Copilot ready after 1.0 s; 1.4,
  2.3 and 2.4 passed in 27.9 s; model requested and observed
  `claude-haiku-5.5` in all three sessions (the Copilot log id equals the
  picker id); 0.7643 AI Credits spent; the gate printed `PASS`. The note was
  removed from the local `refs/notes/release-ui` afterwards (restored to the
  ref as it was before the session) and never pushed: the owner reruns on the
  release commit.
- **TDD exceptions:** the wdio config, the generated bridge's run against a
  real VS Code and the real runs. Unit-tested: `workbench-bridge.test.ts`
  (argument override, shared-data dir, proxy path, install and
  `extensions.json`, the generated bridge running a stand-in proxy),
  `profile-seed.test.ts`, and the bundle-load test for hooks in
  `Development` mode.
- **Exposure** (threat-model.md): the bridge evaluates what the service's
  WebSocket server sends, exactly as the service's test runner did; it opens
  no port of its own (it connects out to the service's `localhost` port).
  Normal mode does not change that. `chat.tools.global.autoApprove` lets the
  agent run any tool, including terminal commands and MCP servers it
  discovers on the machine (the run listed the owner's `jcodemunch`), without
  asking: the prompts are fixed and short, but a model could still act.

Order: G0 and G1 first (small, unblock D4); G5 and G6 in parallel (CI,
no Copilot); G2 and G3 next; G4 and G7 last.

## 4. Effect on other plans

- **Phase 12:** A24 (owner's checks of U9-U11) becomes G4 + G5 + G6; the
  Increment 2 release (extension 0.6.0, app 0.11.0) waits for them. A33
  (Increment 3 checks) is written as specs from the start.
- **Phase 10:** the open "manual checks before release" item closes when G1,
  G3 and G7 are done.
- **Step 10.16:** T15 closes with D4.

## 5. Risks

- **R1 Copilot Chat frames (G4).** MCP App views render in a nested iframe
  inside the chat webview; selectors and frame order are unverified. The
  spike decides; if it fails, G5's fake host covers the views and G4 is
  limited to "a view appears under the tool call".
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
