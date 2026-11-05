# AI Credits Analyzer: manual checks (step 10.9)

The owner runs these once per release candidate in a **real VS Code**
(current stable), because no test can drive them: the usability script
from [vscode-extension.md](vscode-extension.md) §3.5, the remote check
(D6), and Copilot agent mode using the MCP server (10.8's exit check).
Record the result in the release PR: tick each line, add notes, and attach
the screenshots listed at the end (they're also the ones step 10.10 puts
in the docs). Findings that need a code fix also go in the run log below.

## Run log

### 0.1.0 (started 2026-10-27, in progress)

- **Deviation:** run in VS Code Insiders 1.144.0, Linux, because this
  machine has no stable VS Code.
- **Setup:** VSIX built from `main` installed into a new profile
  "AI Credits 0.1.0 check".
- **1.2 Logging off:** two bugs, both in a profile where GitHub Copilot
  Chat is disabled, so its settings aren't registered. Fixed in #90:
  - Fix's fuzzy Settings search showed a near-miss setting. It now
    searches `@id:<setting>` and falls back to the Extensions view or
    `settings.json`.
  - Setup reported nothing wrong although Copilot wrote no logs. It now
    shows the required `copilot-chat-unavailable` warning.

  Re-run 1.2 with a VSIX built from #90 or later.
- **2026-10-28:** VSIX rebuilt from `main` at `7b67af9` and installed into
  the same profile. Insiders had updated to 1.145.0.
- **1.2 Logging off (re-run): passed.** With Copilot Chat disabled, Setup
  shows the `copilot-chat-unavailable` warning, and Fix opens the
  Extensions view or `settings.json`. With Copilot Chat enabled, Setup
  shows the logging setting as missing, Fix opens exactly that setting,
  and nothing changes without a click.
- **Clean environment for 1.1 and 1.3:** a new profile isn't clean,
  because Copilot Chat's globalStorage and `workspaceStorage` are shared by
  every profile of an install, so existing sessions still show. These ran
  in a throwaway Insiders window (`--user-data-dir`, `--extensions-dir`),
  signed in to Copilot Chat but never used, with the VSIX installed
  through *Install from VSIX…*.
- **1.1 First run: passed.** The walkthrough opened once as an editor tab,
  the Activity Bar icon and the status bar's "setup needed" showed, and it
  didn't reopen after a second reload.
- **1.3 No sessions: passed.** The Sessions view said why it was empty and
  pointed to Learn mode, the Learn view listed 18 scenarios, and Setup
  showed the logging setting as missing.
- **1.13 Learn view: scenarios passed.** Each scenario opened in Learn
  mode at the panel's full width. The switch to a session waits for 1.4.
- **1.4 Normal use: failed (no sessions appeared).** Insiders 1.145 ran
  the agent-mode chat through its Agent Host as a `copilotcli` session,
  stored in `<userData>/User/globalStorage/agent-host.db` and
  `<userData>/agentSessionData/<id>/session.db` (with `turn_usage`), plus
  AHP logs in `<userData>/logs/<run>/ahp/*.jsonl`. Copilot Chat's
  `session-store.db` stayed empty and no `debug-logs` folder was written,
  and those are the only stores the extension reads. The main Insiders
  install shows the same switch: its last `session-store.db` session and
  debug log are from 2026-09-30/10-01, and 67 `copilotcli` sessions since
  then are invisible to the extension. Stable is affected too: the
  [1.143 release notes](https://code.visualstudio.com/updates/v1_143) say
  "The Copilot harness is now the default for new sessions", that its
  sessions "run through the Agent Host", and that the Local harness is
  being retired. The extension requires `^1.144.0`, so on default
  settings it shows no new sessions. **Release blocker for 0.1.0.** Next:
  retry 1.4 with the Local harness picked, to finish checking the classic
  path.
- **1.4 Normal use, Local harness: passed.** With Local picked in the
  harness picker, the session appeared under Today with its AI Credits,
  picking it opened the panel, and the status bar showed today's AI
  Credits with coverage in the tooltip.
- **1.13 Learn view: passed.** Picking the session from a Learn scenario
  switched the panel to Analyze mode.
- **1.4 Normal use, default harness: passed** with a VSIX built from
  `756a26c` (step 10.13). The Agent Host session appeared under Today with
  its AI Credits, its turns showed tokens and AI Credits, the status bar
  included it, the turn inspector, system prompt, Tools tab and tool audit
  said "not available yet", and Setup marked the logging settings optional
  without "setup needed".
- **5.1-5.11 Agent Host event log: passed** (2026-11-02, Insiders, profile
  "AI Credits 0.1.0 check", VSIX built from `89eafea`, step 10.14, PR #98).
- **10.15 Agent Host cache-write and reasoning (task 7): passed**
  (2026-11-02, Insiders, VSIX built from `31a587f`, after reloading the
  window). A new default-harness session (Copilot CLI 1.0.103) showed
  Cache write and Reasoning in the panel and the standalone app with the
  same numbers; total input (uncached + cache write + cache read) matched
  the sum of the event log's usage records (196,786) and `get_session_cost`
  over stdio; an older session showed both as "—" with the "no per-call
  usage records" reason. The Dashboard's input totals weren't read.
- **1.5, 1.6, 1.7, 1.9 in Chrome only (2026-11-03):** run against the
  standalone app at `localhost:5173`, not in VS Code, so they stay open
  for VS Code.
  - 1.5: the 52-turn session rendered all 53 rows in 174 ms; selecting a
    turn updated the Explanation in 38 ms; no horizontal overflow.
  - 1.6: the Dashboard shows Cancel while loading; Cancel gives "Loading
    cancelled" with Retry, and Retry loads it. The all-provider load took
    about 30 s with partial data (Claude Code CLI limited to its 200 most
    recent sessions).
  - 1.7: all 348 focusable elements show a visible focus style; Enter
    opens the column chooser, Escape closes it and returns focus to
    Columns; "View as table" is an inline toggle (`aria-pressed`) that
    Escape leaves on. The full Tab order and the system prompt diagram's
    arrow keys weren't tested.
  - 1.9: at 640 px the sessions list stacks above the panel with no
    horizontal overflow; Columns is replaced by Details. Chrome's minimum
    width is 500 px, so 360 px wasn't tested.
- **Not yet run:** 1.5-1.7 and 1.9 in VS Code; 1.8, 1.10-1.13 (1.12
  last); §2.1-2.6 in Copilot agent mode (the server itself answered over
  stdio, 9 tools); §3.

## 0. Install the candidate

1. Download the `vsix` artifact from the CI run of the release PR (the
   `extension` job), or run `npm run build && npm run package --workspace=packages/vscode-extension`.
2. VS Code: *Extensions → … → Install from VSIX…*, pick
   `ai-credits-analyzer-<version>.vsix`. No repo checkout is needed.
3. Note the VS Code version (*Help → About*) and OS.

## 1. Usability script (§3.5)

Rows marked **Automated** run in CI as the `extension-ui` job
(`npm run test:ui:vscode`, [vscode-ui-automation.md](vscode-ui-automation.md),
step 10.16): run them by hand only when that job is red, or for the parts
named as still manual. Rows 1.1-1.4, 1.12, 2.3 and 2.4 are automated too,
but over **fixtures, not a real Copilot chat**: the notes say what each does
not prove. §3 (remote) and §4 stay manual.

**Opt-in real-Copilot suite (owner's machine only, never CI).** Checks 1.4,
2.3 and 2.4 with a real signed-in Copilot agent-mode chat are covered by
`npm run test:ui:vscode:copilot` when you run it (it spends a few AI
Credits; setup and cost in
[vscode-ui-automation.md](vscode-ui-automation.md) §7). It is not run by CI.

Use a VS Code profile with GitHub Copilot Chat installed and signed in.
For a clean first run, use a new profile (*Profiles → New Profile*).

| # | Scenario | Steps | Expected | ✓ / notes |
|---|---|---|---|---|
| 1.1 | First run | Install into a new profile and reload | The Get Started walkthrough opens once as an editor tab (not a notification). The Activity Bar shows the AI Credits Analyzer icon. The status bar says setup is needed. | **Partly automated:** `first-run.e2e.ts` (a bare user-data dir: the tab is `Welcome` showing "Get started with AI Credits Analyzer", opened without a walkthrough/analyzer notification; the Activity Bar icon and "setup needed" are present). **Still manual:** "didn't reopen after a second reload". A reload ends the test session, and under the driver VS Code keeps global state in memory (no state database is written even after a quit), so a second launch cannot tell "offered once" from "state lost"; the logic is unit-tested (`WalkthroughOffer`). **Does not prove:** a VSIX *installed* into a new profile (the extension runs as a development extension here). |
| 1.2 | Logging off | With `github.copilot.chat.agentDebugLog.fileLogging.enabled` off, open the Setup view | Setup shows what's missing with Enable/Fix buttons; each opens the exact setting. Nothing is changed without a click. | **Automated:** `first-run.e2e.ts` (Copilot Chat off: the `copilot-chat-unavailable` and logging warnings, Fix opens the Extensions view on `@id:GitHub.copilot-chat`) and `copilot-available.e2e.ts` (the built-in Copilot Chat enabled, unsigned: logging turned off, Fix opens the Settings editor on exactly `@id:github.copilot.chat.agentDebugLog.fileLogging.enabled`); both compare `settings.json` before and after the click. **Does not prove:** the "Enable" wording of a button (the inline action is "Fix Setting"). |
| 1.3 | No sessions | A profile where Copilot Chat has never been used | The Sessions welcome view says why it's empty and points to Learn mode. The Learn view lists the 18 scenarios. | **Automated:** `first-run.e2e.ts` (a bare user-data dir: no Copilot or Agent Host store; welcome text, "Open Learn mode", 18 scenario rows). **Does not prove:** Copilot Chat's own storage layout on a machine that really never used it (a real profile shares Copilot's storage across profiles, see the run log). |
| 1.4 | Normal use | Turn logging on, chat with Copilot in agent mode for a few turns, then *Refresh* the Sessions view | The session appears under today with its AI Credits (or "unknown", never 0). Picking it opens the panel on it. The status bar shows today's known AI Credits, with coverage in the tooltip. | **Automated over a fixture session, not a real chat:** `copilot-available.e2e.ts` (a seeded Copilot Chat store and the built-in Copilot Chat enabled but not signed in: the session under Today with its credits, "unknown" rows without cost, the panel opens on it, the status bar shows today's credits with "N of M sessions today have cost data"). **Does not prove:** that a real chat writes what the fixture mimics; the opt-in real-Copilot suite does that when you run it. |
| 1.5 | A large session | Open the longest session you have (100+ turns if possible) | The panel renders without a long blank; the loading skeleton shows Cancel; scrolling and selecting turns respond immediately. Note rough timings. | Automated: `panel.e2e.ts` (150 turns, §3.5 marks, 500 ms select). Manual only when red or for the feel of scrolling. |
| 1.6 | Cancel | Open the insights dashboard or tool audit on many sessions and press Cancel while it loads | "Loading cancelled" with Retry; Retry loads it. | Automated: `panel.e2e.ts` (dashboard load held by a Test-mode hook). |
| 1.7 | Keyboard only | Unplug the mouse: reach the sidebar, open a session, move through the turns table, open the column chooser, the system prompt diagram (arrow keys) and "View as table" on a chart | Everything is reachable; focus is always visible; Escape closes overlays and returns focus. | Automated: `keyboard.e2e.ts`. Manual only when red. |
| 1.8 | High contrast | *Preferences: Color Theme → High Contrast* (dark, then light) | All text and borders readable; selection and focus visible; charts still distinguishable. | Automated: `layout-theme.e2e.ts` (text contrast, selection, focus). **Still manual:** "charts still distinguishable" (screenshots in `test/ui/out/`). |
| 1.9 | Narrow panel | Drag the panel to about 640 px, then about 360 px | Layout switches (mock-up 4): 2×2 KPIs, view select, priority columns, details drawer. No horizontal page scroll. | Automated: `layout-theme.e2e.ts` at 640 and 360 px, through the editor layout. The Copilot Chat setup banner is dismissed first: it overflows 360 px (known bug, skipped test). |
| 1.10 | Theme and font | Switch to a light theme and change `editor.fontSize` | The panel follows the theme and font. | Automated: `layout-theme.e2e.ts`. The font half pins today's behaviour: the panel follows the workbench font, not `editor.fontSize` (plan Q4). |
| 1.11 | System prompt | From a session's System prompt tab, open it in an editor | Opens read-only in a tab; copying works. | Automated: `panel.e2e.ts`. |
| 1.13 | Learn view | Pick a scenario in the side bar's Learn view, then another; switch to Analyze and pick a session | Each scenario opens in Learn mode with the panel's full width (no list in the panel); a session switches to Analyze. | Automated: `views.e2e.ts`. |
| 1.12 | Uninstall | Uninstall the extension and reload | No leftovers in the UI; Copilot Chat settings that were changed through Fix buttons stay as you set them. | **Automated:** `uninstall-installed.e2e.ts` and `uninstall-after.e2e.ts` (the VSIX from `vsce package` installed into a throwaway profile with VS Code's CLI, loaded as a user has it, then uninstalled with VS Code's own command; after a relaunch no extension, command, Activity Bar icon, status bar item or tab remains; `settings.json` is byte-identical across the uninstall). **Does not prove:** the Extensions view's Uninstall button and "Reload required" prompt (the command is the one behind them), or that a Marketplace-installed copy behaves like a VSIX (no Marketplace is used). |

## 2. MCP server in Copilot agent mode (10.8 exit)

| # | Steps | Expected | ✓ / notes |
|---|---|---|---|
| 2.1 | With `aiCreditsAnalyzer.mcp.enabled` off (default), open Copilot Chat agent mode → *Configure Tools* | No "AI Credits Analyzer" server is listed. | Automated: `mcp.e2e.ts`, in VS Code's own *MCP: List Servers*. Copilot's *Configure Tools* stays manual. |
| 2.2 | Turn the setting on in **User** settings | The server appears with 9 read-only tools; its name is `ai-credits-analyzer`. | Automated: `mcp.e2e.ts` (server listed; the 9 tools are the integration suite's, over stdio). |
| 2.3 | Ask: "What did my last Copilot session cost, and what drove it?" | Copilot calls `list_sessions` / `get_session_cost` and answers with the same AI Credits the panel shows. | **Partly automated, tool level only:** the integration suite (`extension.test.ts`) starts the server as VS Code does and calls `list_sessions` and `get_session_cost` for the seeded session. **Does not prove:** Copilot choosing and calling the tools (the opt-in real-Copilot suite does that when run). The "same as the panel" assertion runs (`get_session_cost` and the Sessions view both say 9.65 for the seeded session; the list-vs-detail bug is fixed, vscode-ui-automation.md §6.6). |
| 2.4 | Ask about another agent, e.g. "show my Claude Code sessions" | The tools answer that only `vscode` is available. | **Partly automated, tool level only:** the integration suite calls `list_log_providers` (only `vscode`) and `list_sessions` with `provider: "claude-code"` (an error naming the known provider). **Does not prove:** what Copilot says to the user. |
| 2.5 | Open an untrusted folder (Restricted Mode) whose `.vscode/settings.json` sets the setting to `true`, with the user setting off | No server is offered. After trusting the folder, it is. | Automated: `mcp-trust.e2e.ts` (Restricted Mode, then the Trust button). |
| 2.6 | Turn the setting off again | The server disappears from the tool list. | Automated: `mcp.e2e.ts`. |

## 3. Remote check (D6, `extensionKind: ["workspace"]`)

Do at least one of Remote-SSH or WSL, and one Dev Container. Install the
VSIX into the remote (*Install in <remote>*).

**Not automated, deliberately** (investigated for step 10.16, see
[vscode-ui-automation.md](vscode-ui-automation.md) §6.4): Remote-SSH and Dev
Containers are Marketplace-only, closed-source Microsoft extensions that need
a real ssh or container host and a server download over the network, WSL needs
Windows, and a local `code serve-web` would only show an extension host apart
from the UI, not any of these remotes nor where Copilot Chat stores sessions on
them (R3). A faked stand-in would pass without proving D6, so these rows stay
manual.

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

Done in a real VS Code window: 3, 4 and 7, taken in a throwaway profile
seeded with the same made-up data (`createShowcaseFixture`, run with
`--user-data-dir` and `--extensions-dir`); 7 with Copilot Chat signed in
and `aiCreditsAnalyzer.mcp.enabled` on.

The list, for retakes:

1. `panel-dark.png`: the panel on a session (Dark Modern).
2. `panel-light.png`: the same in Light Modern.
3. `sidebar.png`: Sessions and Setup views with the status-bar item.
4. `walkthrough.png`: the Get Started walkthrough.
5. `dashboard.png`: the insights dashboard.
6. `narrow.png`: the panel at about 640 px.
7. `mcp-agent-mode.png`: Copilot agent mode answering with the tools.
8. `high-contrast.png`: the panel in High Contrast.

## 5. Agent Host event log (step 10.14, task 11)

Checks that VS Code Agent Host sessions (the default Copilot harness since
1.143) show turn text, inspector rounds, system prompt and tool audit read
from the Copilot CLI event log,
`<COPILOT_HOME or ~/.copilot>/session-state/<sdkSessionId>/events.jsonl`.
Record results in PR #98 (task 11 checkbox) and in the run log above.

**Setup.** Build and install a VSIX from the PR branch into the
"AI Credits 0.1.0 check" Insiders profile, then run *Developer: Reload
Window*:

```
cd packages/vscode-extension && npm run build && npm run package
code-insiders --profile "AI Credits 0.1.0 check" --install-extension ai-credits-analyzer-0.1.0.vsix --force
```

**A. VS Code, default harness.** In Copilot Chat agent mode with the
default harness, start a new session. Ask something that runs a few tools
(e.g. "list the files in this folder and read package.json"), then send a
second message. *Refresh* the Sessions view and open the session.

| # | Check | Expected | ✓ / notes |
|---|---|---|---|
| 5.1 | Turn inspector (open from the Explanation panel) | Your prompt and the response text; one Request/Response pair per round; tool calls; chips for attachments, never inline base64. | |
| 5.2 | System prompt tab | The prompt text; "Base system prompt" and "Tool definitions" with real token counts. | |
| 5.3 | Tools tab | "Unavailable": the event log records no tool definitions. | |
| 5.4 | Tool audit | The session's tool calls with outcomes (success, error, denied, interrupted). | |
| 5.5 | Turns table | Tokens and AI Credits as before 10.14. | |
| 5.6 | All sessions / audit rollup | The session is counted. | |

**B. Standalone app.** Run `npm start` at the repo root, switch to Analyze
mode and pick the VS Code / Copilot provider.

| # | Check | Expected | ✓ / notes |
|---|---|---|---|
| 5.7 | Same session | Listed with the same AI Credits; inspector, system prompt and tool audit match A. | |

**C. Missing log.** Find the session's log folder: the newest dir in
`~/.copilot/session-state/` (`ls -t ~/.copilot/session-state | head -1`).
Confirm it's the right one: its `events.jsonl` has your prompt in the
first `user.message` line. Rename the folder (add `.moved`), refresh the
Sessions view and reopen the session.

| # | Check | Expected | ✓ / notes |
|---|---|---|---|
| 5.8 | Inspector, system prompt, tool audit | Each says "not available" with a reason naming the Copilot CLI event log. | |
| 5.9 | Turns table | Turns, tokens and AI Credits still show. | |
| 5.10 | Audit rollup | "1 Agent Host session not included: no readable Copilot CLI event log." | |
| 5.11 | Restore | Rename the folder back and refresh: the session shows its data again. | |
