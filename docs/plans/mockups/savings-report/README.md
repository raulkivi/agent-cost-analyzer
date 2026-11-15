# Savings report mock-ups

**Last changed:** 2026-11-15 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Boards for task SR11 in [savings-report.md](../../savings-report.md) §9. **Drawn 2026-11-13, awaiting owner approval** before any UI code (SR12 onward). U18 (the MCP App view) is Increment 2 and has no board here.

Same `.dc.html` format as `../session-replay/`, listed in `canvas.json`. They reference `./support.js`, which isn't in the repo. Every state is static markup, so each board also renders in a plain browser. All figures are invented. Action texts are the exact output of the templates in `packages/domain/src/savings-actions.ts` (numbers print without thousands separators there, so the boards do too); amounts, sessions and session titles are made up.

The standalone app has one theme (Industry, light), so it is drawn light only. The extension is drawn in Dark Modern, Light Modern and Dark High Contrast.

## Boards

| Board | Shows |
| --- | --- |
| `Dashboard.dc.html` | Standalone Savings tab, 1440 px. Filters, then one ranked list per currency (AI Credits, US dollars), the Simulated section, Not analysed with reasons. Range rows read "6.2–38.4 AI Credits per week", upper-bound rows "up to 46.0 AI Credits per week", an unpriced row "Not priced" with its reason. |
| `Detail.dc.html` | List with one row selected and its detail: amount and "over the 30 days", how the range is set, evidence, "inferred" server grouping, per-tool "estimate" tokens, action text with Copy, sessions, price versions. |
| `DetailMore.dc.html` | Three more details: Claude Code idle cache with the 1-hour sentence in dollars; failed calls (upper bound, requests unknown, no lower bound); Simulated with self-check, coverage and assumption A1. |
| `States.dc.html` | Loading with Cancel, cancelled, empty window, nothing found, error with Retry, a provider without request trace or tool inventory, every amount unknown. |
| `Narrow.dc.html` | Standalone at 320 px: list, Simulated and Not analysed, detail replacing the list. |
| `VsCodeDark.dc.html`, `VsCodeLight.dc.html`, `VsCodeHC.dc.html` | Extension panel, wide: Copilot sessions only, list and detail side by side. High Contrast uses borders and hatching, never colour alone. |
| `VsCodeNarrow.dc.html` | Extension at 320 px, list and detail in all three themes. |
| `VsCodeStates.dc.html` | Extension states in Dark Modern: loading, empty, error, every amount unknown, nothing found, cancelled. |

## How the honesty rules are drawn

- **Bar.** Solid from 0 to the low end (likely), hatched from low to high (possible). An upper bound is all hatched: no lower bound is claimed. Meaning is in the words and the pattern, not the colour.
- **Unknown.** "Not priced" with the reason; the row sits below the ranked ones, unranked, never a 0.
- **Labels.** "inferred" and "estimate" are dashed tags; "Simulated" is a dashed tag in the accent colour; the Simulated section has no rank numbers and is not added to anything.
- **No grand total** (D4). The note under the filters says why.
- **Actions** are text plus Copy only; "Suggestion only. This app does not change settings or files." sits beside the button (D6).
- **Coverage** on every row: "38 of 41 sessions; 3 had no request trace".

## Open questions for the owner

1. **Currencies.** Amounts are per currency. Drawn: a ranked list per currency (AI Credits, then US dollars), each ranked by its high end. Alternative: one list filtered by a currency control. Keep the two lists?
2. **Unpriced rows.** Drawn at the bottom of their currency list, unranked, with the reason. OK, or hide them behind "Not analysed"?
3. **Bar scale.** Each list scales bars to its own largest high end. The bars compare rows within a list only; that is not stated on the board. Add a caption, or drop the bars and keep the words?
4. **Group naming.** The template reads "Turn off the tools of the github MCP server in the tool picker". Drawn with `group` = "the github MCP server". Wording fine?
5. **Number format.** Action text prints "5400" and "412000" (the template does no grouping), while amounts and tables use "5,400". Add thousands separators to the templates?
6. **Simulated row.** Subject reads "Refactor token cache on claude-haiku-5.5" and the amount is per week like the others. Should a Simulated amount show per session instead, since it is a replay of named sessions?
7. **Include simulated.** Drawn as a checkbox, on. The plan says off by default in MCP; in the app a replay per session is the slow part. Default on or off?
8. **Session links.** Standalone: "Open in Analyze". Extension: "Open session". Same wording in both?
9. **Extension scope note.** The extension shows "GitHub Copilot sessions only" as a tag and a line saying Claude Code and pi savings are in the standalone app. Keep that pointer?
10. **Price versions.** Drawn as an open disclosure with one id. Collapsed by default, as the plan's "on demand" suggests?
11. **Tab placement.** The standalone tab is drawn after Billing; the extension tab after Dashboard in the panel view switcher. Both are guesses at the final tab order.

## Savings Increment 3 amendments (V23b)

Amended 2026-11-15 for task V23b in [savings-increment-3.md](../../savings-increment-3.md) §10, **awaiting owner approval** before V24-V26's UI code (D32). The Increment 1-2 boards stay approved; only the parts below changed. Names, titles, dates and amounts are invented. The U18 amendments are in [`../mcp-apps/Savings.dc.html`](../mcp-apps/README.md).

| Board | Amended |
| --- | --- |
| `Detail.dc.html` | Session list: title (or the id alone), id, date, the session's saving with its label, Open in Analyze; the third row has no title. Per-tool list: whole inferred names, "loaded in N sessions", "about" tokens with "estimate", "and 18 more". New board note: where titles stop (V25), with the text the tool returns for the same three sessions. |
| `DetailMore.dc.html` | The same list on the three other rows: dollars with "up to", AI Credits "up to", and the Simulated row (ranges, "Simulated" tag). Only sessions without titles show the id first. |
| `Narrow.dc.html`, `VsCodeNarrow.dc.html` | At 320 px: title on its own line, then id, date, saving and the link wrapping under it. Detail panes made taller for the longer list. |
| `VsCodeDark.dc.html`, `VsCodeLight.dc.html`, `VsCodeHC.dc.html` | Copilot titles from the extension's dataset (D25), date, saving, "Open session". High Contrast keeps words and borders, no color cues. |
| `States.dc.html` | Two new tiles: pi with a request trace (V28, after 1.0) where the unchecked-sessions list used to be, with the shared-prefix coverage reason (D27), `write` unused (V27) and a local model "Not priced"; and the session list edge cases (title not found, "date unknown", one session "Not priced"). |

### Open questions for the owner (V23b)

1. **Session saving per row.** Drawn as the saving over the 30 days (the row's own "Over the 30 days" figure), not per week, as D22 says. A weekly rate of one session is meaningless; keep?
2. **Title above id.** Drawn title first, id and date under it in muted text. The id is how you ask the tools about that session. Prefer id first?
3. **Missing title.** The id alone, bold, no placeholder text such as "untitled". Keep?
4. **Unpriced session.** "Not priced" in place of the amount; the reason shows once under the list, not per row. Per row instead?
5. **Tool list length.** Five tools and "and 18 more" (the text answer's 5; the result carries up to 20, the 18 is the group's 23 minus 5). Show all 20 behind a disclosure?
6. **Tokens for "and 18 more".** "about 2,885" is the row's 5,400 minus the five listed, so it includes the 3 tools past the result's 20. Keep, or drop the figure?
7. **Dates.** "Nov 11" in the viewer's time zone in the views, ISO `2026-11-11` in the tool's text. Year omitted inside the window; add the year for windows over 90 days?
8. **Board note placement.** The titles boundary is a board note on `Detail.dc.html`, not product copy. Should the app also say once that titles are looked up on this device? Drawn: no.
9. **pi tile.** Drawn with the V28 trace although V28 is after 1.0, so you can see what replaces the unchecked-sessions list. OK as a post-1.0 reference, or remove it from the 1.0 board set?
