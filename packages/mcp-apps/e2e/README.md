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
- **Page objects.** `support/view-frame.ts`: `ViewFrame` is the shared shell (title, kicker, trail, Back, footer, focus, axe), with lenses for U1, U2, U3, U4, U5, U9, U10, U11, U12, U13, U14 and U15. `host.showResult(tool, structuredContent, { answers })` shows a canned result (and answers the view's own tool calls) for states the fixture home cannot produce. Specs hold no selectors.
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
| A27 U12 compare and replay: real server (own-model check, tool order, click a model, Back and focus, no model turn) and the board states a fixture home cannot produce (§9.2 Q1-Q5: floor, Unknown, failed self-check, chart cues, gap; boards 8-10: Unknown replay, 360 px) | `specs/u12-replay.spec.ts` |
| A16 §2 U1: tiles, chart, top turns, a turn opens and hides, no copy button in Claude | `specs/a16-session-views.spec.ts` |
| A16 §2 "Unknown, never 0" | `specs/a16-session-views.spec.ts` |
| A16 §2 U2: tiles, charts, session drill-down, Back to cost rollup, Ask about this session | `specs/a16-session-views.spec.ts` |
| A16 §2 U3: tiles, filters reload through `list_findings`, evidence collapsed, then plain text | `specs/a16-session-views.spec.ts` |
| A16 §2 keyboard: Tab and Enter drill-downs, Back returns focus, focus ring visible | `specs/a16-session-views.spec.ts` |
| A16 §2 narrow 360 px and fullscreen for U1-U3 | `specs/layout-footer-permissions.spec.ts` |
| A31 U9 and U2 fullscreen: Fullscreen requests the mode, the host switches, the control reads Exit fullscreen and keeps focus, the card widens with no sideways scroll; axe in both modes (both Claude themes) | `specs/layout-footer-permissions.spec.ts` |
| A29 board 4 / §9.2 Q13 U14 draft statement: totals per currency, one table per currency (AI Credits first), five columns; Channel hidden at 360 px, no sideways scroll | `specs/u14-u15-billing.spec.ts` |
| A29 board 3 / §9.2 Q14 U14 read-only: no issue, re-issue or export control, no tool call or message; a draft that cannot be issued yet says why | `specs/u14-u15-billing.spec.ts` |
| A29 board 7 / §9.2 Q15 U15 refusal: reason, every figure Unknown, no range bar, no run rate | `specs/u14-u15-billing.spec.ts` |
| A29 board 6 / §9.2 Q16 U15 on another model: "estimate" and "Simulated" tags, replay coverage, turns not replayed, self-check count | `specs/u14-u15-billing.spec.ts` |
| A29 board 15 U15 at 360 px, plain and simulated: no sideways scroll | `specs/u14-u15-billing.spec.ts` |
| A30 U5 list: rows with title, short id, turns, model and no cost; an Analyse button on every row; the hint that only the fixed text is sent | `specs/a30-audit-picker.spec.ts` |
| A30 U5 Analyse sends exactly one message matching `Analyse session <id>` (no title, no other host call), the button turns into a disabled Sent, and pressing it again sends nothing; by keyboard too | `specs/a30-audit-picker.spec.ts` |
| A30 U5 the host declines (owner, 2026-11-11, §9.2 Q7: try, then fall back): that row reads "Ask in the chat: Analyse session <id>" in place of its button, the other rows keep Analyse, one attempt only; 360 px with no sideways scroll | `specs/a30-audit-picker.spec.ts` |
| A30 U5 in a VS Code host (recorded capabilities with no `message`, one VS Code set): Analyse on every row, the click sends the fixed template, then Sent | `specs/a30-audit-picker.spec.ts` |
| A30 U5 no match: "No sessions match" and what to try, no button; 360 px with no sideways scroll | `specs/a30-audit-picker.spec.ts` |
| A30 U4 session and rollup: tiles with the failure rate Unknown (never 0 %) where no tool call is recorded, recovery cost labelled "tokens, not AI Credits", no chart without days, a display-only sessions table, no host call; 360 px | `specs/a30-audit-picker.spec.ts` |
| A32 U14 issued statement with a diff (canned result): Issued status, the amber "the issued copy stays the statement of record" alert, changed, added ("no earlier figure") and removed lines, per-currency totals, what else changed, no control but the three scrollable tables, no host call; a re-run that matches; 360 px | `specs/a32-coverage-gaps.spec.ts` |
| A32 U15 estimate with a p50–p90 range (canned result): the range bar named with both ends, the "estimate" tag, no run rate or other single number; the simulated variant with a range, "Simulated" tag, replay coverage and a failed self-check named; 360 px for both; no host call | `specs/a32-coverage-gaps.spec.ts` |
| A32 U13 inferred rise beside a documented change (canned result): one timeline counting both, the observed mark dashed and the documented one not, the "inferred" tag, "+12 %" in red, the weekly billed-against-priced table, the documented entry's source; no host call; 360 px | `specs/a32-coverage-gaps.spec.ts` |
| A32 U4 with failed calls (canned results): the session's tiles, six categories, recovery cost in "tokens, not AI Credits", retried commands and by-tool tables; the rollup's failed calls per day with an unknown day as a hatched gap, and as a table (View as table, Unknown written), categories, top failing commands and the display-only sessions table; no tool call or model turn; 360 px for both | `specs/a32-coverage-gaps.spec.ts` |

Not in a fake host:

- **A28, an observed (inferred) change in U13, from the real server.** The fixture's Copilot sessions are too few for one (20 turns a week, two weeks in a row). Since A32 the built view shows one from a canned result (`specs/a32-coverage-gaps.spec.ts`, a rise beside a documented change), and `PriceChangesView.test.tsx` covers the rest. The fixture price book in the range has only falls, so the real-server spec checks the fall hue and the canned one the rise.
- **A30, U4 with failed calls, from the real server.** The fixture home's sessions record no tool calls, so `a30-audit-picker.spec.ts` sees the Unknown failure rate and no chart. Since A32 the categories, recovery cost, retried commands and the per-day chart with a hatched gap are shown from canned results in `specs/a32-coverage-gaps.spec.ts`, as well as in `audit.test.ts`, `AuditView.test.tsx` and the a11y and hostile-text tests.
- **A24 2.10, whether Claude asks for permission.** The fake host has no permission prompt (risk R4). The spec proves only that a drill-down is a plain `tools/call`.
- **A24 2.6, the title "No projects here" in U10.** `compare_costs` needs two ids and answers an unknown id with a zero-turn row, so the real server never gives U10 an empty result. The spec asserts that answer (Unknown, "no turns", never 0), and U9's error state for an unknown project. `CostCompareView.test.tsx` covers the empty state itself.
- **A24 2.3, two currencies in U11.** U11 uses the priced basis and the fixture's AI Credits are billed, not priced, so U11 has one block. `cost-variance.test.ts` covers two blocks.
- **A24 2.9, U9's own fullscreen layout.** Task A31 builds it. The spec asserts only that U9 renders in fullscreen without scrolling sideways.
- **A29 board 3 and 5, an issued statement with a diff and an estimate range.** The fixture home has no issued statement (issuing is an app action) and only 4 priced active days, under the 5 an estimate needs, so the real server gives a draft and a refusal. Since A32 the built view shows both from canned results in `specs/a32-coverage-gaps.spec.ts`; `StatementView.test.tsx` and `EstimateView.test.tsx` cover them too.
- **Claude Desktop's own chrome, the VS Code sets, A16 §1 and A24 §1.** Step 10.17 G4 and G6 cover the VS Code rows in Copilot Chat. The harness runs VS Code sets (`hostKind: "vscode"`); only the A30 U5 VS Code row uses one, to show that a host advertising no `message` still gets Analyse. G4 (A33) confirms in real Copilot Chat that it sends.

## Adding a spec

1. Name the test after the checklist row it covers: `test("A24 2.3 …", …)`.
2. Import `test` and `expect` from `support/host-fixture.ts`. Wrap Claude specs in `inEachClaudeSet(() => { … })` to run them in light and dark. Use `test.use({ withProjects: false })` for a fixture home without projects, `test.use({ hostSet: CLAUDE_LIGHT })` for one theme set, or `test.use({ hostKind: "vscode", hostSet: VSCODE_SETS[1] })` for a VS Code host (VS Code's tool naming, capabilities and only the inline mode).
3. Show the view with `host.show(tool, args, { width: 360 })` or `{ displayMode: "fullscreen" }` (Claude only). Pass explicit dates: the stdio server ignores `AGENT_COST_ANALYZER_NOW` and runs on the real clock. Portal's figures are in two currencies (AI Credits and USD), which A24 2.3 needs.
4. Read the view through `ViewFrame` and its lenses. Add a domain-named method there rather than a selector in the spec.
5. Assert on `host.calls` with `support/call-log.ts`: `toolCallsIn` (which tools the view called), `modelTurnsIn` (nothing reaches the model on a drill-down), and `messagesOffTemplate` (only the fixed template).
6. Change the host context mid-test with `host.changeHostContext({ theme, styles, containerDimensions })`.
7. End each stop with `expect(await view.axeViolations()).toEqual([])`.
