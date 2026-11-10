# Phase 12 A16: owner's manual check results

**Last changed:** 2026-11-10 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Results of [mcp-apps-a16-checklist.md](../mcp-apps-a16-checklist.md), run 2026-11-09/10. Every row passes; "Pass (owner)" rows were confirmed by the owner without a screenshot.

## Hosts

- VS Code Insiders 1.146.0-insider (commit 6605820e, Electron 43.8.6, Chromium 150.0.7871.250, @github/copilot 1.0.106-11), Linux x64, extension 0.2.1 built from the working tree.
- Claude Desktop for Linux 4.23118.0 (8175c3); standalone server 0.9.0 via `scripts/mcp-server.sh`.
- Claude Code CLI, same standalone server.

## Results

| Check | VS Code Copilot Chat | Claude Desktop |
|---|---|---|
| Version | 1.146.0-insider | 4.23118.0 |
| Tool count (20 / 22) | Pass: "Discovered 20 tools" | Pass: 21 model-visible + app-only `get_turn_series` |
| U1 renders, turn drill-down works | Pass after fix 1 | Pass |
| U1 copy title → Open Session… picker opens the session | Pass: pasted title finds the session, Enter opens it in the panel | n/a (no button) |
| U2 renders, session drill-down and back work | Pass | Pass |
| U2 "Ask about this session" sends only `Analyse session <id>` | Pass (owner) | Pass (owner) |
| U3 renders, filters reload in place, evidence collapsed | Pass | Pass after fix 6 |
| "Unknown", never 0 | Pass, with notes after fix 2 | Pass |
| Light theme readable | Pass | Pass |
| Dark theme readable | Pass | Pass |
| Dark High Contrast readable | Pass | n/a |
| Light High Contrast (optional) | not run | n/a |
| Narrow width: no sideways scroll | Pass for U1, U2, U3; readability findings 10–11 | Pass (owner) |
| Keyboard: Tab/Enter drill-downs, focus ring visible | Pass (owner) | Pass (owner) |
| Permission prompts on drill-down calls? | Pass (owner) | Pass (owner) |
| Fullscreen offered / works | n/a (inline only) | Pass (owner) |
| Matches the approved A0b boards | Pass (owner); deviations are the fixes below | Pass (owner) |
| Active-session flag (fix 9) | Pass: tag and note on U1 | Pass: tag on the U2 row |
| Claude Code CLI: text output unchanged | Pass: plain text, no HTML, `ui://` or view | |

## Findings and fixes

Each fix is test-first; all are in the A16 fix PR.

1. **No view in VS Code.** VS Code prefixes `toolCall.toolName` with the server name (`AI-Credits-Analyzer-get_session_cost`); the router matched exact names only. The router now matches a known name after a `-` or `_` prefix.
2. **Unknown input tokens and cache hit without a reason.** Total input is Unknown when cache writes are not logged. U1's input tile and the U1/U2 cache-hit tiles now note the known parts and what is not logged.
3. **Blank prompt cell.** A turn whose text the log lacks shows "Prompt not recorded".
4. **Turn explanation.** The server's per-turn sentence now names cache writes and pluralises ("18 tokens", not "token(s)"); one shared helper replaces four copies.
5. **U1 chart had no turn numbers.** Turn labels under the columns, thinned for long sessions.
6. **U3 layout.** Backtick spans render as code; kind filters are separate chips; the expanded detail is a full-width row and the table fits the card in Desktop.
7. **Ranking not shown.** U1 and U2 say "by AI Credits" or "by input tokens" (the server's `rankedBy`); U2 has an Input tok. column; U1's chart plots the ranking measure, so a Claude Code session shows input tokens per turn.
8. **Overhead bar glare in dark mode.** A single segment uses the chart colour.
9. **Figures of a running chat looked final.** Sessions whose latest turn started in the last 15 minutes carry `active`; the text says the figures may still change; U1 and U2 show an "active" tag ([mcp-apps.md §4.7](../mcp-apps.md)).
10. **U2 Session column squeezed at narrow width.** With Turns, AI Credits and Input tok., titles wrap after every word. Fixed: at 480px and below, Turns moves into the meta line under the title with provider and model.
11. **Chart labels shrink with the chart.** At about 300px the axis labels are about 5px. Fixed: chart labels grow in chart units at 480, 420 and 360px (about 9.5px on screen); turn labels are spaced 48 units apart and the daily chart labels at most 6 dates.
12. **Copy confirmation spacing.** The title in a code element reads as "Copied  title ." in High Contrast. Fixed: the title is quoted in plain text.
