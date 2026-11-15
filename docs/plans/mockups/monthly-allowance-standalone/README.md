# Monthly allowance mock-ups (standalone app)

**Last changed:** 2026-11-15 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Boards for task MS0 in [monthly-allowance-standalone.md](../../monthly-allowance-standalone.md) §5 (1.0 criterion C9). **Drawn 2026-11-15, awaiting owner approval** before MS7 (the UI code). MS1 to MS6 and MS9 do not wait for them.

Same `.dc.html` format as [../savings-report/](../savings-report/README.md), listed in `canvas.json`. They reference `./support.js`, which isn't in the repo; every state is static markup, so each board also renders in a plain browser. All figures are invented.

Every board shows the standalone ledger theme (Phase 17) twice, **light** then **dark**, with the real tokens from `packages/web/src/theme.css`: parchment and canvas grounds, hairline borders, square corners, Commit Mono for the UI, Source Serif 4 for prose. Analyze mode only. The meter uses the existing accent, `status-interrupted` (near) and `status-error` (over) marks; no new color token.

## Boards

| Board | Shows |
| --- | --- |
| `Header.dc.html` | Header at 1440 px, one strip per state of plan §4.7: normal, near limit, over, partial (normal, near, over), unknown, no sessions, no Copilot logs, not set. Also keyboard focus, Learn mode (no gauge, no source select), and a no-meter alternative. |
| `Details.dc.html` | Details dialog: known near limit, known over with reset day 15, partial ("at least", coverage, may be higher), unknown, no sessions, no Copilot logs. Each has the by-harness split where sessions exist, the VS Code variant, the period with its zone, and the "Not counted" list. |
| `Settings.dc.html` | Settings dialog: not set, filled, server 400 on two fields (nothing saved), Remove allowance. |
| `Narrow.dc.html` | 320 px and 768 px headers (partial near, over, unknown, no logs, not set), the details and settings dialogs full width at 320 px. |
| `A11y.dc.html` | The aria-label of the gauge for each state, focus order of the header and both dialogs, announcements, contrast notes. |

PNGs of every board section are in `screenshots/` (`<Board>-light.png`, `<Board>-dark.png`).

## How the honesty rules are drawn

- **Figure first, level last, in words.** "812.40 of 1,000 AI Credits · near limit". Color only adds to the words.
- **At least.** "at least 812.40 of 1,000 AI Credits". On the meter the fill ends in a hatched, dashed open end: the figure is never drawn exact.
- **Unknown, no sessions, no logs.** Words only, no meter, no percentage, never "0 of".
- **Over.** The fill is full and a cap sticks out past the end; a tick marks the warn percentage.
- **Not set.** A muted button "Set monthly allowance", no figure, no color, no banner (D6).
- **No percentage in the header,** as in the extension's status bar. The details give "81 % of the allowance used" ("At least 81 %" when partial).
- **Remaining** reads "Up to 187.60 AI Credits remain" (an upper bound, since used is a lower bound) and "No AI Credits remain" when over.

## Regenerating

`node scripts/ms0-allowance-build-boards.mjs` rewrites the five boards. `node scripts/ms0-allowance-screenshots.mjs` renders the PNGs (Playwright Chromium; uses the app's bundled fonts from `node_modules` when present) and prints each board's height for `canvas.json`.

## Open questions for the owner

1. **Meter.** Plan §4.7 says "a meter, if the mock-up has one". Drawn: a 56 px ruler with a warn tick, a hatched open end for "at least" and an overflow cap for "over". A no-meter alternative is at the bottom of `Header.dc.html`. Keep the meter?
2. **Header crowding at 1440 px.** The longest state ("at least 1,042.10 of 1,000 AI Credits · over" plus meter, about 390 px) does not fit beside the existing controls. Drawn: the Source select is capped at 150 px with an ellipsis (full label in its tooltip), and the status text truncates first. Alternatives: let the header wrap at this width, or move the status text into the Config tag's tooltip. Which?
3. **Narrow level word.** Plan §4.7 drops the level word at the narrow breakpoint and keeps it in the details and aria-label. That leaves near and over to the meter alone on screen. Drawn per the plan, plus an alternative keeping a short "near" or "over". Recommended: keep the short word. Which?
4. **Remove allowance** is one click with no confirm step, because retyping the number restores it and the reset day and warn percent are kept. Add a confirm?
5. **Details dialog lists "Not counted"** (pruned logs, spend elsewhere, start-time attribution, no Claude Code or pi credits) in every state with data. Keep it always visible, or collapse it behind a disclosure?
6. **Change allowance** closes the details and opens the settings dialog; closing settings returns focus to the gauge. Fine, or should settings return to the details?
7. **Copy.** New wording to approve: "No Copilot Chat logs found on this machine." (no source), "No Copilot session started in this period on this machine." (no sessions), "No session this month has cost data, so no total is shown. Unknown is not 0." (unknown), the settings hint "Set it to match your GitHub billing page. Stored in this app's settings folder only.", the placeholder "a number above 0" (no plan amount is suggested), and the 400 messages.
8. **Harness row with no sessions.** The over example shows "0 of 0 · none" for Agent Host and Copilot CLI. Hide an empty harness row instead?
9. **Not set in every provider.** "Set monthly allowance" shows in Analyze mode whichever provider is active (D5, D6). Confirmed?
10. **Source select label.** The real label is "VS Code (local Copilot Chat)", used on the boards. The gauge's VS Code variant ("VS Code" or "VS Code Insiders") appears only in the details.
