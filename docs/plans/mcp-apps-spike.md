# MCP Apps host spike (Phase 12, task A0): results

**Last changed:** 2026-11-12 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

The owner ran a throw-away view in VS Code Insiders 1.146 and Claude Desktop on
2026-11-07 and recorded what each host sends. Background:
[mcp-apps.md](mcp-apps.md) §5.2, §5.3, §9.

The answers decided A0b (mock-ups) and A6 (theme layering). The spike kit
(the view, its report builder and `spike:build`) was removed on 2026-11-12;
it is in git history before that date. The recordings stay in
`mcp-apps-spike-results/<host>-<theme>.json`: the contrast tests
(`packages/mcp-apps/test/theme/host-sets.ts`) and the Playwright fake host
read them. They hold host version, theme and style values and the cost
tool's key names only, not session content.

## Results

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
