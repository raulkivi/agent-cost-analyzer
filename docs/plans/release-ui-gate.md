# Automated pre-release UI gate (step 10.17)

**Last changed:** 2026-11-11 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **in progress: G0, G1 (#202), G2 (#207), G5 (#205, #206) and G6 (#204) done 2026-11-11.** Owner rule, 2026-11-11: every UI check
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
with a signed-in profile (G3).

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
