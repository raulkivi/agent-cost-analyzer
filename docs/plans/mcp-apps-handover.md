# Phase 12 (MCP Apps): session handover, 2026-11-07

**Last changed:** 2026-11-07 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

This document hands the Phase 12 work over to the next session. The design, the tasks and the exit criteria are in [mcp-apps.md](mcp-apps.md). The schedule and the status are in [implementation-plan-gantt.md](../implementation-plan-gantt.md). This page gives only what a new session needs to pick the work up.

## 1. Where things stand

- **MVP code and docs are on `main`:** A0–A11 and A13–A15. A12, the deep link, was dropped because both hosts refuse `vscode://` links. The status is 16 of 36 tasks (44%).
- **Next:** A16. These are the owner's manual checks in VS Code Copilot Chat, Claude Desktop and Claude Code, with a results table. The script is [mcp-apps-a16-checklist.md](mcp-apps-a16-checklist.md). The owner sends the results back, either pasted in chat or as a filled table plus PNGs in `docs/plans/mcp-apps-a16-results/`.
- **When A16 passes:**
  - mark A16 done in mcp-apps.md §7 and in the Gantt;
  - put the A16 screenshots into the User Guide and the extension guide (both have a "screenshots follow (A16)" note);
  - prepare the MVP release, extension 0.4.0 and app 0.11.0 (§7.3);
  - then start Increment 2 with A17b, the mock-ups the owner approves.
- **When A16 fails:** fix each reported issue test-first, in one PR per batch.
- **Open PRs:** none. **Running subagents:** none. **Worktrees:** none. Branch `claude/cost-analysis-repos-projects-s8dvnf` is even with `main` in content.

## 2. Merged PRs this session

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

## 3. Owner decisions (all recorded in mcp-apps.md)

- **Bundle budget is 900 KiB** (was 450 KiB): ext-apps pulls in zod, and dependencies are not patched. `dist/views.html` is about 760 KB.
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
- **One PR per wave.** I merged the subagents' branches into `claude/cost-analysis-repos-projects-s8dvnf`, reconciled the docs and the Gantt counts, ran the checks, and opened one PR per wave.
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
