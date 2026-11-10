# MCP Apps MVP: owner's checks (Phase 12, task A16)

**Last changed:** 2026-11-10 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

These checks take about 45 minutes. You run the shipped U1–U3 views in the two real hosts and confirm the MVP exit criterion ([mcp-apps.md](mcp-apps.md) §8.1). The A0 spike ([mcp-apps-spike.md](mcp-apps-spike.md)) used a throw-away view. This run uses the real build: the `.vsix` for VS Code and `scripts/mcp-server.sh` for Claude Desktop.

Write each answer in the results table (§4). Save screenshots to `docs/plans/mcp-apps-a16-results/`, using the file names in the table. The User Guide and the extension guide reuse them.

## 0. Prepare (once, 5 minutes)

From the repo root (Node 22.18+, `npm ci` done):

```bash
npm run build                                   # builds packages/mcp-apps/dist/views.html first
cd packages/vscode-extension && npm run package # ai-credits-analyzer-<version>.vsix
code-insiders --install-extension ai-credits-analyzer-<version>.vsix --force
```

Use `code` instead of `code-insiders` if that is what you have. The repo's `install-extension` skill does the same steps. Then run **Developer: Reload Window**.

You need a few real sessions on this machine: Copilot Chat sessions for VS Code, and Claude Code or Copilot sessions for Claude Desktop. At least one session should have a finding, so that U3 has rows.

## 1. VS Code Copilot Chat (inline views)

1. Turn on the setting `aiCreditsAnalyzer.mcp.enabled`. Run **MCP: List Servers** and start **AI Credits Analyzer**. It should list **20 tools**, including `get_turn_series`.
2. Open Copilot Chat in **Agent** mode and check that the AI Credits Analyzer tools are enabled in the tools picker.
3. Use the **Light Modern** theme for the first pass (`Ctrl+K Ctrl+T`).

**U1, session cost.** Ask: *"What did my last session cost? Use get_session_cost."*

- The view appears under the tool call. It shows the product mark and name, KPI tiles, the per-turn chart, top turns and the context bar.
- Click a top turn. It expands inline without a new model turn. Click **Hide turn**.
- Click **Copy title to open in panel**. The hint names *AI Credits Analyzer: Open Session…*.
- Press `Ctrl+Shift+P`, run **AI Credits Analyzer: Open Session…** and paste. The picker narrows to that session. Press Enter, and the panel opens on it.
- Any figure the logs don't report reads "Unknown", never 0.

**U2, spend rollup.** Ask: *"What's driving my spend this week? Use get_cost_rollup."*

- The daily columns, the by-model and by-provider bars, and the top sessions all appear.
- Click a top session. U1 opens in place. Click **Back to cost rollup**, and the rollup returns without a new tool call.
- In the drilled-in session, click **Ask about this session**. The chat receives exactly `Analyse session <id>`, with no title.

**U3, findings.** Ask: *"Anything risky in my sessions? Use list_findings."*

- Severity tiles and the table appear.
- Change the kind filter and the minimum severity. The table reloads in place.
- Expand a row's evidence. It shows as plain text and is collapsed by default.

**Themes.** Repeat a quick look at U1–U3 in **Dark Modern** and **Dark High Contrast**, and in **Light High Contrast** if you have time. A0 never recorded Light High Contrast, so it has no contrast test. Check:

- text and chart marks are readable;
- borders are visible in High Contrast;
- the card background follows the chat (transparent);
- the focus ring shows when you Tab through the view.

**Narrow width.** Make the chat panel narrow (about 360 px). Nothing scrolls sideways, and the tables move columns under the title.

**Keyboard.** In U1, Tab to a top turn and press Enter. In U2, Enter on a session drills in. Back returns focus to that row.

## 2. Claude Desktop (inline and fullscreen)

1. Edit `claude_desktop_config.json`. On macOS it is in `~/Library/Application Support/Claude/`, on Windows in `%APPDATA%\Claude\`, or open it from Settings > Developer > Edit Config.

   ```json
   {
     "mcpServers": {
       "ai-credits-analyzer": { "command": "/ABS/REPO/scripts/mcp-server.sh" }
     }
   }
   ```

   The script adds `--app-views-html` itself when `packages/mcp-apps/dist/views.html` exists. Quit Claude Desktop fully and restart it. If you still have the `aca-spike` entry from A0, remove it.
2. The server should list **22 tools**.
3. Run the same three prompts as in §1. Check the same points, with these differences:
   - U1 shows **no** copy button, because there is no VS Code panel to open.
   - Try fullscreen if Claude offers it.
4. Check the views in light and dark (Settings > Appearance).
5. Note whether the drill-downs (`get_turn`, `get_session_cost`, `list_findings`, `get_turn_series`) asked for permission. A0 saw no prompt for `get_turn_series`.

## 3. Claude Code CLI: text unchanged

Claude Code has no MCP Apps view. Its text output must be unchanged (§8.1).

1. Register the server with `claude mcp add ai-credits-analyzer /ABS/REPO/scripts/mcp-server.sh`.
2. Ask the same three questions.
3. The answers are the usual text, and nothing mentions HTML, `ui://` or a view.

## 4. Results

| Check | VS Code Copilot Chat | Claude Desktop |
|---|---|---|
| Version (Help > About / About Claude) | | |
| Tool count (20 / 22) | | |
| U1 renders, turn drill-down works | | |
| U1 copy title → Open Session… picker opens the session | | n/a (no button) |
| U2 renders, session drill-down and back work | | |
| U2 "Ask about this session" sends only `Analyse session <id>` | | |
| U3 renders, filters reload in place, evidence collapsed | | |
| "Unknown", never 0, where the logs don't report a figure | | |
| Light theme readable (screenshot `vscode-light-u1.png` / `claude-light-u1.png`) | | |
| Dark theme readable (`vscode-dark-u2.png` / `claude-dark-u2.png`) | | |
| Dark High Contrast readable (`vscode-hc-dark-u3.png`) | | n/a |
| Light High Contrast readable (`vscode-hc-light-u3.png`, optional) | | n/a |
| Narrow width: no sideways scroll | | |
| Keyboard: Tab/Enter drill-downs, focus ring visible | | |
| Permission prompts on drill-down calls? | | |
| Fullscreen offered / works | n/a (inline only) | |
| Matches the approved A0b boards (differences?) | | |
| Claude Code CLI: text output unchanged | | |

When every row passes, A16 is done, and with it the Phase 12 MVP (§8.1). Report anything that fails, with a screenshot. I'll fix it before the MVP release (extension 0.4.0 / app 0.10.0, §7.3).
