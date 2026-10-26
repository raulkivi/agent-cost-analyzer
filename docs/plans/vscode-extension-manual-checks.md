# AI Credits Analyzer: manual checks (step 10.9)

The owner runs these once per release candidate in a **real VS Code**
(current stable), because no test can drive them: the usability script
from [vscode-extension.md](vscode-extension.md) §3.5, the remote check
(D6), and Copilot agent mode using the MCP server (10.8's exit check).
Record the result in the release PR: tick each line, add notes, and attach
the screenshots listed at the end (they're also the ones step 10.10 puts
in the docs).

## 0. Install the candidate

1. Download the `vsix` artifact from the CI run of the release PR (the
   `extension` job), or run `npm run build && npm run package --workspace=packages/vscode-extension`.
2. VS Code: *Extensions → … → Install from VSIX…*, pick
   `ai-credits-analyzer-<version>.vsix`. No repo checkout is needed.
3. Note the VS Code version (*Help → About*) and OS.

## 1. Usability script (§3.5)

Use a VS Code profile with GitHub Copilot Chat installed and signed in.
For a clean first run, use a new profile (*Profiles → New Profile*).

| # | Scenario | Steps | Expected | ✓ / notes |
|---|---|---|---|---|
| 1.1 | First run | Install into a new profile and reload | The Get Started walkthrough opens once as an editor tab (not a notification). The Activity Bar shows the AI Credits Analyzer icon. The status bar says setup is needed. | |
| 1.2 | Logging off | With `github.copilot.chat.agentDebugLog.fileLogging.enabled` off, open the Setup view | Setup shows what's missing with Enable/Fix buttons; each opens the exact setting. Nothing is changed without a click. | |
| 1.3 | No sessions | A profile where Copilot Chat has never been used | The Sessions welcome view says why it's empty and points to Learn mode. The Learn view lists the 18 scenarios. | |
| 1.4 | Normal use | Turn logging on, chat with Copilot in agent mode for a few turns, then *Refresh* the Sessions view | The session appears under today with its AI Credits (or "unknown", never 0). Picking it opens the panel on it. The status bar shows today's known AI Credits, with coverage in the tooltip. | |
| 1.5 | A large session | Open the longest session you have (100+ turns if possible) | The panel renders without a long blank; the loading skeleton shows Cancel; scrolling and selecting turns respond immediately. Note rough timings. | |
| 1.6 | Cancel | Open the insights dashboard or tool audit on many sessions and press Cancel while it loads | "Loading cancelled" with Retry; Retry loads it. | |
| 1.7 | Keyboard only | Unplug the mouse: reach the sidebar, open a session, move through the turns table, open the column chooser, the system prompt diagram (arrow keys) and "View as table" on a chart | Everything is reachable; focus is always visible; Escape closes overlays and returns focus. | |
| 1.8 | High contrast | *Preferences: Color Theme → High Contrast* (dark, then light) | All text and borders readable; selection and focus visible; charts still distinguishable. | |
| 1.9 | Narrow panel | Drag the panel to about 640 px, then about 360 px | Layout switches (mock-up 4): 2×2 KPIs, view select, priority columns, details drawer. No horizontal page scroll. | |
| 1.10 | Theme and font | Switch to a light theme and change `editor.fontSize` | The panel follows the theme and font. | |
| 1.11 | System prompt | From a session's System prompt tab, open it in an editor | Opens read-only in a tab; copying works. | |
| 1.13 | Learn view | Pick a scenario in the side bar's Learn view, then another; switch to Analyze and pick a session | Each scenario opens in Learn mode with the panel's full width (no list in the panel); a session switches to Analyze. | |
| 1.12 | Uninstall | Uninstall the extension and reload | No leftovers in the UI; Copilot Chat settings that were changed through Fix buttons stay as you set them. | |

## 2. MCP server in Copilot agent mode (10.8 exit)

| # | Steps | Expected | ✓ / notes |
|---|---|---|---|
| 2.1 | With `aiCreditsAnalyzer.mcp.enabled` off (default), open Copilot Chat agent mode → *Configure Tools* | No "AI Credits Analyzer" server is listed. | |
| 2.2 | Turn the setting on in **User** settings | The server appears with 9 read-only tools; its name is `ai-credits-analyzer`. | |
| 2.3 | Ask: "What did my last Copilot session cost, and what drove it?" | Copilot calls `list_sessions` / `get_session_cost` and answers with the same AI Credits the panel shows. | |
| 2.4 | Ask about another agent, e.g. "show my Claude Code sessions" | The tools answer that only `vscode` is available. | |
| 2.5 | Open an untrusted folder (Restricted Mode) whose `.vscode/settings.json` sets the setting to `true`, with the user setting off | No server is offered. After trusting the folder, it is. | |
| 2.6 | Turn the setting off again | The server disappears from the tool list. | |

## 3. Remote check (D6, `extensionKind: ["workspace"]`)

Do at least one of Remote-SSH or WSL, and one Dev Container. Install the
VSIX into the remote (*Install in <remote>*).

| # | Remote | Steps | Expected | ✓ / notes |
|---|---|---|---|---|
| 3.1 | Remote-SSH or WSL | Use Copilot Chat in agent mode in the remote window, then open the Sessions view | Sessions recorded on the remote host appear with costs. If the remote has none, Setup says why ("unavailable" with a reason, never a crash or a silent 0). | |
| 3.2 | Dev Container | Same in a container | As 3.1. | |
| 3.3 | Either | Turn on the MCP setting and repeat 2.3 | The server starts on the remote and answers. | |

Record the outcome (and any storage-layout differences, R3) in
[architecture.md](../architecture.md) §12.

## 4. Screenshots for step 10.10

PNG, saved to `docs/images/vscode/`.

Done: 1, 2, 5, 6 and 8 show only the panel, so
`npm run screenshots --workspace=packages/vscode-extension` (after
`npm run build`) renders them from the real webview build over made-up
data (`scripts/ui-check/showcase-fixture.mts`) at 2× scale. Run it again
after a UI change. `panel-dark.png` shows the panel alone, without the
side bar.

Done in a real VS Code window: 3 and 4, taken in a throwaway profile seeded with
the same made-up data (`createShowcaseFixture`, run with
`--user-data-dir` and `--extensions-dir`).

Open: 7 needs a real VS Code window with Copilot Chat signed in. Use data you're happy to
publish (no private chat text):

1. `panel-dark.png`: the panel on a session (Dark Modern), sidebar visible.
2. `panel-light.png`: the same in Light Modern.
3. `sidebar.png`: Sessions and Setup views with the status-bar item.
4. `walkthrough.png`: the Get Started walkthrough.
5. `dashboard.png`: the insights dashboard.
6. `narrow.png`: the panel at about 640 px.
7. `mcp-agent-mode.png`: Copilot agent mode answering with the tools.
8. `high-contrast.png`: the panel in High Contrast.
