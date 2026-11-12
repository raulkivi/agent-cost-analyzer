# Phase 12 (MCP Apps): session handover, 2026-11-10 to 2026-11-12

**Last changed:** 2026-11-12 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

This document hands the Phase 12 work over to the next session. The design, the tasks and the exit criteria are in [mcp-apps.md](mcp-apps.md). The schedule and the status are in [implementation-plan-gantt.md](../implementation-plan-gantt.md). This page gives only what a new session needs to pick the work up.

## 1. Where things stand

- **Phase 12 is complete.** `main` is at `603820e` (#226), with no open PRs and no agent worktrees.
- **MVP released 2026-11-10:** extension 0.4.0 (stable) and app 0.10.0 (#192), after A16's owner checks passed (#191).
- **Increment 2 released 2026-11-11:** extension 0.6.0 (tag `ext-v0.6.0`, stable, VS Code 1.146 required) and app 0.11.0 (tag `app-v0.11.0`). The extension passed the real-Copilot gate on `964e9a8` (22/22 required tests). A24 is replaced by the automated checks of step 10.17 ([release-ui-gate.md](release-ui-gate.md)). Extension 0.5.0 (pre-release, #197) is superseded.
- **Increment 3 released 2026-11-12:** extension 0.8.0 (stable; VS Code Marketplace, Open VSX and GitHub, tag `ext-v0.8.0`) and app 0.12.0 (tag `app-v0.12.0`), both on `dacf3ed`. The real-Copilot gate passed 33 of 33 required tests (1.54 AI Credits).
- **Unreleased on `main`:** the keyboard-focus fix after a drill-down loads (#226; both CHANGELOGs, `[Unreleased]` → Fixed). It ships with the next release.
- **Step 10.17 done 2026-11-11** (#202–#212): every pre-release UI check is a wdio or Playwright spec; a ruleset on `main` requires 9 CI checks; an extension release needs a passing real-Copilot run recorded as a git note on the tagged commit. Docs-only PRs skip the heavy jobs (#221).
- **Step 10.18 done** (#209): Copilot chats from windows with no folder open now appear.
- **Root README is for users** (#226); the developer doc index is [docs/README.md](../README.md).

## 2. PRs in Phase 12

| PR | Tasks |
|---|---|
| #175, #176 | Plan; A1–A4 foundations (turn series, brand injection and identity, web exports) |
| #178 | A8: `registerAppViews`, `get_turn_series`, `_meta.ui` on three tools |
| #180, #181 | A0: spike kit; the owner's spike results |
| #182 | A0b: mock-up boards, approved by the owner |
| #183 | A5: `packages/mcp-apps` scaffold (single-file Vite build, `AppHostPort`, router, bundle budget) |
| #184 | A6 theme layering; A7 view models |
| #185 | The owner's Gantt cleanup |
| #186 | A9 U1 `SessionCostView`; A11 U3 `FindingsView` |
| #187 | A10 U2 `CostRollupView`; A13 packaging and wiring |
| #188 | A14 a11y and security review; A15 docs; the copy-flow fix (decision A) |
| #189 | A16 owner's checklist |
| #190–#192 | Handover; A16 owner's checks and 12 fixes; MVP release (ext 0.4.0, app 0.10.0) |
| #193 | Increment 2 wave 1: A17b boards, A17 web exports, A18 view models, A19 `_meta.ui` on the four cost-analysis tools |
| #194 | Increment 2 wave 2: A20 U9, A21 U10, A22 U11, the U11 error-text and pricing-note fix, visual QA fixes, CHANGELOG entries |
| #195 | A17b boards approved; the owner's answers in mcp-apps.md §9.1 |
| #196 | A23 accessibility and security review of U9–U11, docs, A24 checklist; U11 table drops costs A and B from 640 px |
| #197 | Extension 0.5.0 pre-release |
| #198 | READMEs list the MCP views and link the standalone app |
| #199 | Status after A23 and the 0.5.0 pre-release |
| #200–#212 | Step 10.17, the automated pre-release UI gate (G0–G7), replacing A24; #209 is step 10.18 |
| #213–#217 | Increment 2 release (ext 0.6.0, app 0.11.0); VS Code 1.146 required (D9); real-Copilot suite on 1.146 (D12) |
| #218 | A26: `_meta.ui` on the eight Increment 3 tools |
| #219 | A25: view models for replay, price changes, statement and estimate |
| #220 | A25b: Increment 3 boards and the owner's questions (§9.2) |
| #221 | CI skips the heavy jobs on docs-only PRs |
| #222 | A27–A32: U12, U13, U14/U15, U4/U5, fullscreen, and their review |
| #223 | A33: Increment 3 checks as specs; real Copilot Chat 33/33 |
| #225 | Increment 3 release (ext 0.8.0, app 0.12.0) |
| #226 | User-oriented root README; the keyboard-focus fix |

## 3. Owner decisions (all recorded in mcp-apps.md)

- **Bundle budget is 1.2 MiB** (1,258,291 bytes; raised from 900 KiB on 2026-11-11 instead of lazy chunks; mcp-apps.md §10). `test/bundle-size.test.ts` asserts it. `dist/views.html` is 957,451 bytes (935 KiB) with every view.
- **Copy flow, decision A (§4.4):**
  - The extension shows **AI Credits Analyzer: Open Session…** in the Command Palette. Run with no id, it opens a QuickPick of sessions (newest first; title, time, provider, AI Credits; the id in the detail line).
  - U1's button **Copy title to open in panel** copies the session title (one line, no control characters, at most 120 chars; the id when there is no title).
  - The title goes to the clipboard on purpose: it reaches the user, never the model.
- **Copy flow, decision B, deferred (§11):** a one-click open through an app-only tool and a local server-to-extension channel. It needs a threat-model entry.
- **U5 and U2 messages (Q7, 2026-11-11):** try `sendMessage`, then fall back to "Ask in the chat: Analyse session <id>".
- **Mock-ups:** the A0b, A17b and A25b boards are approved. A deviation from them is fine when the PR body lists it.

## 4. Open owner decisions

- **U5's "Sent" label:** VS Code 1.146 only stages `Analyse session <id>` in the chat input, unsent (mcp-apps.md §6.1).
- **Claude Desktop permission prompts** for view-initiated calls; outside the release gate (§6.1).
- **Standalone app download:** users clone the repo and run `npm start`; decide whether to publish a download.
- **threat-model.md §5.8** (open since 2026-11-06): code-owner review on `main`, `ext-v*` tag protection, `release` environment reviewers, CODEOWNERS for `fixtures/` and `services/pricing/`.
- **Open VSX trusted publisher** not registered: `release-extension.yml` still uses the `OVSX_PAT` environment secret. Register it at open-vsx.org, switch to trusted publishing, delete `OVSX_PAT`.
- **`npm audit` dev tree** (the wdio-vscode-service chain) accepted for dev only (threat-model §7).

## 5. Key implementation facts

- **Packages:**
  - `packages/mcp-apps` holds the views. It depends on `domain` and on web's presentational exports, never on `server`.
  - `packages/server/src/mcp/apps/` holds `registerAppViews`, `resolveAppViews`, `FileViewSource`, `injectBrand` and `toViewBrand`.
- **Wiring:**
  - Extension: the build copies the views to `dist/mcp-apps/views.html`, and `createCopilotMcpServer({ appViewsHtml })` uses them.
  - Standalone: `scripts/mcp-server.sh` passes `--app-views-html` when the built file exists.
  - A missing file means no views group and no `_meta.ui`, with one stderr line.
- **Tool counts** (unchanged by Increment 3):
  - Standalone: 22 with views, 21 without; 15 tools carry `_meta.ui`.
  - Extension: 20 with views, 19 without; 13 tools carry `_meta.ui` (no `get_statement`, no `estimate_cost`).
  - The extension integration test (`src/test/integration/extension.test.ts`) expects 20.
- **Router order:** `toolInfo.tool.name`, then `hostContext.toolCall.toolName` (VS Code sends only this), then the shape of the result.
- **Security guards in `packages/mcp-apps`:**
  - `test/security/no-forwarding.test.ts` is a static scan of every host call site:
    - one `sendMessage` site (the `Analyse session <id>` template, plain ids only), shared by U2 and U5;
    - no `openLink` and no `updateModelContext`;
    - only the reviewed tool calls and `requestDisplayMode`;
    - no HTML or network sinks;
    - the clipboard only through `sessionSearchText(vm.sessionId, vm.title)`.
  - `bindHostTheme` filters host style variables: only `--*` keys pass, and `url(`/`image(`/`expression(` and `;{}<>@\` are dropped.
- **Test helpers:** axe (`axe-core` 4.14.0, dev only), `keyboard.test.tsx`, and `exerciseEveryControl` for the dynamic security tests. The fake MCP Apps host for Playwright is in `packages/mcp-apps/e2e/`. The visual harness is `packages/mcp-apps/test/visual/`, built on demand and not in the bundle.
- **Contrast tests** cover the fallbacks, the recorded Claude set, and VS Code Light Modern, Dark Modern, Dark High Contrast and Light High Contrast (`test/theme/host-sets.ts`; the High Contrast sets recorded by wdio in #204).
- **Open security items:** host fonts (`applyHostFonts` injects the host's `@font-face` as given) and host trust (mcp-apps.md §6.1).

## 6. Follow-ups (not scheduled)

- U12's row hover puts muted text at 4.38:1 on VS Code Dark Modern; VS Code callout backgrounds can't be tested (§6.1).
- Watch CI for the `a16-session-views` keyboard flake; if it recurs, the layout-effect fix missed the cause.
- mcp-apps.md §11: SDK 2 / ext-apps 2.x, U16/U17, shorter content for UI clients, Learn cards (U8), one-click Open (decision B).
- The real-Copilot suite tests only VS Code's local harness; sessions from the SDK harness (1.146's default) are unchecked there.
- CSS class prefixes per view are a convention, with no test that each view uses its own (U10/U11 once collided).
- The no-projects reason is copied in `views/cost-compare/no-projects.ts` and parsed from the server's text in `views/cost-over-time/explain-error.ts`; a server wording change breaks both silently.

## 7. Releasing the extension

1. A version-bump PR (both CHANGELOGs: retitle `[Unreleased]`), merged by the owner.
2. Check that `engines.vscode` still matches current stable VS Code (D9). A VS Code bump means rerunning the real suite (R5: 1.146 changed the Copilot harness default).
3. On the merged commit, the owner runs `npm run build`, then
   `COPILOT_E2E=1 COPILOT_E2E_USER_DATA_DIR=~/.cache/aica-copilot-e2e/user-data xvfb-run -a npm run test:ui:vscode:copilot --workspace=packages/vscode-extension`
   (33 tests, about 1.6 AI Credits, cap 3, about 26 minutes).
4. `npm run release:evidence --workspace=packages/vscode-extension`, then `git push origin refs/notes/release-ui`.
5. Push the tags (`ext-v*`, `app-v*`); the owner approves the `release` environment.

An agent running the real suite uses `env -u WAYLAND_DISPLAY` with xvfb, keeps the 3-credit cap, and resets `refs/notes/release-ui` afterwards.

## 8. How this session worked

- **Subagents in worktrees.** Each task ran in an isolated worktree on a local branch, based on the designated branch's tip. Subagents never push. Launch them from the repo root so worktrees don't nest.
- **One PR per wave.** I merged the subagents' branches into a wave branch, reconciled the docs and the Gantt counts, ran the checks, and opened one PR per wave.
- **Stacked PRs:** retarget the child to `main` before the parent merges; a deleted base branch closed #224.
- **Worktrees have no `node_modules`.** `@agent-cost-analyzer/*` then resolves to the main checkout, and stale vite caches can make tests pass against old code. Briefs tell agents to run `npm ci --prefer-offline` in the worktree first; the coordinator reruns every check on the integrated branch in the main checkout.
- **Shared brief.** Agents read one common brief (setup, reading list, rules, checks, report) plus a task paragraph.
- **Merging is the owner's.** Merge a PR only when the owner asks; never approve the `release` environment.
- **Playwright MCP writes `.playwright-mcp/` into the main checkout**, even from a worktree; delete it before committing. Screenshots stay in the session scratchpad, never in the repo.
- **PR tracking.** Subscribe to PR activity and set a 50-minute check-in. After the owner squash-merges, main equals the PR head, so check that `git diff HEAD origin/main` is empty, then merge main back into a still-open branch with `-s ours`.
- **Checks before a push.** Run these from the repo root and check each exit code rather than grepping the output:
  - `npm run headers:check`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm run test:scripts`
  - `npm -w packages/mcp-apps test`
  - `npm -w packages/server test`
  - `cd packages/vscode-extension && npm test`

  A missed SPDX header once broke CI because the check's output had been grepped. The extension integration suite and the wdio suites need a VS Code download, so only CI runs them.
- **Doc conventions:**
  - Every updated doc gets **Last changed** and **Source** in its header.
  - The Gantt is updated in the same change as the status, including the bars, percentages, Open items and the detail chart.
  - Each PR body follows `.github/pull_request_template.md`.

## 9. Next candidates

- **Phase 11** (pi real-capture verification): blocked on the owner's real pi sessions; the first step is to write capture instructions.
- **Owner reviews still open:** Phase 13 (13.8 eyes-on), Phase 14 (14.8 docs, §13 exit on real sessions), Phase 15 (docs review, exit on real data).
- The open owner decisions in §4.
