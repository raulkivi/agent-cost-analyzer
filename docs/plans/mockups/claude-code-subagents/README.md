# Claude Code subagent mock-ups (CS2)

**Last changed:** 2026-11-22 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Boards for task CS2 of [claude-code-subagents.md](https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/claude-code-subagents.md) (1.0 criterion C15). They amend the step 10.19 boards in [../classic-subagents/](../classic-subagents/README.md) for runs that have tokens and a priced cost but no AI Credits. The owner approves them before CS13 (web and MCP App U1) starts. Status: **approved by the owner 2026-11-15, as drawn.**

Same `.dc.html` format and `canvas.json` as the other sets; `./support.js` is not in the repo, and every state is static markup, so each board also opens in a plain browser (serve the folder over HTTP). Light (Industry) and Dark Modern, at 640 px (600 px for U1) and 320 px. All data is invented. PNG captures are in [screenshots/](screenshots/).

Every board follows the 10.19 states and the plan's honesty rules (§6): unknown is never 0; a figure never leaves a run out.

## Boards

| Board | Shows |
|---|---|
| [TurnsTable.dc.html](TurnsTable.dc.html) | Fork marker in the Turn cell (the AI Credits column is an em dash for every turn), tooltip `incl. 2.04M tokens, $0.38 priced, from 2 subagent runs`, plus matched by time, unknown run (token cells become em dashes) and one unknown field. 320 px: the tooltip text as a visible line in the details drawer. |
| [ExplanationPanel.dc.html](ExplanationPanel.dc.html) | Subagent runs block: per run model, requests, tokens, priced cost; main agent / subagent runs / turn totals; share sentence; nested run, "continued 2 times" (D2), "counted in another session" (D7), unknown run, one unknown field. |
| [KpiSubLine.dc.html](KpiSubLine.dc.html) | AI Credits tile reads n/a; a Priced cost tile carries the D12 sub-line `incl. $9.20 and 31.4M tokens from 14 subagent runs`; unknown with the reason; 3 across and 2 across. |
| [U1TurnDetail.dc.html](U1TurnDetail.dc.html) | MCP App U1 turn detail: Tokens, Cache read, Priced cost (with sub-line) and AI Credits n/a tiles, then the run list; known and unknown run. |

## Design choices to check

- The marker moves to the Turn cell: the AI Credits cell has no figure to attach it to, and Turn is a required column at every width.
- AI Credits shows an em dash (table) or n/a (tiles) with the existing reason; it never shows 0.
- Cost wording is "priced": the figure is tokens × the price book, not a bill. A "Priced" basis chip marks the block.
- A run with an unknown part never adds a smaller known total: the turn's affected cells and the turn line go unknown; the other runs stay listed.
- Wording stays "subagent runs"; "matched by time" is in the tooltip, block and run list, not in the KPI sub-line (SA0b decision 2).

## Owner decisions (2026-11-15)

Approved as drawn; each question was answered with the drawn choice.

1. Priced cost tile: added to the session KPIs for providers without AI Credits.
2. Marker stays in the Turn cell.
3. Tooltip lists tokens before cost.
4. One unknown field: only that column goes unknown.
5. "Counted in another session" row (D7) shows "not in this turn".
6. "Priced at Anthropic prices as of <date>" under every block.
7. No High Contrast frames needed before CS13.
