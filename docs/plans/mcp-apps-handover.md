# Phase 12 (MCP Apps): session handover, 2026-11-10

**Last changed:** 2026-11-11 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

This document hands the Phase 12 work over to the next session. The design, the tasks and the exit criteria are in [mcp-apps.md](mcp-apps.md). The schedule and the status are in [implementation-plan-gantt.md](../implementation-plan-gantt.md). This page gives only what a new session needs to pick the work up.

## 1. Where things stand

- **MVP released 2026-11-10:** extension 0.4.0 (stable) and app 0.10.0 (#192), after A16's owner checks passed (#191).
- **Increment 2 built and merged to `main` 2026-11-10:** A17, A18, A19 (PR #193) and A20, A21, A22 (PR #194, merged into #193's branch first). Status 25 of 36 tasks (69%).
- **A17b boards approved 2026-11-10** with the owner's answers in mcp-apps.md §9.1: defaults kept except question 4 (a fall uses the host's success colour) and U11's "Not explained" tile wording. A23 applied both.
- **Next:**
  - step 10.17 G4-G6 replace A24 (the owner's checks of U9–U11 in VS Code Copilot Chat and Claude Desktop; see [release-ui-gate.md](release-ui-gate.md)); the 0.5.0 pre-release stays published. Owner answers after A23 (mcp-apps.md §9.1): period totals keep the brand data colour; U11's table drops costs A and B from 640 px; the High Contrast colour sets are recorded by wdio (G6, replacing checklist step 1.7a) and added to the contrast tests;
  - extension 0.5.0 published 2026-11-10 on the Marketplace pre-release channel (#197);
  - then the Increment 2 release: extension 0.6.0, app 0.11.0.
- **Release:** the owner asked about an extension 0.4.1; not planned, since `main` has no fixes to 0.4.0, only Increment 2 features (0.6.0 after A24, or a 0.5.0 pre-release).
- **A23 done 2026-11-10** (findings in mcp-apps.md §6.1 and the A23 row). The visual-pass inputs it worked from, all closed:
  - U9's y-axis top label sits tight against the left edge beside a price-change marker.
  - U11's "Not explained" tile reads "0 + 3 turns, no priced figure, not 0". Owner decision: value "3 turns", note "no price for these turns; not counted as 0".
  - U11's "lowers cost" blue is close to the period-total blue. Owner decision (question 4): a fall uses the host's success colour.
  - CSS class names collided between U10 and U11 in the single bundle (`cc-total`, `cc-sub`, `cc-note`); fixed by renaming, but a test that each view's classes use its own prefix would stop a repeat.
  - The no-projects reason is copied in `views/cost-compare/no-projects.ts` and parsed from the server's text in `views/cost-over-time/explain-error.ts`; a server wording change breaks both silently (the generic error still shows the text).
  - U9 has no focusable price-change markers; the detail is in the list below the chart and the chart's accessible name.
- **Open PRs:** A23 (branch `claude/a23-review-docs`). **Running subagents:** none. **Worktrees:** the session's agent worktrees under `.claude/worktrees/` can be removed.

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

## 3. Owner decisions (all recorded in mcp-apps.md)

- **Bundle budget is 900 KiB** (was 450 KiB): ext-apps pulls in zod, and dependencies are not patched. `dist/views.html` is 862 KB (842 KiB) with U1–U3 and U9–U11; Increment 3 will likely need lazy chunks or a higher budget (decide at A27).
- **Copy flow, decision A (§4.4):**
  - The extension shows **AI Credits Analyzer: Open Session…** in the Command Palette. Run with no id, it opens a QuickPick of sessions (newest first; title, time, provider, AI Credits; the id in the detail line).
  - U1's button **Copy title to open in panel** copies the session title (one line, no control characters, at most 120 chars; the id when there is no title).
  - The title goes to the clipboard on purpose: it reaches the user, never the model.
- **Copy flow, decision B, deferred (§11):** a one-click open through an app-only tool and a local server-to-extension channel. It needs a threat-model entry.
- **Mock-ups:** the A0b boards are approved. A deviation from them is fine when the PR body lists it.

## 4. Key implementation facts

- **Packages:**
  - `packages/mcp-apps` holds the views. It depends on `domain` and on web's presentational exports, never on `server`.
  - `packages/server/src/mcp/apps/` holds `registerAppViews`, `resolveAppViews`, `FileViewSource`, `injectBrand` and `toViewBrand`.
- **Wiring:**
  - Extension: the build copies the views to `dist/mcp-apps/views.html`, and `createCopilotMcpServer({ appViewsHtml })` uses them.
  - Standalone: `scripts/mcp-server.sh` passes `--app-views-html` when the built file exists.
  - A missing file means no views group and no `_meta.ui`, with one stderr line.
- **Tool counts:**
  - Standalone: 22 with views, 21 without.
  - Extension: 20 with views, 19 without.
  - The extension integration test (`src/test/integration/extension.test.ts`) expects 20.
- **Router order:** `toolInfo.tool.name`, then `hostContext.toolCall.toolName` (VS Code sends only this), then the shape of the result.
- **Security guards in `packages/mcp-apps`:**
  - `test/security/no-forwarding.test.ts` is a static scan of every host call site:
    - one `sendMessage` (the `Analyse session <id>` template, plain ids only);
    - no `openLink` and no `updateModelContext`;
    - four reviewed tool calls;
    - no HTML or network sinks;
    - the clipboard only through `sessionSearchText(vm.sessionId, vm.title)`.
  - `bindHostTheme` filters host style variables: only `--*` keys pass, and `url(`/`image(`/`expression(` and `;{}<>@\` are dropped.
- **Test helpers:** axe (`axe-core` 4.14.0, dev only), `keyboard.test.tsx`, and `exerciseEveryControl` for the dynamic security tests. The visual harness is `packages/mcp-apps/test/visual/`, built on demand and not in the bundle.
- **Open security items:** host fonts (`applyHostFonts` injects the host's `@font-face` as given) and host trust. Both are in mcp-apps.md §6.1.
- **Not covered by tests:** Light High Contrast was never recorded in A0, so no contrast test covers it.

## 5. How this session worked

- **Subagents in worktrees.** Each task ran in an isolated worktree on a local branch, based on the designated branch's tip. Subagents never push.
- **One PR per wave.** I merged the subagents' branches into a wave branch (2026-11-10: `claude/phase12-increment2-wave1`, then `claude/phase12-increment2-wave2` stacked on it), reconciled the docs and the Gantt counts, ran the checks, and opened one PR per wave.
- **Worktrees have no `node_modules` (found 2026-11-10).** `@agent-cost-analyzer/*` then resolves to the main checkout, and stale vite caches can make tests pass against old code. Wave 2 briefs told agents to run `npm ci --prefer-offline` in the worktree first; the coordinator re-ran every check on the integrated branch in the main checkout.
- **Shared brief.** Wave 2's agents read one common brief (setup, reading list, rules, checks, report) plus a task paragraph; keep doing that for A23 onwards.
- **Merging is the owner's.** The permission classifier blocks Claude from merging PRs.
- **Playwright MCP writes `.playwright-mcp/` into the main checkout**, even from a worktree; delete it before committing. Screenshots stay in the session scratchpad, never in the repo.
- **PR tracking.** I subscribed to PR activity, set a 50-minute `send_later` check-in, squash-merged when green with `expectedHeadSha` set to the full 40-character sha, and then merged main back into the branch.
  - Main equals the PR head after a squash merge, so I first checked that `git diff HEAD origin/main` was empty, then merged with `-s ours`.
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

## 6. Small leftovers

- `README.md` called Phase 12 "planned". This handover commit fixes that line.
- The #182 squash title says "owner approval open". The approval came later, in the same PR (mcp-apps.md §7 row A0b).
