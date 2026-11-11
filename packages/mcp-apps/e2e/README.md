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
- **Page objects.** `support/view-frame.ts`: `ViewFrame` is the shared shell (title, kicker, trail, Back, footer, focus, axe), with lenses for U1, U2, U3, U9, U10, U11 and U13. Specs hold no selectors.
- **Axe.** `ViewFrame.axeViolations()` runs the web suite's axe check inside the view's frame. The view is transparent, so it first paints the host's `--color-background-primary` on the view's root as the ground behind it.

## Checklist rows covered

Every spec runs in Claude light and Claude dark (`inEachClaudeSet`), with axe in the view's frame at each stop, unless the row says otherwise.

| Row | Spec |
|---|---|
| A24 2.1 U9 repository: title, four basis tiles, chart, no top sessions, no vendor table, footer | `specs/u9-repository.spec.ts` |
| A24 2.2 U9 project: Project cost kicker, vendor then model, tokens by type, top sessions | `specs/u9-project.spec.ts` |
| A24 2.3 two currencies: U9 tile lines and the Currency control (AI Credits \| USD, AI Credits selected, chart unit switches); U10 cells and Together; U11 headings and the single Not explained tile | `specs/u9-project.spec.ts`, `specs/u10-project-chain.spec.ts`, `specs/u11-cost-change.spec.ts` |
| A24 2.4 U9 → U1: kicker, Back to cost over time, currency kept, focus on the session row, no model turn | `specs/u9-project.spec.ts` |
| A24 2.5 U10 → U9 → U1: tool call per level, kickers, trail, Back with focus return at each level, no model turn | `specs/u10-project-chain.spec.ts` |
| A24 2.5 "Ask about this session" sends only `Analyse session <id>` | `specs/u10-project-chain.spec.ts` |
| A24 2.6 no projects (separate fixture home): what the real server answers, see below | `specs/u10-project-chain.spec.ts` |
| A24 2.7 U11 for a project and for a repository: period tiles, Change, Not explained, waterfall, model table | `specs/u11-cost-change.spec.ts` |
| A24 2.8 waterfall: a fall is green, a rise is red, neither is blue, each with its written sign | `specs/u11-cost-change.spec.ts` |
| A24 2.9 360 px: no sideways scroll for U9, U10, U11, and their narrow layouts; fullscreen renders U9 | `specs/layout-footer-permissions.spec.ts` |
| A24 2.9 U11 at 560 px with turns not explained in both periods: the logged reasons wrap, no sideways scroll (a view bug G4 found in Copilot Chat) | `specs/u11-cost-change.spec.ts` |
| A24 2.10 a drill-down is exactly one plain `tools/call` and nothing else | `specs/layout-footer-permissions.spec.ts` |
| A24 2.11 footer: product name in the kicker, `Read-only · local logs · v<app version>` on all six views | `specs/layout-footer-permissions.spec.ts` |
| A28 U13 direct: timeline, documented changes with % per token type and sources, written signs and hues, empty state, 360 px | `specs/u13-price-changes.spec.ts` |
| A28 U11 → U13: one `get_price_changes` call for U11's period, kicker trail and Back, Back restores U11 with no new call and focus on the button, keyboard, 360 px | `specs/u13-price-changes.spec.ts` |
| A16 §2 U1: tiles, chart, top turns, a turn opens and hides, no copy button in Claude | `specs/a16-session-views.spec.ts` |
| A16 §2 "Unknown, never 0" | `specs/a16-session-views.spec.ts` |
| A16 §2 U2: tiles, charts, session drill-down, Back to cost rollup, Ask about this session | `specs/a16-session-views.spec.ts` |
| A16 §2 U3: tiles, filters reload through `list_findings`, evidence collapsed, then plain text | `specs/a16-session-views.spec.ts` |
| A16 §2 keyboard: Tab and Enter drill-downs, Back returns focus, focus ring visible | `specs/a16-session-views.spec.ts` |
| A16 §2 narrow 360 px and fullscreen for U1-U3 | `specs/layout-footer-permissions.spec.ts` |

Not in a fake host:

- **A28, an observed (inferred) change in U13.** The fixture's Copilot sessions are too few for one (20 turns a week, two weeks in a row), so the inferred rendering is covered by `PriceChangesView.test.tsx`. The rise hue is checked there too: the fixture price book in the range has only falls.

- **A24 2.10, whether Claude asks for permission.** The fake host has no permission prompt (risk R4). The spec proves only that a drill-down is a plain `tools/call`.
- **A24 2.6, the title "No projects here" in U10.** `compare_costs` needs two ids and answers an unknown id with a zero-turn row, so the real server never gives U10 an empty result. The spec asserts that answer (Unknown, "no turns", never 0), and U9's error state for an unknown project. `CostCompareView.test.tsx` covers the empty state itself.
- **A24 2.3, two currencies in U11.** U11 uses the priced basis and the fixture's AI Credits are billed, not priced, so U11 has one block. `cost-variance.test.ts` covers two blocks.
- **A24 2.9, U9's own fullscreen layout.** Task A31 builds it. The spec asserts only that U9 renders in fullscreen without scrolling sideways.
- **Claude Desktop's own chrome, the VS Code sets, A16 §1 and A24 §1.** Step 10.17 G4 and G6 cover the VS Code rows in Copilot Chat. The harness runs VS Code sets (`hostKind: "vscode"`); no spec uses them here.

## Adding a spec

1. Name the test after the checklist row it covers: `test("A24 2.3 …", …)`.
2. Import `test` and `expect` from `support/host-fixture.ts`. Wrap Claude specs in `inEachClaudeSet(() => { … })` to run them in light and dark. Use `test.use({ withProjects: false })` for a fixture home without projects, `test.use({ hostSet: CLAUDE_LIGHT })` for one theme set, or `test.use({ hostKind: "vscode", hostSet: VSCODE_SETS[1] })` for a VS Code host (VS Code's tool naming, capabilities and only the inline mode).
3. Show the view with `host.show(tool, args, { width: 360 })` or `{ displayMode: "fullscreen" }` (Claude only). Pass explicit dates: the stdio server ignores `AGENT_COST_ANALYZER_NOW` and runs on the real clock. Portal's figures are in two currencies (AI Credits and USD), which A24 2.3 needs.
4. Read the view through `ViewFrame` and its lenses. Add a domain-named method there rather than a selector in the spec.
5. Assert on `host.calls` with `support/call-log.ts`: `toolCallsIn` (which tools the view called), `modelTurnsIn` (nothing reaches the model on a drill-down), and `messagesOffTemplate` (only the fixed template).
6. Change the host context mid-test with `host.changeHostContext({ theme, styles, containerDimensions })`.
7. End each stop with `expect(await view.axeViolations()).toEqual([])`.
