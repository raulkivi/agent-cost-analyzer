# Implementation plan — Gantt

Timeline of [implementation-plan.md](implementation-plan.md) phases. Percentages are step-based: done phases 100%, minus open owner reviews or manual checks; Phase 14 is 7 of 9 steps. Dates are first-commit to merge dates from git history (as of 2026-11-07); not-started phases have no dates and are listed below the chart.

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "darkMode": true,
    "background": "#0d1117",
    "textColor": "#e6edf3",
    "primaryTextColor": "#e6edf3",
    "lineColor": "#8b949e",
    "sectionBkgColor": "#161b22",
    "sectionBkgColor2": "#1c2129",
    "altSectionBkgColor": "#0d1117",
    "gridColor": "#30363d",
    "todayLineColor": "#f85149",
    "taskBkgColor": "#1f6feb",
    "taskBorderColor": "#58a6ff",
    "taskTextColor": "#ffffff",
    "taskTextLightColor": "#ffffff",
    "taskTextDarkColor": "#ffffff",
    "taskTextOutsideColor": "#e6edf3",
    "doneTaskBkgColor": "#238636",
    "doneTaskBorderColor": "#3fb950",
    "activeTaskBkgColor": "#9e6a03",
    "activeTaskBorderColor": "#d29922",
    "critBkgColor": "#da3633",
    "critBorderColor": "#f85149"
  }
}}%%
gantt
    title Agent Cost Analyzer — implementation phases
    dateFormat YYYY-MM-DD
    axisFormat %m-%d

    section Foundation
    0 Repo scaffolding (100%)               :done, p0, 2026-08-08, 1d
    1 Domain model (100%)                   :done, p1, 2026-08-08, 1d
    2 Learn mode (100%)                     :done, p2, 2026-08-08, 1d
    3 Analyze structural data (100%)        :done, p3, 2026-08-08, 1d
    4 main.jsonl enrichment (100%)          :done, p4, 2026-08-08, 1d
    5 Startup config check (100%)           :done, p5, 2026-08-08, 1d
    6 Analyze-only extras (100%)            :done, p6, 2026-08-08, 1d
    7 Visualization polish (100%)           :done, p7, 2026-08-08, 1d
    8 Industry design system (100%)         :done, p8, 2026-08-08, 1d

    section Log providers
    9 Providers and mitmproxy (100%)        :done, p9, 2026-08-09, 2d
    9.5 Turn inspector (100%)               :done, p95, 2026-08-10, 1d
    9.6 pi provider (100%)                  :done, p96, 2026-09-02, 1d
    9.7 Vendor pi logger (100%)             :done, p97, 2026-09-03, 1d
    9.8 pi logger sidecar (100%)            :done, p98, 2026-09-04, 1d
    9.9 Claude Code provider (100%)         :done, p99, 2026-09-09, 1d

    section Audit and insights
    9.10 Tool-call audit and MCP (100%)     :done, p910, 2026-10-09, 1d
    9.11 Insights dashboard (100%)          :done, p911, 2026-10-12, 1d
    9.12 MCP tools v2 (100%)                :done, p912, 2026-10-12, 1d

    section VS Code extension
    10.0-10.12 Extension build (95%)       :done, p10a, 2026-10-24, 2d
    10.9/10.10 manual checks, review (5%)  :active, p10ar, after p10a, 1d
    10.13-10.15 Agent Host sessions (100%)  :done, p10b, 2026-10-28, 6d
    10.16 UI automation (90%)              :done, p10c, 2026-11-04, 2d
    10.16 owner decisions (10%)            :active, p10cr, after p10c, 1d

    section Simulation and replay
    13 Vendor-aware Learn simulation (95%) :done, p13, 2026-11-04, 4d
    13.8 owner review (5%)                 :active, p13r, after p13, 1d
    14.0-14.6 replay core, API, mock-ups (78%) :done, p14, 2026-11-07, 1d
    14.7-14.8 UI, docs (22%)               :active, p14r, after p14, 3d

    section Cost
    15 Cost by repository and project (95%) :done, p15, 2026-11-05, 3d
    15.15 owner review, real data (5%)     :active, p15r, after p15, 1d

    section Releases
    App v0.3.0-alpha :milestone, r0, 2026-08-09, 0d
    App v0.4.0-alpha :milestone, r1, 2026-08-10, 0d
    App v0.5.0-alpha :milestone, r2, 2026-09-04, 0d
    App v0.6.0-alpha :milestone, r3, 2026-09-09, 0d
    App v0.7.0-alpha :milestone, r4, 2026-09-09, 0d
    App v0.8.0-alpha :milestone, r5, 2026-10-12, 0d
    App v0.9.0-alpha :milestone, r6, 2026-10-24, 0d
    Extension 0.1.0 :milestone, r7, 2026-11-03, 0d
    Extension 0.2.0 :milestone, r8, 2026-11-06, 0d
    Extension 0.2.1 :milestone, r9, 2026-11-06, 0d
```

## Not started

- Phase 11 (0%) — pi provider real-capture verification.
- Phase 12 (0%) — MCP Apps: interactive views in the chat. See [Phase 12 detail](#phase-12-detail--mcp-apps).

## Open items

- Phase 14: steps 14.0-14.6 merged (14.6's boards approved by the owner), 14.7 (UI) in progress. See [Phase 14 detail](#phase-14-detail--analyze-session-replay).
- Phase 15: owner's review and exit criterion on real data.
- Phase 13: owner's eyes-on review of step 13.8.

## Phase 12 detail — MCP Apps

Schedule view of the task table in [mcp-apps.md](plans/mcp-apps.md) §7. The design, exit criterion and risks stay there; this file only sequences the work.

- Status: planned, not started (0%). Blocked on Phase 10 step 10.13's release dependency per [implementation-plan.md](implementation-plan.md).
- Estimates, not commitments: low = 1 day, medium = 2 days, spike = 1 day. Weekends are excluded. The start date 2026-11-09 is a placeholder.
- Labels carry task ID, model and complexity. The critical path is marked red.
- A12 is dropped if the A0 spike shows hosts block `vscode://` links (the button then copies a command).

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "darkMode": true,
    "background": "#0d1117",
    "textColor": "#e6edf3",
    "primaryTextColor": "#e6edf3",
    "lineColor": "#8b949e",
    "sectionBkgColor": "#161b22",
    "sectionBkgColor2": "#1c2129",
    "altSectionBkgColor": "#0d1117",
    "gridColor": "#30363d",
    "todayLineColor": "#f85149",
    "taskBkgColor": "#1f6feb",
    "taskBorderColor": "#58a6ff",
    "taskTextColor": "#ffffff",
    "taskTextLightColor": "#ffffff",
    "taskTextDarkColor": "#ffffff",
    "taskTextOutsideColor": "#e6edf3",
    "doneTaskBkgColor": "#238636",
    "doneTaskBorderColor": "#3fb950",
    "activeTaskBkgColor": "#9e6a03",
    "activeTaskBorderColor": "#d29922",
    "critBkgColor": "#da3633",
    "critBorderColor": "#f85149"
  }
}}%%
gantt
    title Phase 12 — MCP Apps (estimates)
    dateFormat YYYY-MM-DD
    axisFormat %m-%d
    excludes weekends

    section Spike
    A0 Host spike, medium, Sonnet (0%)           :crit, a0, 2026-11-09, 1d

    section Foundations
    A1 turnSeriesSchema, low, setup6 (0%)        :a1, 2026-11-09, 1d
    A2 injectBrand, low, setup6 (0%)             :a2, 2026-11-09, 1d
    A3 McpIdentity deepLinkBase, low, Haiku (0%) :a3, after a2, 1d
    A4 web package exports, low, Haiku (0%)      :a4, 2026-11-09, 1d

    section Views workspace
    A5 mcp-apps scaffold, medium, Sonnet (0%)    :crit, a5, after a0 a4, 2d
    A6 Theme layering, medium, Sonnet (0%)       :crit, a6, after a5, 2d
    A7 View models, low, setup6 (0%)             :a7, after a1 a5, 1d

    section Server
    A8 registerAppViews, medium, Sonnet (0%)     :crit, a8, after a1 a2 a3, 2d

    section Views
    A9 U1 SessionCostView, medium, Sonnet (0%)   :crit, a9, after a6 a7 a8, 2d
    A10 U2 CostRollupView, medium, Sonnet (0%)   :a10, after a9, 2d
    A11 U3 FindingsView, medium, Sonnet (0%)     :a11, after a6 a7 a8, 2d

    section Extension and packaging
    A12 Deep link URI handler, medium, Sonnet (0%) :a12, after a0, 2d
    A13 Packaging, medium, Sonnet (0%)           :a13, after a8, 2d

    section Review and release
    A14 A11y and security review, medium, Opus (0%) :a14, after a9 a10 a11, 2d
    A15 Docs, medium, Sonnet (0%)                :a15, after a13 a14, 2d
    A16 Owner manual checks (0%)                 :a16, after a15, 1d
```

### Critical path

A0 → A5 → A6 → A9 → A14 → A15 → A16.

### Parallel lanes

- A1, A2, A4 start together; A3 follows A2.
- A12 runs beside A5-A8 once A0 finishes.
- A10 and A11 run in parallel after A9 and A6-A8.

## Phase 14 detail — Analyze session replay

Schedule view of the step table in [analyze-session-replay.md](plans/analyze-session-replay.md) §12. Design, decisions and risks stay there; this file only sequences the work.

- Status (2026-11-07): steps 14.0-14.6 merged (7 of 9, 78%); 14.7 in progress. 14.7-14.8 are estimates.
- Estimates: API/RPC/MCP 2 days, mock-ups 2 days, UI 3 days, docs 2 days. Weekends are excluded.
- 14.6 needs the owner's approval of the boards before 14.7 starts.

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "darkMode": true,
    "background": "#0d1117",
    "textColor": "#e6edf3",
    "primaryTextColor": "#e6edf3",
    "lineColor": "#8b949e",
    "sectionBkgColor": "#161b22",
    "sectionBkgColor2": "#1c2129",
    "altSectionBkgColor": "#0d1117",
    "gridColor": "#30363d",
    "todayLineColor": "#f85149",
    "taskBkgColor": "#1f6feb",
    "taskBorderColor": "#58a6ff",
    "taskTextColor": "#ffffff",
    "taskTextLightColor": "#ffffff",
    "taskTextDarkColor": "#ffffff",
    "taskTextOutsideColor": "#e6edf3",
    "doneTaskBkgColor": "#238636",
    "doneTaskBorderColor": "#3fb950",
    "activeTaskBkgColor": "#9e6a03",
    "activeTaskBorderColor": "#d29922",
    "critBkgColor": "#da3633",
    "critBorderColor": "#f85149"
  }
}}%%
gantt
    title Phase 14 — Analyze session replay
    dateFormat YYYY-MM-DD
    axisFormat %m-%d
    excludes weekends

    section Done
    14.0 Decisions D1-D8, threat model (100%)       :done, s0, 2026-11-07, 1d
    14.1 RequestTrace, SessionReplay schemas (100%) :done, s1, 2026-11-07, 1d
    14.2 RequestTraceSource (100%)                  :done, s2, 2026-11-07, 1d
    14.3 RequestTraceScripter (100%)                :done, s3, 2026-11-07, 1d
    14.4 SessionReplayService, self-check (100%)    :done, s4, 2026-11-07, 1d
    14.5 API routes, RPC, MCP tools (100%)          :done, s5, 2026-11-07, 1d
    14.6 Mock-ups, owner approval (100%)            :done, s6, 2026-11-07, 1d

    section Remaining
    14.7 UI in app and extension (50%)              :active, crit, s7, 2026-11-07, 3d
    14.8 Docs, owner review (0%)                    :crit, s8, after s7, 2d
```

### Critical path

14.7 → 14.8 (14.5 and 14.6 done).

### Exit criteria per open step

- 14.7: component, axe and keyboard tests; UI check in three VS Code themes; scenarios pass in `web-e2e` and `extension-ui`.
- 14.8: owner reviews.
