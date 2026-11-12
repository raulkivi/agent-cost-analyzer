# Developer documentation

**Last changed:** 2026-11-12 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

For people building or changing Agent Cost Analyzer and the AI Credits
Analyzer extension. Users: start at the [root README](../README.md).
Contribution rules are in [CONTRIBUTING.md](../CONTRIBUTING.md); guidance
for AI coding agents is in [AGENTS.md](../AGENTS.md) and
[CLAUDE.md](../CLAUDE.md).

## Build and test

Needs Node.js 22 or newer. From the repo root:

```sh
npm ci
npm run dev         # API server (127.0.0.1:3001) and web app (127.0.0.1:5173)
npm test            # vitest for every workspace
npm run lint        # eslint across the repo
npm run typecheck   # tsc --noEmit for every workspace, test files included
npm run build       # type-check and build every workspace
```

Extension build, test and packaging commands:
[CONTRIBUTING.md](../CONTRIBUTING.md#working-on-the-vs-code-extension).

## Repo layout

An npm workspace:

- `packages/domain`: shared zod schemas.
- `packages/server`: Express API and log providers.
- `packages/web`: Vite and React UI.
- `packages/mcp-apps`: interactive views for MCP Apps hosts.
- `packages/pi-system-prompt-logger`: optional pi extension, see its
  [README](../packages/pi-system-prompt-logger/README.md).
- `packages/vscode-extension`: the AI Credits Analyzer extension, which
  reuses the other packages.

## Documentation index

- [Session handover](session-handover.md): where the work stands, how to
  release, open decisions and next candidates.
- [Standalone app: setup and data sources](standalone-app.md): install,
  run, provider log locations, Copilot Chat settings and a tour of the app.
- [User Guide](UserGuide.md) — illustrated walkthrough of the
  standalone app's Learn mode and Analyze mode, screen by screen.
- [VS Code extension guide](vscode-extension-guide.md) — install, use
  and configure the AI Credits Analyzer extension (Copilot only).
- [Vision](vision.md) — the problem, goals, product concept (Learn vs.
  Analyze mode), data sources, and non-goals.
- [Architecture](architecture.md) — system design: components, domain
  model, data flow, API design, tech stack, and project structure.
- [Implementation plan](implementation-plan.md) — phase-by-phase build
  plan with exit criteria and dependencies.
- [Agentic coding explained](agentic-coding-explained.md) — reference
  document on sessions, turns, tool calls, prompt caching, and token
  accounting; the source material Learn mode's scenarios are seeded from.
- [Learn-mode scenarios](scenarios/README.md) — indexed worked examples
  for all 18 bundled scenarios, each with a per-turn token/cache table and,
  where useful, a sequence diagram or bar chart.
- [Learn scenarios fact-check](learn-scenarios-fact-check.md) — every
  scenario claim checked against Anthropic, OpenAI, Google, xAI, GitHub and
  VS Code docs, with sources, fixed slips and proposed re-models.
- [AI-assisted coding terminology](terminology.md) — alphabetical
  glossary of AI-assisted coding terms, cross-referenced with the reference
  document above.
- [Copilot Chat source investigation](copilot-chat-source-investigation.md) —
  findings from inspecting the Copilot Chat extension's own source for
  richer cache/token-usage log data than `main.jsonl` carries.
- [mitmproxy setup](mitmproxy-setup.md) — how to install mitmproxy,
  trust its CA, capture LLM-provider traffic, and export it as a `.har`
  file the app's `mitmproxy` provider can read.
- [Threat model](threat-model.md) — trust boundaries, STRIDE analysis
  of the API/data-source surface, and verified mitigations (path
  traversal, SQL injection, XSS, CSRF) vs. residual risks.
- [Tool-call audit plan](plans/tool-call-audit.md) — design and
  decisions for the tool-call audit (outcomes, failure classification,
  cross-session rollup, audit charts) and its read-only MCP server
  (`scripts/mcp-server.sh`; see the User Guide's "Querying the audit from
  Claude Code").
- [MCP tools v2 plan](plans/mcp-tools-v2.md) — assessment of the MCP
  tools and the Phase 9.12 additions: session and cross-provider cost,
  security/anomaly/behaviour findings, a one-turn drill-down, server
  instructions and output schemas.
- [MCP Apps plan](plans/mcp-apps.md) — Phase 12 (MVP released in
  extension 0.4.0 and app 0.10.0; Increment 2 released in extension 0.6.0
  and app 0.11.0 on 2026-11-11; handover in
  [mcp-apps-handover.md](plans/mcp-apps-handover.md)):
  branded, interactive views (session cost, spend rollup, findings, cost
  over time, cost comparison, cost change) that MCP Apps hosts such as VS
  Code Copilot Chat and Claude Desktop render next to the MCP tool
  results. Includes the use-case analysis, branding rules and tasks.
- [Analyze session replay plan](plans/analyze-session-replay.md) —
  Phase 14 (steps 14.0–14.7 built; the docs are in the owner's review):
  replay a real Claude Code or Copilot session on another model, beside
  what it really cost, with a self-check on its own model and a Compare
  models view, in both products and through MCP. See the User Guide's
  [Replaying a session on another model](UserGuide.md#replaying-a-session-on-another-model).
- [Cost by repository and project plan](plans/cost-by-repository-and-project.md) —
  Phase 15 (steps 15.0–15.15 done; the owner's review of the docs and the
  exit criterion on real data are open): attribute cost to repositories, group them into
  projects, compare them over time, split a project by vendor and model,
  versioned model prices with price-change markers, billing statements
  and estimates.
- [Insights dashboard plan](plans/insights-dashboard.md) — design and
  decisions for the QlikView-style associative dashboard across every
  provider: cost and tokens, tool calls and failures, and security
  signals (risky commands, anomalies, behaviour changes) that say what
  happened, when and why.
- [VS Code extension plan](plans/vscode-extension.md) — Phase 10
  (code and docs done through step 10.11; screenshots and release pending): AI Credits
  Analyzer, a separate, Copilot-only VS Code extension in
  `packages/vscode-extension` that shares code with this standalone app
  (Agent Cost Analyzer). It covers the code analysis, the test-first steps
  with their status, the product boundary, and shipping to the Marketplace
  and Open VSX.
- [VS Code extension manual checks](plans/vscode-extension-manual-checks.md) —
  the checks the owner runs in a real VS Code before each extension
  release: usability script, MCP server in Copilot agent mode, and remote
  windows.
- [Classic subagent credits plan](plans/classic-subagent-credits.md) —
  proposed: counting the AI Credits that classic Copilot Chat subagents
  log to sibling files next to `main.jsonl`, with measured impact, format
  facts, options and open questions.
- [Automated pre-release UI gate](plans/release-ui-gate.md) —
  step 10.17 (planned): no hand checklist gates a release; wdio for VS
  Code and Copilot, Playwright for web.
- [VS Code UI automation plan](plans/vscode-ui-automation.md) —
  step 10.16 (merged): automating the manual
  checks that need a real VS Code window with `wdio-vscode-service` under
  xvfb.
- [pi-system-prompt-logger](../packages/pi-system-prompt-logger/README.md) —
  optional Pi coding-agent extension, vendored in this repo, that captures
  pi's assembled system prompt to a JSONL sidecar log so Analyze mode's
  system prompt inspector can show it for pi sessions. `npm run configure`
  offers to build and install it for you; see that README for manual
  install steps or to change the install location.

- [Implementation plan status (Gantt)](implementation-plan-gantt.md): current
  phase status, percentages and open items.
- [Contributing](../CONTRIBUTING.md): how to propose and test a change.
