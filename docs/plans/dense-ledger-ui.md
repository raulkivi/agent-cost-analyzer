# Dense ledger UI: a density pass, then a standalone ledger theme

**Last changed:** 2026-11-14 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

**Status: Increment 1 (P0-P7) done 2026-11-14; owner decisions D1-D4 accepted 2026-11-14; Increment 2 (L1-L6) done 2026-11-14. Exit criterion met except the owner's eyes-on review.** Phase 17 in
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
- Built in Increment 2 beyond the first design:
  - An extra `--color-control-border` token. The alpha hairlines are too
    faint for control outlines (3:1 needed), so buttons, inputs, segments and
    filter chips use it, with `var(--color-divider)` as the fallback outside
    ledger mode.
  - Dark-mode overrides for hard-coded alert and list-box colours that the
    token sets did not reach.
  - Density tuning L3 needed in ledger mode so the Increment 1 limits still
    hold: UI text 12px, tables 12px/1.3, tighter stat tile padding, turns
    table cells 4px and headers 10px.
  - `colorMode` host capability (`host-capabilities.ts`): true only for the
    HTTP transport, so the webview and MCP Apps never show the switch or get
    the attribute. The preference is stored under `localStorage` key
    `aca.colorMode` (try/catch).
  - An inline `<head>` script in `packages/web/index.html` sets the attribute
    before the first paint (L6: `main.tsx` ran after it). Only the standalone
    app loads that page; the webview builds its own (`panel-html.ts`).
    `color-mode.test.ts` runs the script against `resolveColorMode`.
  - Playwright projects `light` and `dark` (`colorScheme`) run the axe specs;
    `color-mode.spec.ts` runs in `light` only.

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
| P1 | **Done 2026-11-14.** Tokens and base density in `theme.css`: `--space-1..8` to 2/4/6/8/12/16px; body 13px; headings h1 28 / h2 22 / h3 18 / h4 15; `.table th,td` padding 4px 8px (rows at most 28px); `.seg-opt` 4px 10px; `.input` min-height 28px; `.audit-section` and card padding 8px; grid gaps 8px | `theme.test.ts` asserts the scale and table padding; full suite green | medium | Sonnet | P0 |
| P2 | **Done 2026-11-14.** One toolbar row: move the status/version line (`App.tsx`) into the header as a muted `.app-status` tag, keeping the class and the "status: ok" text; on the Dashboard the h3, range seg, `ViewSwitch` and cost-basis seg share one wrapping `.toolbar` row (`InsightsDashboard.tsx`) | Unit tests for header placement and the toolbar; `App.test.tsx` "status: ok" still passes | medium | Sonnet | P1 |
| P3 | **Done 2026-11-14.** Session and scenario list (`SessionList.tsx`): compact two-line rows with the kicker inline with the meta and no Blueprint per item; the list fills the viewport (sticky, `calc(100vh - header)`) instead of `maxHeight:520`; `overflow-x: hidden`; keep `.card-kicker`, keyboard navigation and focus | `SessionList.test.tsx` updated first; Playwright: no horizontal scroll in the list | medium | Sonnet | P1 |
| P4 | **Done 2026-11-14.** KPI strip and Savings rows: `.stat-tile` value 18px; the Cost note's conversion text (`AI_CREDIT_CONVERSION_NOTE`) moves to one footnote under the strip while "N of M turns known" stays in the tile; Savings rows put the amount right after the title column (max-width grid), not at the far edge | Tile height at most 80px (e2e); InsightsDashboard and Savings tests | low | Sonnet | P1 |
| P5 | **Done 2026-11-14.** Charts and empties: `TrendColumns.tsx` takes the container width (viewBox plus a capped bar width); empty `HorizontalBars` render one muted line with no legend and their grid cell collapses (`.audit-grid-2`); Learn `SourcesFooter` goes inside a `<details>` showing the count | `TrendColumns`, `HorizontalBars` and `SourcesFooter` tests first | medium | Sonnet | P1 |
| P6 | **Done 2026-11-14.** Ran on Sonnet, not Haiku: it also took the remaining density fixes the live measurement found (table-cell buttons, findings kind inline, wide Cost tile, turns table fit). Move inline `fontSize`/`margin`/`padding` styles in App, AppHeader, SessionList, ExplanationPanel, InsightsDashboard and TurnInspector into token-based classes, so `theme.css` controls density | No visual change beyond the P1 tokens; suite green | low | Haiku | P2-P5 |
| P7 | **Done 2026-11-14.** Playwright `density.spec.ts` (fixture, 1440x900): Dashboard `scrollHeight` at most 1,470px; first KPI top at most 340px (plan said 260; measured 296 with the toolbar and the narrative above it); table rows at most 30px; no horizontal overflow on the page or the list; the 360px layout still works. Add CHANGELOG `[Unreleased] Changed` to the root and extension changelogs (the panel gets denser) | Spec green locally and in CI (`web-e2e`); wdio `layout-theme` green in CI | medium | Sonnet | P6 |

**Increment 2: ledger theme, standalone only**

| ID | Work | Exit criterion | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| L1 | **Done 2026-11-14.** Theme architecture: `html[data-color-mode=dark]` and `[light]` token sets in `theme.css` (palette in §4); `--font-mono` and `--font-prose` tokens; `fonts.ts` imports Commit Mono (400/700) and Source Serif 4 (400/600) and drops Barlow, `package.json` deps updated; `THIRD-PARTY-NOTICES.md` with the OFL notices; `theme-contrast.test.ts` gains standalone-light and standalone-dark themes; a new test that every ledger rule is scoped under `[data-color-mode]` (mirrors the `theme-vscode` scoping test); `standalone-build.test.ts` updated for the new font files | Contrast tests for both modes green; extension and MCP build tests unchanged and green; the `brand.css` test untouched | high | Opus | Increment 1 merged |
| L2 | **Done 2026-11-14.** Colour-mode switch: pure `resolveColorMode(pref, prefersDark)` in `lib/`; `ColorModeSwitch` (Auto/Light/Dark `SegmentedControl`) in `AppHeader`, HTTP transport only; preference kept in `localStorage` (try/catch); `matchMedia` listener for Auto; attribute set in `main.tsx` before the first render (no flash) | Unit tests for the resolver, the switch and host gating; the webview never gets the attribute | medium | Sonnet | L1 |
| L3 | **Done 2026-11-14.** Ledger component rules under `[data-color-mode]`: no corner marks; mono uppercase 11px labels with 0.12em tracking (`th`, `.card-kicker`, `.stat-tile-label`, `h6`); mono tabular numbers (`.table td`, `.stat-tile-value`, chart axes, `.hbar-value`); serif prose (`.insights-narrative`, ExplanationPanel body, Learn explanation); mono headings; faint grid texture on `body` only; bare `monospace` uses in `theme.css` become `var(--font-mono)` | `theme.test.ts` rule assertions; contrast green | medium | Sonnet | L1 |
| L4 | **Done 2026-11-14.** Playwright: a `colorScheme: 'dark'` project running the axe specs with contrast on; `color-mode.spec.ts` covering the switch, persistence, Auto following the emulated scheme and no flash; checks that the MCP views and the VS Code panel don't change (existing mcp-apps e2e and wdio `layout-theme` stay green) | Both colour schemes pass axe; CI green | medium | Sonnet | L2, L3 |
| L5 | **Done 2026-11-14.** Docs and media: `architecture.md` §4.2 and §13 (dark theme now in scope, standalone); `vision.md` §3.3; Phase 8 marked "superseded for the standalone app by Phase 17"; User Guide colour-mode section; root CHANGELOG `[Unreleased] Added/Changed`; regenerate the app screenshots (`packages/web/e2e/support/screenshots.mts`) and the panel stills (`scripts/ui-check/screenshots.mts`, density only); Gantt: Phase 17 at 100% and step 10.22 un-held | Docs reviewed; images refreshed | medium | Sonnet | L4 |
| L6 | **Done 2026-11-14.** Review: `/code-review` at high effort on the branch; live check at 1440x900 and 360px in light and dark against the exit metrics; before/after screenshots in the PR | Findings fixed or recorded in §10 | medium | Opus | L5 |

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

L6, 2026-11-14: `/code-review` at high effort on `origin/main...HEAD`, a
hand review, and a live check of the fixture at 1440x900 and 360x800 in
light and dark (Learn with a turn selected, Analyze Turns, Tool audit, All
sessions, every Dashboard view, the Billing export dialog, the Projects
editor, the colour switch). The Config dialog was not reachable: the
fixture has no config warnings, so Config is a tag.

**Findings**

| # | Severity | Where | Finding | Status |
|---|---|---|---|---|
| 1 | Medium | `packages/web/index.html:6` | Light flash in dark mode: `main.tsx` is a module script, so first paint (12-40 ms) came before the attribute (62-223 ms). The old e2e check only proved "before React". | Fixed: inline `<head>` script; `color-mode.test.ts` runs it against `resolveColorMode`; `color-mode.spec.ts` now requires the attribute before `<body>` exists |
| 2 | Medium | `theme.css:1187` | `html[data-color-mode] .table th` outranked `.cost-compare-table tbody th`, so Compare's project names turned into muted uppercase labels | Fixed: ledger rule restores body text; `theme-color-mode.test.ts` |
| 3 | Medium | `theme.css:1207` | Focus ring invisible on a checked segment: keyboard focus lands on the checked option, and its accent ring sat on the accent fill (1:1 dark, 1.3:1 light). Affects every `SegmentedControl`, the colour switch too | Fixed in ledger mode: ring in `--color-bg` on the fill; `theme-contrast.test.ts` requires 3:1. The Industry `:root` has the same pair (pre-existing, hosts unchanged per D1) |
| 4 | Low | `theme.css:1192-1194` | Compare at 360px: the Details buttons sat 10-21px past the scroll box's edge and looked cut off (reachable by scrolling; Industry 2px) | Fixed: less header tracking, slimmer Details button; `density.spec.ts` asserts no sideways scroll |
| 5 | Low | `AuditRollupPanel.tsx:175,206` | All sessions at 360px: the Sessions table pushed the page to 452px (412px before the ledger) | Fixed: both tables in `.table-scroll`; unit test and `density.spec.ts` |
| 6 | Low | `theme-contrast.test.ts:140` | The harness read only `html[data-color-mode="…"]` rules, not the L3 `html[data-color-mode]` ones, so `.card-kicker` and `.table th` were checked with their base colours | Fixed, with a test. Not vacuous: breaking dark `--color-text-muted` failed 10 tests and `--color-control-border` 2; restored |
| 7 | Low | `theme.css:1234` | `.dialog-body` serif reached the radios, checkboxes, labels and preview of the statement and advice export dialogs (D3: serif is for prose) | Fixed: `.dialog-body > p` only |
| 8 | Low | `theme.css:1169` | Headings and `--font-heading-weight` ask for 600 but Commit Mono ships 400 and 700 here, so they render 700; weight 500 renders 400 | Recorded: bundle `commit-mono/latin-600.css` or declare 700 |
| 9 | Low | `theme.css:291-307, 772` | Hard-coded light colours (alert red, white list box, QlikView greys) are patched per selector for dark; light ledger keeps a white list box on parchment | Recorded: move to tokens in a follow-up |
| 10 | Low | `use-color-mode.ts` | No `storage` listener: other open tabs keep the old mode until reload | Recorded |
| 11 | Low | `host/current-host-capabilities.ts:16` | Unit tests rendering `App` use the standalone default (`colorMode: true`), so they set the attribute on jsdom's root and read real `localStorage` | Recorded |
| 12 | Info | `main.tsx:30`, `use-color-mode.ts:13`, `index.html` | The guarded `localStorage` accessor is written twice, and the head script mirrors `color-mode.ts` (pinned by a test) | Recorded |
| 13 | Info | `theme.css:1079, 1109` | No italic faces are bundled, so italics are synthesized | Recorded |
| 14 | Info | `theme.css:99-101` | `:root` still names Barlow, which no build bundles now; webview and MCP map their own fonts, and the standalone app always has the attribute | Recorded |

Checked and fine: host gating (the webview and MCP views never get the
attribute; `no-color-mode.test.ts`), storage errors, the `matchMedia`
listener's removal on Auto to explicit, every ledger rule scoped, no
`@font-face` in `theme.css`, fonts only in `fonts.ts`, the
`SegmentedControl` radiogroup (only the colour switch passes `label`; the
other radiogroup wrappers hold unlabelled controls, so no nesting),
`THIRD-PARTY-NOTICES.md` against the installed packages, the lockfile diff
(font packages only). Keyboard: arrow keys move Auto, Light, Dark, apply
and persist. The Findings table at 360px scrolls inside its own box, by
design.

**Measurements** (fixture, 1440x900)

- Dashboard height: 1,467px in light and dark, 3px under the 1,470px limit.
  Proposed fix, not applied: in ledger mode tighten `.hbar-row` (line-height
  1.3, padding 2px). The 7-row Tokens by model chart sets the height of its
  grid row, so this gains about 20px without hiding anything. Next option:
  narrative at 13px/1.4 (about 15px).
- KPI tiles 79px, first tile top 326px, table rows at most 30px, no
  sideways scroll in the list or at 360px: `density.spec.ts` green in both
  projects.
- Learn list titles at 240px, truncated, with the average share of the
  title shown: mono 12px (now) 15 of 18 (73%); mono 11px 13 of 18 (80%);
  serif 13px 12 of 18 (84%); serif 12px 11 of 18 (87%); Industry 12 of 18
  (82%). Recommendation: keep mono (D3 keeps serif for prose) and add the
  full title as a `title` tooltip; serif 13px if the owner prefers
  Industry-level legibility in the list.

## 11. Session log

- 2026-11-14: plan written and D1-D4 accepted; worktree `../aca-phase17` (branch `claude/phase17-dense-ui`) created; P0 done.
- 2026-11-14: Increment 2 L1-L4 merged; L5 (docs and media) done: architecture.md, vision.md, implementation-plan.md, User Guide, root CHANGELOG, Gantt, and the standalone app screenshots regenerated in ledger light. The VS Code panel stills (`scripts/ui-check/screenshots.mts`) are not regenerated here: they are retaken with step 10.22's final takes (D2). `screenshots.mts` regenerated 16 images; the other standalone stills (`landing-page.png`, `learn-scenario.png` and the older `guide-*.png`) come from step 10.22's still harness (task 1.9) and still show the Industry look until those retakes. L6 review next.
- 2026-11-14: L6 review done: 7 findings fixed test-first, 7 recorded (§10); Dashboard 1,467px in both modes. Open: the owner's eyes-on review, then merge; step 10.22 resumes at 1.10.
