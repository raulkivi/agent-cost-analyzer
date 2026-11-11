# MCP Apps mock-ups (A0b MVP, A17b Increment 2, A25b Increment 3)

**Last changed:** 2026-11-11 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Boards for task A0b in [mcp-apps.md](../../mcp-apps.md) §5.6 and §7. They
show the MVP views U1, U2 and U3 inside a VS Code Copilot Chat frame and a
Claude Desktop frame, inline at about 600 px. The owner approved them
before A9 and A11 started. Status: **drawn and approved by the owner (2026-11-07).** The copy-command text `AI Credits Analyzer: Open Session <id>` is adopted.

The boards use the same `.dc.html` format as `../session-replay/` and
`../cost-by-project/`, listed in `canvas.json`. Like those sets, they
reference `./support.js`, which isn't in the repo. Every state is drawn
out as static markup, so each board also renders in a plain browser.

## Boards

| Board                                      | Shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [SessionCost.dc.html](SessionCost.dc.html) | U1 (`get_session_cost`). KPI tiles with "known for 40 of 42 turns" and an "estimate" tag. AI Credits per turn, with model-switch and compaction markers and hatched Unknown turns. Top turns with event tags, turn 17 expanded inline. The context-overhead bar. The footer `Read-only · local logs · v0.4.0` with the **Copy "open in panel" command** button, plus a frame after the copy. Drawn in VS Code Light Modern, Dark Modern and Dark High Contrast, and Claude light and dark. |
| [SpendRollup.dc.html](SpendRollup.dc.html) | U2 (`get_cost_rollup`). Daily spend columns, spend by model and by provider, and top sessions (with a hover state). The in-place drill-down into U1 with "Back to spend this week" and "Ask about this session", in VS Code dark and Claude light.                                                                                                                                                                                                                                         |
| [Findings.dc.html](Findings.dc.html)       | U3 (`list_findings`). Severity tiles, kind and severity filters, and the findings table with collapsed redacted evidence. A filtered state (Security, High and above) with one evidence block opened, in VS Code light and Claude dark. Severity uses the host's semantic colours, a shape and the written word. An observed price change carries "inferred".                                                                                                                              |
| [States.dc.html](States.dc.html)           | Unknown (never 0), partial coverage ("known for 12 of 40 turns"), estimate, errors (a failed `get_turn_series` and a failed tool), loading, narrow 360 px in both hosts, AI Credits Analyzer vs Agent Cost Analyzer branding, and the heading font with and without a local Barlow Condensed.                                                                                                                                                                                              |

### Increment 2 boards (A17b)

Drawn 2026-11-10 for task A17b in [mcp-apps.md](../../mcp-apps.md) §7.1.
Status: **drawn and approved by the owner (2026-11-10)**, with the answers in [mcp-apps.md](../../mcp-apps.md) §9.1. Two deviations from the boards: U11's waterfall shows a fall in the host's success colour (not info), and U11's "Not explained" tile reads "3 turns" with the note "no price for these turns; not counted as 0", shown only when there are such turns. A23 also drew period totals in the brand data colour instead of series-1 blue, which failed 3:1 on Claude dark (confirmed by the owner 2026-11-10).
They show U9, U10 and U11 in the same two host frames, light and dark, with
invented neutral data (local repositories by folder name).

| Board                                                | Shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CostOverTime.dc.html](CostOverTime.dc.html)         | U9 (`get_repository_cost`, `get_project_cost`). Basis tiles (preferred, billed, reported, priced) with "known for N of M turns" and one line per currency. Cost per week with documented (solid) and observed (dashed, "inferred") price-change markers, a hatched partly-known week, and a currency control. The project adds cost by vendor then model, tokens by type, and top sessions. Repository in VS Code light and dark and Claude light and dark; project in Claude light and dark. |
| [CostCompare.dc.html](CostCompare.dc.html)           | U10 (`compare_costs`). Total with share bar, signed change, cost per session, per active day and per turn, cache-hit ratio, and "Together". Repositories in VS Code, projects in Claude, each light and dark, with a hovered row.                                                                                                                                                                                                                                                             |
| [CostChange.dc.html](CostChange.dc.html)             | U11 (`explain_cost_change`). Tiles, a waterfall of usage, price and mix that adds up to the change, a per-model table with one model open to token types and unit prices, "Not explained" turns with reasons, documented price changes and the "Price changes" control (a control only; U13 is Increment 3).                                                                                                                                                                                  |
| [Increment2States.dc.html](Increment2States.dc.html) | The U10 to U9 to U1 in-place drill-down with back controls (the extension's chain stops at U9), the extension's no-projects reason, "no earlier figure", unknown and partial coverage, two currencies kept apart, an error, and narrow 360 px for U9, U10 and U11.                                                                                                                                                                                                                            |

Checks for the Increment 2 boards:

1. **Basis and currency** on every money figure; no figure is a bare number.
2. **"No earlier figure"**, never "from 0" (U10 rows, state 7).
3. **Documented vs inferred** price changes read apart in the chart and the list.
4. **Waterfall colours.** A rise uses the host's danger text colour, a fall the success text colour (owner decision 2026-11-10), each with the written sign.
5. **No projects** reason (state 6). `list_projects` returns the reason text; `get_project_cost` answers an unknown-id error. How the view gets the reason is an open question for A20.
6. **Narrow U11** hides the model table's Cost A and Cost B columns at 640 px or less (owner decision 2026-11-10, so Price fits at about 600 px) (the board drew it dropping the token-type detail); U10 moves its per-measure figures under each row.

### Increment 3 boards (A25b)

Drawn 2026-11-11 for task A25b in [mcp-apps.md](../../mcp-apps.md) §7.2. Status: **drawn and approved by the owner (2026-11-11)**, all 17 defaults in [mcp-apps.md](../../mcp-apps.md) §9.2 kept. The owner's questions, each with the default A27–A30 start on, are in [mcp-apps.md](../../mcp-apps.md) §9.2. They show U12, U4 and U5 in both host frames, light and dark, and U13 to U15 on a states board (U14 and U15 in the Claude Desktop frame only, as the standalone app is their only product). The footers use the Increment 3 target versions (v0.8.0 and v0.12.0, §7.3). All sessions, models and figures are invented.

| Board | Shows |
| ----- | ----- |
| [Replay.dc.html](Replay.dc.html) | U12 (`compare_models_for_session`, `replay_session`). Compare mode: measured row, simulated rows (hatched bars, signed change, "≥" and "known for 31 of 42 turns" for partial rows, "Unknown" for a model with no price), the own-model check and the pricing note. Replay mode: back control, a failed self-check alert, tiles, measured vs simulated per turn (solid line vs dashed line, direct labels, a gap for turns not replayed), the reasons and a collapsed assumptions list. Both modes in VS Code light and dark and Claude light and dark. "Simulated" is on every simulated figure. |
| [ToolCallAudit.dc.html](ToolCallAudit.dc.html) | U4 (`get_session_audit`, `get_audit_rollup`). Session: tiles with the failure rate over known outcomes and the unknown count, failure categories, recovery cost in tokens, retried commands and a by-tool table, in all four frames. Rollup: failed calls per day, categories, top failing commands, sessions, and the sessions left out for unrecorded tool calls, in VS Code dark and Claude light. |
| [SessionPicker.dc.html](SessionPicker.dc.html) | U5 (`list_sessions`). The pick list in all four frames (a hovered row in the dark ones), and the chat after a click in VS Code light and Claude dark, with the fixed user message "Analyse session 7f3a9c2e" and the row's "Sent" state. |
| [Increment3States.dc.html](Increment3States.dc.html) | U13 (`get_price_changes`) called directly and drilled into from U11 in place, with documented (solid) and inferred (dashed) changes apart. U14 (`get_statement`): an issued October statement with a re-run diff, and a November draft that cannot be issued yet, with unknown-cost turns. U15 (`estimate_cost`): a p50–p90 range, the same on another model ("estimate" and "Simulated"), and a refusal. U12 with an Unknown simulated cost. Narrow 360 px for U12 (compare and replay), U4, U5 (list, no match), U13, U14 and U15, and the U5 list in a host without `sendMessage`. |

Checks for the Increment 3 boards:

1. **Labels.** "Simulated" on every replay figure, "inferred" on every observed price change, "estimate" on every U15 range; basis and currency on every money figure; "Unknown" and never 0 for unpriced models, unknown-cost turns and unrecorded tool calls.
2. **Colour is never the only cue.** Measured vs simulated, documented vs inferred and the estimate range each differ by a fill pattern or dash pattern as well as paint, and carry a direct label. Rises use the host's danger text colour and falls the success colour, each with the written sign (§9.1 question 4).
3. **Read-only.** U14 has no issue control; U5 sends only the fixed template; commands and titles are logged text shown as plain text.
4. **Failed self-check** is an alert above the figures, not a footnote.

## What the owner should check

1. **Brand layering (§5.1, §5.4).** The host owns backgrounds, text,
   borders, fonts and severity colours. The brand shows only in the mark,
   the kicker, the corner marks and the data marks. There are no host
   logos, no emoji and no brand fills on large areas.
2. **The copy button.** Is "Copy "open in panel" command" the right label?
   What should it copy? The boards assume the Command Palette text
   `AI Credits Analyzer: Open Session 7f3a9c2e` (see the assumptions
   below).
3. **Density at about 600 px.** Is U1 too tall with a turn expanded? The
   top turns scroll inside the card.
4. **High Contrast.** VS Code reports Dark HC as `dark`, so the brand uses
   its dark ramp there. Check that the corners, bars and tags read well on
   black.
5. **Display rules.** Check "Unknown", "known for N of M turns",
   "estimate" and "inferred" on every board where they apply.
6. **Drill-down.** Check U2 → U1 in place and its back control, and the
   U1 turn expanded inline.

## Assumptions

- **VS Code colours are inferred.** The A0 reports record
  `var(--vscode-*)` references, not colours. The boards resolve them to
  VS Code's default Light Modern, Dark Modern and Dark High Contrast values
  (for example `editor.background` #ffffff / #1f1f1f / #000000,
  `widget.border` #e5e5e5 / #313131 / #6fc3df, `focusBorder` #005fb8 /
  #0078d4 / #f38518). A few of these are best guesses, notably the HC
  `descriptionForeground` and `editorWarning.foreground`. The font is the
  editor's UI stack (`--vscode-font-family`).
- **Claude colours are recorded.** The boards use the light or dark half
  of each recorded `light-dark()` pair. `anthropic-sans` (sent in
  `hostFonts`) isn't loaded, so the boards draw its recorded system
  fallback stack.
- **Where the frames sit.** VS Code's chat is drawn on `sideBar.background`.
  Claude's chat page is drawn on `background-tertiary` (light) or
  `background-secondary` (dark), and its app container has a
  `border-tertiary` hairline. The view itself is transparent.
- **Which product runs in which host.** VS Code shows the extension's
  server (AI Credits Analyzer v0.4.0, with the copy button). Claude Desktop
  shows the standalone server (Agent Cost Analyzer v0.11.0, no button).
  The versions are the MVP targets in §7.3.
- **The copy button.** A0 found that both hosts refuse `vscode://` links,
  so the button copies the text `AI Credits Analyzer: Open Session
<id>` for the Command Palette. The exact text is open for the owner.
- **Brand ramp (brand.css).** Light uses the `theme.css` accent ramp:
  marks #5980a6, accent text #416180, selected #2c455d, tint #eef6ff. Dark
  uses marks #749dc4, accent text #94bce3 and selected #d6ebff. A6 fixes
  the final values with contrast tests.
- **Headings** use the host font, because A0 found no local Barlow
  Condensed in either host. The States board shows both cases.
- **Increment 2 data.** Figures are invented but internally consistent: the
  waterfall effects add up, shares add up, and unit prices are AI Credits per
  1M tokens as `explain_cost_change` computes them. The extension's
  no-projects text is the real `EXTENSION_NO_PROJECTS_REASON`.
- All sessions, prompts, findings and figures are invented.
