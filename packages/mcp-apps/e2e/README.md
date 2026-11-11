# MCP App views in a fake host

**Last changed:** 2026-11-11 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Step 10.17 task G5 ([release-ui-gate.md](../../../docs/plans/release-ui-gate.md), decision D3): Playwright runs the built `dist/views.html` in a fake MCP Apps host, against the real MCP server over stdio, in place of the Claude Desktop hand checks (A16 §2, A24 §2). It proves the views against the protocol and Claude's recorded theme sets, not Claude Desktop's own chrome (risk R4).

```bash
npm run build --workspace=packages/mcp-apps     # dist/views.html
npm run test:e2e --workspace=packages/mcp-apps  # builds the host page, then runs the specs
```

CI runs it in the `mcp-apps-e2e` job, with no retries.

## How it works

- **Server.** Each test starts the standalone stdio server (`packages/server/src/mcp/stdio.ts`, as `scripts/mcp-server.sh` does) with `--app-views-html dist/views.html`, over a fresh copy of the web suite's fixture home (`packages/web/e2e/support/fixture-home.mts`: four repositories, three projects). Nothing on the machine is read.
- **Host page.** `host/host-page.ts`, built to one file by `host/vite.config.ts`, creates the iframe and ext-apps' `AppBridge` with a `PostMessageTransport`. The bridge has no MCP client: every request from the view goes to `window.mcpHostRelay`.
- **Relay.** `support/mcp-host.ts` exposes `mcpHostRelay` to the page. It records each request in `host.calls` and answers a `tools/call` from the same server. `ui/message` and `ui/update-model-context` are recorded and acknowledged; `ui/open-link` is declined.
- **Showing a view.** `host.show(tool, args)` calls the tool on the server as the model would, reads the view from the server (`resources/read`, brand injected), and hands the result to the bridge as tool input and result.
- **Host context.** `support/host-context.ts` takes the host's name, capabilities, display modes and dimensions from the A0 recordings (`docs/plans/mcp-apps-spike-results/`). It takes the theme and style variables from a host set in `test/theme/host-sets.ts` (Claude dark by default). It checks the context against ext-apps' own schema first: the view's ext-apps rejects a context with one unknown style variable and then waits silently.
- **VS Code sets.** VS Code sends `var(--vscode-*)` references, and its webview defines the `--vscode-*` colours itself. So the host context carries only the protocol's variables, and the view is served with the set's `--vscode-*` colours on its root. A theme change mid-view does not update those colours: show a new view instead.
- **No network.** Playwright's router serves the host page and the view from memory on two `.test` origins, with the CSP the resource declares (`support/sandbox.ts`). Any other request is refused, and the fixture fails the test.
- **Page objects.** `support/view-frame.ts`: `ViewFrame` is the shared shell (title, kicker, trail, Back, footer, focus, axe), with lenses for U1, U9, U10 and U11. Specs hold no selectors.
- **Axe.** `ViewFrame.axeViolations()` runs the web suite's axe check inside the view's frame. The view is transparent, so it first paints the host's `--color-background-primary` on the view's root as the ground behind it.

## Checklist rows covered

| Row | Spec |
|---|---|
| A24 2.1 U9 repository: title, four basis tiles, chart, no top sessions, footer, axe (Claude dark) | `specs/u9-repository.spec.ts` |
| A24 2.5 U10 → U9 → U1 for projects: tool call per level, kickers, trail, Back with focus return, no model turn, axe at each level | `specs/u10-project-chain.spec.ts` |
| A24 2.5 "Ask about this session" sends only `Analyse session <id>` | `specs/u10-project-chain.spec.ts` |
| A24 2.7 U11 project: period tiles, Change, Not explained, waterfall, model table, axe (Claude dark) | `specs/u11-cost-change.spec.ts` |

Not yet covered: A16 §2 (U1-U3), A24 2.2-2.4, 2.6, 2.8-2.11, Claude light, the VS Code sets, narrow and fullscreen. The harness supports each of these; only the specs are missing. A24 2.10 (permission prompts) can prove only that a drill-down is a plain `tools/call`: the fake host has no permission prompt (risk R4).

## Adding a spec

1. Name the test after the checklist row it covers: `test("A24 2.3 …", …)`.
2. Import `test` and `expect` from `support/host-fixture.ts`. Use `test.use({ hostSet: CLAUDE_LIGHT })` for another theme set, or `test.use({ hostKind: "vscode", hostSet: VSCODE_SETS[1] })` for a VS Code host (VS Code's tool naming, capabilities and only the inline mode).
3. Show the view with `host.show(tool, args, { width: 360 })` or `{ displayMode: "fullscreen" }` (Claude only). Pass explicit dates: the stdio server ignores `AGENT_COST_ANALYZER_NOW` and runs on the real clock. Portal's figures are in two currencies (AI Credits and USD), which A24 2.3 needs.
4. Read the view through `ViewFrame` and its lenses. Add a domain-named method there rather than a selector in the spec.
5. Assert on `host.calls` with `support/call-log.ts`: `toolCallsIn` (which tools the view called), `modelTurnsIn` (nothing reaches the model on a drill-down), and `messagesOffTemplate` (only the fixed template).
6. Change the host context mid-test with `host.changeHostContext({ theme, styles, containerDimensions })`.
7. End each stop with `expect(await view.axeViolations()).toEqual([])`.
