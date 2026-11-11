# Automated pre-release UI gate (step 10.17)

**Last changed:** 2026-11-11 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **planned 2026-11-11.** Owner rule, 2026-11-11: every UI check
before a release is automated. VS Code and Copilot checks use wdio
(`wdio-vscode-service`, [vscode-ui-automation.md](vscode-ui-automation.md));
web-only checks use Playwright (or the integrated Chrome for exploratory
runs). No hand checklist gates a release. Builds on step 10.16 and the
standalone app's `web-e2e` suite (Phase 15 step 15.9).

Progress: G5's fake host is built (2026-11-11, `packages/mcp-apps/e2e/`, CI
job `mcp-apps-e2e`), with smoke specs for A24 2.1, 2.5 and 2.7 in Claude
dark ([README](../../packages/mcp-apps/e2e/README.md)). The rest of the
A16 §2 and A24 §2 specs and the release workflows' job are next. The fake
host has no permission prompt, so A24 2.10 proves only that a drill-down is
a plain `tools/call`; whether Claude Desktop prompts stays outside the gate
(R4).

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
| G2 | Release evidence for D1: the real-Copilot suite writes its result (commit, VS Code version, tests passed, skipped with reasons, AI Credits spent) as a git note under `refs/notes/release-ui`; `release-check.mts` reads the note for the tagged commit and refuses a missing, failed or skipped-without-reason result | high | Opus | — | Unit tests for the note format and the check; the release workflow fetches notes and fails without one |
| G3 | First end-to-end run of the real-Copilot suite with the owner (sign-in, model, `chat.tools.global.autoApprove`), fix what breaks | medium | Opus + owner | — | 3 tests green on the owner's machine; note written (G2) |
| G4 | MCP App views in Copilot Chat (wdio, real-Copilot suite): spike entering the view's iframe inside the chat; then specs for U1-U3 and U9-U11 over seeded repositories (A16 §1, A24 §1): render, drill-down and Back focus, Light/Dark/both High Contrast through the probe and judge, 360 and 600 px, footer | high | Opus (spike), Sonnet (specs) | G3 | A24 §1 rows each named in a spec title; green on the owner's machine |
| G5 | Fake MCP Apps host (Playwright, `packages/mcp-apps/e2e/`): a host page with ext-apps `AppBridge` loads `dist/views.html`, relays `tools/call` to the real server over stdio on the `web-e2e` fixture home, applies Claude's recorded and VS Code's sets; specs per A16 §2 and A24 §2 (including two currencies, the full U10 → U9 → U1 chain, permission-free drill-down, narrow and fullscreen) with axe | high | Opus (host), Sonnet (specs) | — | New required CI job `mcp-apps-e2e`, also in both release workflows |
| G6 | High Contrast sets recorded by wdio (replaces A24 1.7a) into `packages/mcp-apps/test/theme/`, added to the contrast tests; CLI text check for non-UI clients | medium | Sonnet | — | Contrast tests cover Dark and Light High Contrast; server test green |
| G7 | Remaining extension rows: chart-mark contrast in the judge (1.8), *Configure Tools* wording (2.1) and a seeded git folder (1.14) in the real-Copilot suite, 1.1 accepted as automated | medium | Sonnet | G3 | Manual-checks doc lists no release-gating hand row |

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
  suite skips with a named reason and G2 refuses an unexplained skip.
- **R3 Required wdio job.** One flake in 78 runs; a red PR now blocks the
  merge. Mitigation: state-based waits; a flake gets a fix, not a retry.
- **R4 Fake host fidelity (G5).** It proves the views against the
  protocol and Claude's recorded theme, not Claude Desktop's own chrome.
  Accepted by D3.
