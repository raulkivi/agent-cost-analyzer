# VS Code extension mock-ups

**Last changed:** 2026-11-12 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Boards in the `.dc.html` format, listed in `canvas.json`. They reference `./support.js`, which isn't in the repo. Every state is static markup, so each board also renders in a plain browser. All figures are invented.

## Boards

| Board | Shows |
| --- | --- |
| `Main.dc.html` | Session analysis: sidebar, panel and status bar. |
| `FirstRun.dc.html`, `Walkthrough.dc.html` | First run with logging disabled; the Get Started walkthrough. |
| `Narrow.dc.html`, `States.dc.html`, `Dashboard.dc.html` | Narrow panel; loading, empty and error states; Insights dashboard and Findings tree. |
| `MonthlyAllowance.dc.html` | Step 10.21, task MA0b (see below). **Drawn 2026-11-12, awaiting owner approval** before MA5 and MA6. |

## MonthlyAllowance.dc.html

Plan: [monthly-allowance.md](../../monthly-allowance.md) §3.4, §3.8, §5, §10, §13.

- **Status bar.** Eight states plus "Not set" and "Required config warning", each in Dark Modern, Light Modern and Dark High Contrast: normal, near limit, over, partial ("at least"), near and partial, over and partial, all unknown, no sessions this period. Today's item sits to its left. Words and icon carry the state; only `statusBarItem.warningBackground` and `errorBackground` are used.
- **Tooltips.** Plain-text tooltip for each of the eight states.
- **Sessions view.** The header row with a day group below it (partial, near, over) and alone (no sessions), in three themes.
- **Settings editor.** The three settings under the User tab, in three themes.
- **Narrow status bar.** Truncation at 760, 540, 440 and 340 px windows, planned text against an alternative with the figure first.
- **Screen-reader labels.** Visible text and `ariaLabel` for every state, plus the Sessions row.

### Open questions for the owner

1. **Wording order.** The planned text puts the state word first ("Near limit: 812.40 of 1,000 AI Credits"). The 40 vw cap clips it at about "812.40 of 1,000 AI Cre…". Alternative drawn: "812.40 of 1,000 AI Credits · near limit". Keep the plan's text or switch?
2. **Combined states.** Plan §3.4 says "At least …" for partial data, §3.8 gives "Near limit: …" and "Over: …". Drawn: "Near limit: at least 812.40 …" and "Over: at least 1,042.10 …". OK?
3. **Percent in the text.** §3.4's example shows "(31 %)", §3.8's does not. Drawn without, to save width; the percent is in the tooltip and the aria label.
4. **Number format.** Drawn with thousands separators ("1,000", "1,042.10"). Today's item uses `toFixed(2)` without them. Use locale formatting for both?
5. **Sessions row with no sessions.** Drawn as the row alone. Should the existing empty-state message also show, and should the row stay while a filter hides all sessions?
6. **Sessions row wording.** "This month: near limit, 812.40 of 1,000 AI Credits" as label with "· 12 days left" as description. Fine, or one string?
7. **Settings titles.** The editor generates "Monthly Allowance: AI Credits", "Reset Day", "Warn At Percent" from the ids. Accept, or add a category title?
8. **Colours.** Warning and error backgrounds are VS Code's theme defaults as drawn from memory; MA5 verifies them and the contrast (white text) in a live window.
9. **Hide menu.** The gauge gets its own id and name (plan §13c). Proposed name: "AI Credits: monthly allowance".
