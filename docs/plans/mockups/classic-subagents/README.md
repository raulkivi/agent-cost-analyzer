# Classic subagent credits mock-ups (SA0b)

**Last changed:** 2026-11-12 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Boards for task SA0b of step 10.19 in
[classic-subagent-credits-implementation.md](../../local/classic-subagent-credits-implementation.md) §6.
The owner approves them before SA13 (web panel), SA14 (MCP App U1) and SA15
(extension) start. Status: **drawn, awaiting owner approval.**

Same `.dc.html` format as `../mcp-apps/` and `../session-replay/`, listed in
`canvas.json`. Like those sets, the boards reference `./support.js`, which is
not in the repo; every state is static markup, so each board also opens in a
plain browser. All data is invented.

Every board draws the four states: **known**, **0.00 run**, **unknown run**
(with the reason) and **matched by time**, in Light, Dark Modern and High
Contrast, at 640 px and 320 px. Unknown is never shown as 0.

## Boards

| Board | Shows |
|---|---|
| [TurnsTable.dc.html](TurnsTable.dc.html) | Fork marker after the AI Credits value, tooltip text per state (`incl. 42.06 AI Credits from 2 subagents`), cumulative column staying unknown after an unknown turn. 320 px: details drawer with the tooltip text as a visible line. |
| [ExplanationPanel.dc.html](ExplanationPanel.dc.html) | "Subagents this turn" block: a row per run (label, agent, model, requests, AI Credits), "matched by time" pill, dashed unknown row with its reason, main agent / subagents / turn totals line, and the sentence naming the share. |
| [KpiAndSessionsTooltip.dc.html](KpiAndSessionsTooltip.dc.html) | Session AI Credits tile sub-line from `subagentSpend` (D12), 4 across and 2x2; the Sessions tree tooltip with the added line. |
| [TurnInspector.dc.html](TurnInspector.dc.html) | The D4 note under the inspector header, with a button back to the Explanation block. |
| [U1TurnDetail.dc.html](U1TurnDetail.dc.html) | MCP App U1 turn detail in a VS Code Copilot Chat frame: tile sub-line plus a Subagent runs list. |

## Design choices to check

- Marker: a fork glyph with an accessible name that says the words; dashed for unknown. The tree tooltip is plain text, so it has no glyph.
- Rounds column stays the main agent's (D1); the runs' requests appear in the block.
- The turn's total line shows the main agent's own figure (D10) so it stays readable when a run is unknown.

## Open questions for the owner

1. Marker when every run is 0.00: still show it (drawn: yes, tooltip "incl. 0.00 AI Credits from 1 subagent"), or hide it as noise?
2. "Matched by time" in the Turns table tooltip, the KPI sub-line and the inspector note (drawn: yes everywhere), or only in the Explanation block?
3. Unknown turn cell: em dash plus dashed marker (drawn), or the word "unknown"? The cumulative column already uses an em dash.
4. Sessions tooltip when the session is unknown because of an unplaceable orphan: show the reason sentence (drawn), or only "AI Credits unknown"?
5. Inspector button "See subagents this turn": keep, or text note only?
6. Narrow layout has no hover: the tooltip text is a visible line in the details drawer (drawn). OK?
7. Agent column: label and agent are both shown (`runSubagent-Explore · Explore`). Show the agent name only, with the label in a tooltip?
8. KPI sub-line wording: "incl. 54.65 from 3 subagent runs" (plan) versus the table's "subagents". Align to "subagent runs" everywhere?
