# Subagent tool-call audit mock-ups (ST2)

**Last changed:** 2026-11-15 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Boards for task ST2 of step 10.20 in
[subagent-tool-audit.md](../../subagent-tool-audit.md) §5.7. The owner approves
them before ST12 (web and extension webview) and ST13 (MCP App U4 and findings
view) start. Status: **approved by the owner 2026-11-15.**

Same `.dc.html` format as `../classic-subagents/`, listed in `canvas.json`. The
boards reference `./support.js`, which is not in the repo; every state is static
markup, so each board also opens in a plain browser. Full-page screenshots are in
`screenshots/`. All data is invented (one session: 214 calls, 131 by the main
agent, 83 by three read subagent runs, two more runs unread).

Every board draws Light (Industry), Dark Modern and High Contrast, at 640 px and
320 px (U4: a Copilot Chat host at about 600 px and 320 px). The fork marker and
the "matched by time" pill follow the approved 10.19 boards. Unknown is never
shown as 0.

## Boards

| Board | Shows | States |
|---|---|---|
| [AuditTab.dc.html](AuditTab.dc.html) | `SessionAuditPanel`: KPI sub-line, Calls by agent split, Agent filter chips, Agent column, Subagent runs table | Known, Unread runs, Matched by time, Nested (Agent Host) |
| [AuditRollup.dc.html](AuditRollup.dc.html) | `AuditRollupPanel`: totals split, Subagent calls column, sessions with unread runs and reasons | Known, Sessions with unread runs |
| [ExplanationBlock.dc.html](ExplanationBlock.dc.html) | Subagents this turn block with calls and failed per run; tool calls grouped by run | Known, Run with 0 calls, Unread run, Matched by time |
| [ToolsCell.dc.html](ToolsCell.dc.html) | Turns table Tools cell: marker, failed badge, tooltip (drawer line at 320 px) | Known, Unread run, Matched by time, No runs |
| [FindingRow.dc.html](FindingRow.dc.html) | Finding rows naming the run: web Insights table, expanded finding, MCP App findings view | Main agent, subagent, matched by time, behavior change |
| [U4AuditView.dc.html](U4AuditView.dc.html) | MCP App U4: tiles, split, runs list, Agent column on failing commands | Known, Unread runs, Matched by time |

## Design choices to check

- The Agent column shows the agent name (as approved for 10.19 run rows); the label only when there is no agent name.
- Exit code and evidence move under the command so the Agent column fits at 640 px; the real table scrolls sideways today.
- Unread runs get a dashed frame, an em dash and the reason sentence from plan §6.

## Open questions for the owner

1. "Calls by agent" split bar on the Audit tab, the rollup and U4: keep (drawn), or only the KPI sub-line and the filter chips (plan §5.7 lists no bar)?
2. Agent filter as its own chip group (drawn, left rule) or merged into the outcome chips?
3. Sessions from a provider with no subagent concept (pi): "n/a" (drawn), 0, or blank?
4. "Matched by time" pill: drawn in the runs tables, grouped calls, the calls table Agent cell, the Tools tooltip and finding rows. Keep, or limit as in 10.19 (Explanation block, run lists and the turns tooltip only)?
5. The expanded finding has a "Show run's calls" button (new interaction, not in the plan): keep or drop?
6. Explanation block run row shows credits and calls together (drawn), or calls only in the grouped list?
7. Nested runs (Agent Host): "depth 2" text plus an indent (drawn), or a breadcrumb "task-Planner › search_code_subagent"?
8. Plan inconsistency to settle before ST3: §5.3 says a run whose start call is missing keeps visible totals but is flagged, while §5.1 says `unreadReason` is set only when `totals` is null. Drawn as visible totals plus a flag line.
9. Unread tile wording: "incl. 83 calls from 3 of 5 subagent runs" (drawn), or a separate note only?

## Owner decisions (2026-11-15)

Approved. Question 1: keep the Calls by agent split bar. Question 5: drop the "Show run's calls" button (removed from `FindingRow.dc.html`). Question 8: totals plus flag; a run whose start call is missing keeps its known totals and carries a separate reason (plan §5.1 and D12 amended). All other questions: as drawn.
