# MCP Apps host spike (Phase 12, task A0): owner's checklist

**Last changed:** 2026-11-07 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Time-box: about 30 minutes. You run a throw-away view in two real hosts and
paste back what each one sends. Nothing here is shipped: the spike view and
the `--app-views-html` flag are dev-only (the flag is not wired into the VS
Code extension). Background: [mcp-apps.md](mcp-apps.md) §5.2, §5.3, §9.

What the spike answers (the rows of the results table below, mirroring
mcp-apps.md §9): which host style variables each host sends, whether
`toolInfo` is present, whether a `local("Barlow Condensed")` heading font
works, whether `openLink` accepts `vscode://`, whether an app-initiated
`tools/call` triggers an approval prompt, which display modes exist, and how
High Contrast behaves. The answers decide A0b (mock-ups) and A6 (theme
layering).

## 0. Prepare (once, 3 minutes)

From the repo root (needs Node 22.18+ and `npm ci` done):

```bash
npm run spike:build --workspace=packages/server
```

This bundles `packages/server/src/mcp/apps/spike/spike-main.ts` with the
`@modelcontextprotocol/ext-apps` client (esbuild) into one self-contained
file, `packages/server/src/mcp/apps/spike/dist/spike-view.html` (about
520 KB, git-ignored, no external resources, so the default CSP is fine).
The server reads the file on every `resources/read`, so rebuilding needs no
server restart (restart the MCP server entry in the host only if it caches).

Sanity check without any host (should print the server line and exit when
you press Ctrl+C; stdout must stay silent):

```bash
scripts/mcp-server.sh --app-views-html "$PWD/packages/server/src/mcp/apps/spike/dist/spike-view.html"
```

Use **absolute paths** below; replace `/ABS/REPO` with your checkout. You
need at least one real session in your logs so the chat has something to
cost (a Claude Code or Copilot session on this machine). The spike runs the
standalone server, so it sees the same providers as `npm run mcp`.

## 1. VS Code (Copilot Chat, 1.109+)

1. Create `.vscode/mcp.json` in any workspace (or run "MCP: Open User
   Configuration" for the user file):

   ```json
   {
     "servers": {
       "aca-spike": {
         "type": "stdio",
         "command": "/ABS/REPO/scripts/mcp-server.sh",
         "args": ["--app-views-html", "/ABS/REPO/packages/server/src/mcp/apps/spike/dist/spike-view.html"]
       }
     }
   }
   ```

   No bash (Windows)? Use `"command": "/ABS/REPO/node_modules/.bin/tsx"` and
   `"args": ["/ABS/REPO/packages/server/src/mcp/stdio.ts", "--app-views-html", "..."]`.

2. Run "MCP: List Servers", start `aca-spike`, confirm it shows 22 tools. If
   VS Code asks to trust the server, trust it.
3. Open Copilot Chat in **Agent** mode, make sure the `aca-spike` tools are
   enabled in the tools picker, and type:

   > What did my last session cost?

   Approve the `get_session_cost` call if asked. (If the model asks which
   session, answer "the most recent one"; it needs a `sessionId` so the
   `get_turn_series` test below works.)
4. The spike card should render under the tool call. If **nothing renders**,
   that is itself the key result: write "no view rendered" in the table, note
   the VS Code version (`Help > About`) and any VS Code setting that gates MCP
   Apps, then skip to step 6.
5. In the card:
   1. Read the "What the host sent" box. Note the heading font: monospace
      means `local("Barlow Condensed")` is absent; a condensed sans means
      present. (Install Barlow Condensed system-wide first only if you also
      want to see the "present" case.)
   2. Click each test button once and tick the checkbox next to it if the
      host showed **any prompt, dialog or confirmation** for it:
      - `openLink vscode://` (does VS Code open or ask? does it fail?)
      - `openLink https://` (GitHub)
      - `callServerTool get_turn_series (app-only tool)` (the approval prompt
        question; note it also if a toast or banner appears)
      - `requestDisplayMode fullscreen`, then `... back to inline`
   3. Press **Copy report** (if the status says the clipboard is blocked, the
      report is already selected: Ctrl+C).
   4. Paste into `docs/plans/mcp-apps-spike-results/vscode-light.json`
      (create the folder).
6. Switch the theme and repeat 5.2 to 5.4 for each, saving
   `vscode-dark.json` and `vscode-hc-dark.json`
   (`Ctrl+K Ctrl+T`: Light Modern, Dark Modern, Dark High Contrast; also
   `vscode-hc-light.json` with Light High Contrast if quick). Switching the
   theme re-sends the host context to the open card, so you may not need to
   re-run the chat; press **Refresh** first. The report always shows the
   latest context. Look at the card in High Contrast: are borders and text
   readable, are the swatches distinct, is the view transparent or opaque?

## 2. Claude Desktop

1. Open `claude_desktop_config.json` (Settings > Developer > Edit Config;
   macOS `~/Library/Application Support/Claude/`, Windows
   `%APPDATA%\Claude\`) and add:

   ```json
   {
     "mcpServers": {
       "aca-spike": {
         "command": "/ABS/REPO/scripts/mcp-server.sh",
         "args": ["--app-views-html", "/ABS/REPO/packages/server/src/mcp/apps/spike/dist/spike-view.html"]
       }
     }
   }
   ```

   (Same tsx alternative as above on Windows.) Quit and restart Claude
   Desktop fully.
2. New chat, ask: "What did my last session cost?", allow the tool.
3. Do 1.5.1 to 1.5.4 here, saving `claude-light.json` and `claude-dark.json`
   (Settings > Appearance, or the OS theme, switches the theme). Claude has no
   High Contrast mode to test; skip that row.
4. For `callServerTool get_turn_series`, note whether Claude asks for
   permission again, or runs silently because the tool was already allowed.

## 3. Results

Reports go in `docs/plans/mcp-apps-spike-results/<host>-<theme>.json`. Fill
the table (short answers; the JSON holds the detail), then tell Claude "A0
done" so §9 of mcp-apps.md is updated and A0b/A6 can start.

| Question (mcp-apps.md §9) | VS Code | Claude Desktop |
|---|---|---|
| View rendered at all? (version) | Yes. Insiders 1.146.0 (snap builds fail with a libcrypto/glibc error: use the .deb) | Yes. Claude 4.23118.0 (Electron 44) |
| Host variables sent: count, which are missing | 76, none missing, same set in all themes | 76, none missing, same set in both themes |
| Colour values differ by theme as expected; transparent or opaque background? | Values are `var(--vscode-*)` references, so the host theme drives them. Transparent or opaque: not recorded | Resolved `light-dark(rgba(...), rgba(...))` values, identical in both reports. Opaque `background-primary` and `ghost` is transparent |
| `hostFonts` present (`@font-face` css)? | No | Yes: `anthropic-sans` from assets.claude.ai (4.4 KB css) |
| `toolInfo` present, with what? | No. `hostContext.toolCall` carries `toolCallId` and `toolName` (`aca-spike-get_session_cost`) | Yes: the tool's full definition (schemas, `_meta.ui`) |
| `local("Barlow Condensed")` heading font present? | Absent (not installed) | Absent (not installed) |
| `openLink` `vscode://`: opened / refused / asked? | Refused (`isError: true`) | Refused (`isError: true`) |
| `openLink` `https://` works? | Yes, no prompt | Yes, with a prompt |
| Approval prompt on app-initiated `tools/call` to `get_turn_series`? | No | No |
| Display modes | `inline` only; `fullscreen` returns `inline` | `inline`, `fullscreen`; fullscreen works and returns to inline |
| High Contrast: readable? variables sent? | Dark HC: readable, swatches distinct, same 76 variables, theme reported as `dark` (no HC flag). Light HC: not run | n/a |
| Brand injected? | Yes (`standalone`, 0.9.0) | Yes |
| `structuredContent` keys reach the view? | Yes, 17 keys | Yes, 17 keys |
| Anything else odd | `hostCapabilities` lacks `message`; `updateModelContext` richer; `sandbox` allows `clipboardWrite`; container width 576-877 px | `sandbox` has no clipboard permission; `maxHeight` 5000; Copy report can hit the 50,000-character chat paste limit (report is ~60 KB), so save it to a file |

Files to commit when done: the table (paste into this file or the PR
description) and the `mcp-apps-spike-results/*.json` reports. The reports
contain host version, theme and style values and the cost tool's key names
only, not session content.

## 4. How the kit works

- `--app-views-html <path>` (or `=<path>`) on
  `packages/server/src/mcp/stdio.ts` makes the standalone server pass
  `appViews: { source: new FileViewSource(path) }` to `createMcpServer`
  (parsed by `stdio-args.ts`). Without it, nothing changes: no views resource
  and no `get_turn_series` (21 tools). With it: 22 tools, `ui://agent-cost-analyzer/views.html`,
  and `_meta.ui` on `get_session_cost`, `get_cost_rollup` and `list_findings`.
- The server fills the `<meta name="aca-brand" content="">` placeholder with
  the product brand JSON at read time (same path the real views use).
- The report is built by the pure `report-builder.ts`
  (unit-tested); `spike-main.ts` only gathers the observations.
- The spike view is the view of all three view tools, so asking for a rollup
  or findings also renders it (then `get_turn_series` has no `sessionId`
  and reports an error: use the session cost prompt for the test).
