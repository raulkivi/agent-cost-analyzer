# MCP Apps MVP mock-ups (A0b)

**Last changed:** 2026-11-07 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Boards for task A0b in [mcp-apps.md](../../mcp-apps.md) §5.6 and §7. They
show the MVP views U1, U2 and U3 inside a VS Code Copilot Chat frame and a
Claude Desktop frame, inline at about 600 px. The owner approves them
before A9 and A11 start. Status: **drawn and approved by the owner (2026-11-07).** The copy-command text `AI Credits Analyzer: Open Session <id>` is adopted.

The boards use the same `.dc.html` format as `../session-replay/` and
`../cost-by-project/`, listed in `canvas.json`. Like those sets, they
reference `./support.js`, which isn't in the repo. Every state is drawn
out as static markup, so each board also renders in a plain browser.

## Boards

| Board | Shows |
|---|---|
| [SessionCost.dc.html](SessionCost.dc.html) | U1 (`get_session_cost`). KPI tiles with "known for 40 of 42 turns" and an "estimate" tag. AI Credits per turn, with model-switch and compaction markers and hatched Unknown turns. Top turns with event tags, turn 17 expanded inline. The context-overhead bar. The footer `Read-only · local logs · v0.4.0` with the **Copy "open in panel" command** button, plus a frame after the copy. Drawn in VS Code Light Modern, Dark Modern and Dark High Contrast, and Claude light and dark. |
| [SpendRollup.dc.html](SpendRollup.dc.html) | U2 (`get_cost_rollup`). Daily spend columns, spend by model and by provider, and top sessions (with a hover state). The in-place drill-down into U1 with "Back to spend this week" and "Ask about this session", in VS Code dark and Claude light. |
| [Findings.dc.html](Findings.dc.html) | U3 (`list_findings`). Severity tiles, kind and severity filters, and the findings table with collapsed redacted evidence. A filtered state (Security, High and above) with one evidence block opened, in VS Code light and Claude dark. Severity uses the host's semantic colours, a shape and the written word. An observed price change carries "inferred". |
| [States.dc.html](States.dc.html) | Unknown (never 0), partial coverage ("known for 12 of 40 turns"), estimate, errors (a failed `get_turn_series` and a failed tool), loading, narrow 360 px in both hosts, AI Credits Analyzer vs Agent Cost Analyzer branding, and the heading font with and without a local Barlow Condensed. |

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
- All sessions, prompts, findings and figures are invented.
