# Dense ledger UI: a density pass, then a standalone ledger theme

**Last changed:** 2026-11-14 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

**Status: planned; P0 (docs) done 2026-11-14; owner decisions D1-D4 accepted 2026-11-14; P1-P7 and L1-L6 not started.** Phase 17 in
[implementation-plan.md](../implementation-plan.md).

The question this answers: **"Why does the web UI need so much scrolling,
and can it look like a terminal ledger?"** Increment 1 makes the layout
dense in every host. Increment 2 gives the standalone app a pi.dev-style
theme with light and dark modes.

## Contents

1. Why
2. Goals and non-goals
3. What exists
4. Design
5. Owner decisions
6. Tasks
7. Parallelism and working setup
8. Risks
9. Exit criterion
10. Review
11. Session log

## 1. Why

- The review of the standalone app found it wastes space (baseline in §3).
- The same `theme.css` serves the VS Code panel and the MCP Apps views, so
  density helps every host.
- The owner approved the density pass first (option 1), then a "terminal
  ledger" theme (option 2).

## 2. Goals and non-goals

**Goals**

- G1. The Dashboard fits in about 60% of today's height at 1440x900.
- G2. Tables, tiles, lists and controls use the space a reader can scan
  without scrolling sideways.
- G3. Light and dark modes in the standalone app, default Auto (D4), both
  passing axe colour contrast.
- G4. Commit Mono and Source Serif 4 as the standalone fonts (D3).

**Non-goals**

- Changing the VS Code panel's or the MCP views' colours and fonts (D1).
- New features, new data or new views.
- Removing "unknown" or "estimate" labels (architecture constraint 6). Only
  explanations may move into a tooltip or footnote; "N of M turns known"
  stays visible.
- Changing `brand.css` or the MCP Apps bundle's font ban.

## 3. What exists

Baseline on the e2e fixture at 1440x900:

- Dashboard: 2,444px tall.
- Stat tiles: 256px tall (the Cost tile's note).
- Table rows: 52px (Dashboard), 36px (Learn).
- Session cards: 88-120px each, in a 520px box that also scrolls sideways.
- Controls: up to five stacked rows, plus a separate status line.
- Trend chart: SVG 100px wide inside a 940px panel.
- Empty panels take full grid cells.

## 4. Design

- `theme.css` is imported by the standalone app, the VS Code webview
  (`theme-vscode.css` overrides tokens under `body.vscode-*`) and MCP Apps
  (`packages/mcp-apps/src/main.tsx`, with `brand.css` duplicating the light
  hex values; checked by `test/theme/theme-files.test.ts`).
  - The new palette and fonts live under a standalone-only attribute
    selector. The base `:root` stays as the Industry set, the VS Code and
    MCP fallback.
- The switch is `html[data-color-mode="light|dark"]`, set only when the
  transport is HTTP (`api-client/select-transport.ts`). MCP Apps already
  uses `html[data-theme]`.
- `theme-vscode.test.ts` requires every derived `:root` token to be
  redeclared in the VS Code token rule.
  - New tokens go under `[data-color-mode]`, not `:root`.
  - Only `--font-mono` and `--font-prose` fall back in `:root`, mapped in
    VS Code to `--vscode-editor-font-family` and `--vscode-font-family`.
- Contrast: `theme-contrast.test.ts` reads only the first `:root`. The
  harness gains "standalone-light" and "standalone-dark" themes that
  resolve `:root` plus the `[data-color-mode]` overrides. Text-safe roles
  meet 4.5:1, marks 3:1.
- Fonts come only through `@fontsource` imports in `fonts.ts`. The
  extension build strips them with `omitModulesPlugin(/^@fontsource\//)`.
  - Never add `@font-face` to `theme.css`: `extension-build.test.ts` and
    `mcp-apps/test/bundle-size.test.ts` ban it.
  - `vite-plugins/standalone-build.test.ts` pins the font files and is
    updated in L1.
- Selectors that specs use keep their names: `label.seg-opt`,
  `.card-kicker`, `.chart-tooltip-*`, `.savings-*`, `.app-status` (hidden
  in VS Code). `App.test.tsx` expects the text "status: ok".
- Ledger palette (L1), modelled on pi.dev:
  - Dark: canvas `#161d27`, panel `#212730`.
  - Light: parchment `#ebe7e4`, panel `#f4f2f0`.
  - One blue accent plus rust, alpha hairlines, radius 0.
  - Dark-mode series reuse the dark steps from `theme-vscode.css`.

## 5. Owner decisions

| # | Decision | Outcome |
|---|---|---|
| D1 | Scope | **Accepted 2026-11-14:** Density changes apply in every host. The new palette, dark mode and fonts apply to the standalone app only. The VS Code panel and the MCP views keep their host themes |
| D2 | Sequencing | **Accepted 2026-11-14:** Restyle first. Step 10.22 tasks 1.10-1.14 (final takes, docs embedding) are held until Phase 17 merges, then recorded once |
| D3 | Fonts | **Accepted 2026-11-14:** `@fontsource/commit-mono` (OFL-1.1, v5.3.0) for numbers, tables, labels and controls; `@fontsource/source-serif-4` (OFL-1.1) for explanation prose only; Barlow dropped from the standalone build |
| D4 | Default theme | **Accepted 2026-11-14:** Auto (follows `prefers-color-scheme`), with an Auto/Light/Dark switch in the header |

## 6. Tasks

TDD in every code task: the failing test first (architecture.md §11.4).
Every new file gets the SPDX header. No local model in this repo.

**Increment 1: density, all hosts** (one PR with its own docs, Gantt and
CHANGELOG updates)

| ID | Work | Exit criterion | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| P0 | **Done 2026-11-14.** Docs: this plan; the implementation-plan.md Phase 17 section, overall-status line and dependency graph (Mermaid source and regenerated `.drawio.svg`); the Gantt bar, detail chart and Open items note that step 10.22 tasks 1.10-1.14 are held | Docs reviewed; Gantt updated | low | Sonnet | — |
| P1 | Tokens and base density in `theme.css`: `--space-1..8` to 2/4/6/8/12/16px; body 13px; headings h1 28 / h2 22 / h3 18 / h4 15; `.table th,td` padding 4px 8px (rows at most 28px); `.seg-opt` 4px 10px; `.input` min-height 28px; `.audit-section` and card padding 8px; grid gaps 8px | `theme.test.ts` asserts the scale and table padding; full suite green | medium | Sonnet | P0 |
| P2 | One toolbar row: move the status/version line (`App.tsx`) into the header as a muted `.app-status` tag, keeping the class and the "status: ok" text; on the Dashboard the h3, range seg, `ViewSwitch` and cost-basis seg share one wrapping `.toolbar` row (`InsightsDashboard.tsx`) | Unit tests for header placement and the toolbar; `App.test.tsx` "status: ok" still passes | medium | Sonnet | P1 |
| P3 | Session and scenario list (`SessionList.tsx`): compact two-line rows with the kicker inline with the meta and no Blueprint per item; the list fills the viewport (sticky, `calc(100vh - header)`) instead of `maxHeight:520`; `overflow-x: hidden`; keep `.card-kicker`, keyboard navigation and focus | `SessionList.test.tsx` updated first; Playwright: no horizontal scroll in the list | medium | Sonnet | P1 |
| P4 | KPI strip and Savings rows: `.stat-tile` value 18px; the Cost note's conversion text (`AI_CREDIT_CONVERSION_NOTE`) moves to one footnote under the strip while "N of M turns known" stays in the tile; Savings rows put the amount right after the title column (max-width grid), not at the far edge | Tile height at most 80px (e2e); InsightsDashboard and Savings tests | low | Sonnet | P1 |
| P5 | Charts and empties: `TrendColumns.tsx` takes the container width (viewBox plus a capped bar width); empty `HorizontalBars` render one muted line with no legend and their grid cell collapses (`.audit-grid-2`); Learn `SourcesFooter` goes inside a `<details>` showing the count | `TrendColumns`, `HorizontalBars` and `SourcesFooter` tests first | medium | Sonnet | P1 |
| P6 | Move inline `fontSize`/`margin`/`padding` styles in App, AppHeader, SessionList, ExplanationPanel, InsightsDashboard and TurnInspector into token-based classes, so `theme.css` controls density | No visual change beyond the P1 tokens; suite green | low | Haiku | P2-P5 |
| P7 | Playwright `density.spec.ts` (fixture, 1440x900): Dashboard `scrollHeight` at most 1,470px; first KPI top at most 260px; table rows at most 30px; no horizontal overflow on the page or the list; the 360px layout still works. Add CHANGELOG `[Unreleased] Changed` to the root and extension changelogs (the panel gets denser) | Spec green locally and in CI (`web-e2e`); wdio `layout-theme` green in CI | medium | Sonnet | P6 |

**Increment 2: ledger theme, standalone only**

| ID | Work | Exit criterion | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| L1 | Theme architecture: `html[data-color-mode=dark]` and `[light]` token sets in `theme.css` (palette in §4); `--font-mono` and `--font-prose` tokens; `fonts.ts` imports Commit Mono (400/700) and Source Serif 4 (400/600) and drops Barlow, `package.json` deps updated; `THIRD-PARTY-NOTICES.md` with the OFL notices; `theme-contrast.test.ts` gains standalone-light and standalone-dark themes; a new test that every ledger rule is scoped under `[data-color-mode]` (mirrors the `theme-vscode` scoping test); `standalone-build.test.ts` updated for the new font files | Contrast tests for both modes green; extension and MCP build tests unchanged and green; the `brand.css` test untouched | high | Opus | Increment 1 merged |
| L2 | Colour-mode switch: pure `resolveColorMode(pref, prefersDark)` in `lib/`; `ColorModeSwitch` (Auto/Light/Dark `SegmentedControl`) in `AppHeader`, HTTP transport only; preference kept in `localStorage` (try/catch); `matchMedia` listener for Auto; attribute set in `main.tsx` before the first render (no flash) | Unit tests for the resolver, the switch and host gating; the webview never gets the attribute | medium | Sonnet | L1 |
| L3 | Ledger component rules under `[data-color-mode]`: no corner marks; mono uppercase 11px labels with 0.12em tracking (`th`, `.card-kicker`, `.stat-tile-label`, `h6`); mono tabular numbers (`.table td`, `.stat-tile-value`, chart axes, `.hbar-value`); serif prose (`.insights-narrative`, ExplanationPanel body, Learn explanation); mono headings; faint grid texture on `body` only; bare `monospace` uses in `theme.css` become `var(--font-mono)` | `theme.test.ts` rule assertions; contrast green | medium | Sonnet | L1 |
| L4 | Playwright: a `colorScheme: 'dark'` project running the axe specs with contrast on; `color-mode.spec.ts` covering the switch, persistence, Auto following the emulated scheme and no flash; checks that the MCP views and the VS Code panel don't change (existing mcp-apps e2e and wdio `layout-theme` stay green) | Both colour schemes pass axe; CI green | medium | Sonnet | L2, L3 |
| L5 | Docs and media: `architecture.md` §4.2 and §13 (dark theme now in scope, standalone); `vision.md` §3.3; Phase 8 marked "superseded for the standalone app by Phase 17"; User Guide colour-mode section; root CHANGELOG `[Unreleased] Added/Changed`; regenerate the app screenshots (`packages/web/e2e/support/screenshots.mts`) and the panel stills (`scripts/ui-check/screenshots.mts`, density only); Gantt: Phase 17 at 100% and step 10.22 un-held | Docs reviewed; images refreshed | medium | Sonnet | L4 |
| L6 | Review: `/code-review` at high effort on the branch; live check at 1440x900 and 360px in light and dark against the exit metrics; before/after screenshots in the PR | Findings fixed or recorded in §10 | medium | Opus | L5 |

## 7. Parallelism and working setup

- Worktree off `origin/main`: `git worktree add ../aca-phase17 -b claude/phase17-dense-ui origin/main`, then `npm ci`. The main checkout is in use by step 10.22; don't touch it.
- Each task runs in a Claude subagent with the model listed.
- Two PRs, one per increment. Merge automatically when checks and review are clean.
- P2-P5 run in parallel worktrees after P1. P2 and P5 both touch `App.tsx`, so P2 merges first.
- L2 and L3 run in parallel after L1.
- Only the coordinator edits the Gantt.

## 8. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Demo retakes: step 10.22 has recorded scenes in the old look | Wasted takes, mixed looks in the docs | D2: tasks 1.10-1.14 are held until Phase 17 merges; the scenes are retaken once |
| The density change reaches the VS Code panel (D1) | wdio `layout-theme` and the panel stills change | P7 runs wdio `layout-theme` in CI; L5 regenerates the panel stills |
| The contrast harness reads only the first `:root` | Ledger colours go unchecked | L1 extends the harness with standalone-light and standalone-dark before any palette lands |
| Ledger rules leak out of `[data-color-mode]` | VS Code or MCP colours change | L1 scoping test; the existing theme-vscode, brand and bundle tests stay unmodified |
| Moving explanations out of tiles hides "unknown" or "estimate" | Breaks constraint 6 | P4 keeps "N of M turns known" in the tile; labels asserted in tests |
| Fonts added to the extension or MCP bundle | Build tests fail, bundle grows | Fonts only through `@fontsource` in `fonts.ts`; no `@font-face` in `theme.css` |

## 9. Exit criterion

On the e2e fixture at 1440x900:

- The Dashboard is at most 1,470px tall.
- Table rows are at most 30px.
- KPI tiles are at most 80px.
- The list has no sideways scroll.
- Light and dark both pass axe colour contrast.
- The VS Code panel and the MCP views keep their colours and fonts: their contrast, brand and wdio tests pass unmodified.
- All suites are green.
- The owner has reviewed it by eye.

After merge, step 10.22 resumes at 1.10 (retakes in the new look).

## 10. Review

(Empty until L6.)

## 11. Session log

- 2026-11-14: plan written and D1-D4 accepted; worktree `../aca-phase17` (branch `claude/phase17-dense-ui`) created; P0 done.
