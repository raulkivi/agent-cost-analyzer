# Implementation plan — Gantt

**Last changed:** 2026-11-14 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Timeline of [implementation-plan.md](implementation-plan.md) phases. Percentages are step-based: done phases 100%, minus open owner reviews or manual checks; Phase 14 is 8 of 9 steps, with 14.8's docs written and in the owner's review. Dates are first-commit to merge dates from git history (as of 2026-11-07); not-started phases have no dates and are listed below the chart.

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
    "excludeBkgColor": "#161b22",
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
    10.16 UI automation (100%)             :done, p10c, 2026-11-04, 2d
    10.17 Release UI gate (100%)           :done, p10d, after p10c, 1d
    10.18 Copilot empty-window sessions (100%) :done, p10e, 2026-11-11, 1d
    10.19 Classic subagent AI Credits (100%) :done, p10f, 2026-11-12, 2d
    10.21 Monthly allowance gauge (100%)   :done, p10g, 2026-11-12, 2d
    10.22 Extension demo recordings (77%, 17 of 22 tasks) :active, p10h, 2026-11-13, 3d
    10.23 Claude Desktop demo recordings (0%, not started) :p10i, after p10h, 3d

    section Simulation and replay
    13 Vendor-aware Learn simulation (95%) :done, p13, 2026-11-04, 4d
    13.8 owner review (5%)                 :active, p13r, after p13, 1d
    14.0-14.7 replay core, API, mock-ups, UI (89%) :done, p14, 2026-11-07, 1d
    14.8 docs written, owner review (11%)  :active, p14r, after p14, 1d

    section MCP Apps
    12 MVP A0-A16: foundations, server, views U1-U3, packaging, review, docs, owner checks (47%) :done, p12a, 2026-11-07, 2d
    12 Increments 2 and 3 (19 of 19 tasks) :done, p12b, after p12a, 1d
    12 MCP SDK 2 migration M0-M6 (100%) :done, p12c, 2026-11-12, 1d

    section Cost
    15 Cost by repository and project (95%) :done, p15, 2026-11-05, 3d
    15.15 owner review, real data (5%)     :active, p15r, after p15, 1d

    section Savings
    16 Savings report (78%, 18 of 23 tasks) :active, p16, 2026-11-12, 2d

    section UI density
    17 Dense ledger UI (57%, 8 of 14 tasks)  :active, p17, 2026-11-14, 5d

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
    Extension 0.4.0, App v0.10.0 :milestone, r10, 2026-11-10, 0d
    Extension 0.5.0 pre-release :milestone, r11, 2026-11-10, 0d
    Extension 0.6.0, App v0.11.0 :milestone, r12, 2026-11-11, 0d
    Extension 0.8.0, App v0.12.0 :milestone, r13, 2026-11-12, 0d
    Extension 0.10.0, App v0.13.0 :milestone, r14, 2026-11-12, 0d
    Extension 0.12.0, App v0.14.0 (prepared) :milestone, r15, 2026-11-13, 0d
```

## Not started

- Phase 11 (0%) — pi provider real-capture verification.
- Step 10.23 (0%) — Claude Desktop demo recordings; starts after step 10.22's Phase 1 exit.

## Open items

- Release prepared 2026-11-13: extension 0.12.0 and app 0.14.0 carry steps 10.19 and 10.21 and Phase 16 Increment 1. Before tagging: the savings exit criterion on real data, D13-D15, then the real-Copilot gate.
- Step 10.19 (classic subagent AI Credits, 100%): done 2026-11-13 (SA0 to SA18, 20 of 20 tasks; exit criterion met: `npm run test:real-data` passed 10 of 10 on the owner's logs, 177.64 AI Credits added, owner sign-off 2026-11-13). Before release: the real-Copilot gate. Plan: [classic-subagent-credits-implementation.md](plans/classic-subagent-credits-implementation.md). Step 10.20 (subagent tool calls in the audit) is a follow-up, not planned.
- Step 10.21 (monthly allowance gauge, 100%): done 2026-11-13 (MA0 to MA12, 14 of 14 tasks; exit criterion met, review in plan §14). Before release: the real-Copilot check of the gauge in a live window (release UI gate). MA13 (standalone app) is a later increment. The Sessions row is hidden while VS Code's filter is active (plan §3.8). Plan: [monthly-allowance.md](plans/monthly-allowance.md).
- Step 10.22 (extension demo recordings, 77%, 17 of 22 tasks): tasks 1.10-1.14 are held until Phase 17 merges (owner decision D2, 2026-11-14), then retaken once in the new look. Owner accepted D1-D8 and D10-D12 on 2026-11-13 (E11 not recorded). Phase 0 (text fixes 0.1-0.3) done 2026-11-13 (PR #255), to land before the 0.12.0/0.14.0 tags (D1); owner to check two findings in the plan's §11 (replay UI doesn't list left-out subagent runs; Learn count 17 vs 18); then Phase 1: spike 1.0 done (frame 1200x800, plan §5), tooling 1.1-1.5, fixture 1.6a, scenes 1.6b-1.6e, real-Copilot scenes 1.7 (written; owner runs the paid takes) stills 1.8 and app task 1.9 done; next the final takes and owner review (1.10), held until Phase 17 merges; then scenes 1.6a-1.10 and docs 1.11-1.14. Plan: [docs-refresh-and-demo-recordings.md](plans/docs-refresh-and-demo-recordings.md).
- Phase 17 (dense ledger UI, 57%, 8 of 14 tasks): Increment 1 (P0-P7) done 2026-11-14; the Dashboard on the e2e fixture went from 2,444px to 1,467px tall at 1440x900 (`density.spec.ts`). Increment 1 (P1-P7) is the density pass in every host; Increment 2 (L1-L6) is the standalone ledger theme with light and dark modes. It holds step 10.22 tasks 1.10-1.14 until it merges (owner decision D2). Plan: [dense-ledger-ui.md](plans/dense-ledger-ui.md).
- Phase 16 (savings report, 78%, 18 of 23 tasks): Increment 1 (SR0-SR17) done 2026-11-13, code and docs; SR16 review in plan §16 (5 findings fixed, 3 recorded). Open: owner review of the docs and the exit criterion on real data (30 days of Claude Code and Copilot sessions, one idle-expiry break and one unused tool checked by hand), D13-D15 owner decisions (SR7 thresholds, the active-provider switch from "Open in Analyze"), the release, then Increment 2 (SR18-SR22: MCP tool and view U18), not started. Plan: [savings-report.md](plans/savings-report.md).
- Phase 14: steps 14.0-14.7 built; 14.8's docs written, the owner's review and the §13 exit criterion on real sessions open; the extension guide's replay screenshots open (User Guide's done). Step table: [analyze-session-replay.md](plans/analyze-session-replay.md) §12.
- Phase 15: owner's review and exit criterion on real data.
- Phase 13: owner's eyes-on review of step 13.8.
- Phase 12 (done): the owner's decisions on U5's "Sent" label and Claude Desktop permission prompts ([mcp-apps.md](plans/mcp-apps.md) §6.1); follow-ups in §11. Record: [mcp-apps-handover.md](plans/mcp-apps-handover.md); current state: [session-handover.md](session-handover.md).

## Steps 10.22 and 10.23 detail — Demo recordings

Schedule view of the task tables in [docs-refresh-and-demo-recordings.md](plans/docs-refresh-and-demo-recordings.md) §6. Status: owner decisions answered 2026-11-13; Phase 0 done; Phase 1 spike 1.0, tooling 1.1-1.5, scenes and stills 1.6a-1.9 done (17 of 22 tasks); final takes and owner review 1.10 next, held until Phase 17 merges (owner decision D2, 2026-11-14). Phase 2 (step 10.23) starts after Phase 1's exit.

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
    "excludeBkgColor": "#161b22",
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
    title Steps 10.22 and 10.23 — Demo recordings
    dateFormat YYYY-MM-DD
    axisFormat %m-%d

    section Phase 0 text fixes
    0.1-0.3 README, UserGuide, extension docs (100%) :done, d0, 2026-11-13, 1d

    section Phase 1 tooling
    1.0 ffmpeg under Xvfb spike (100%)              :done, d10, after d0, 1d
    1.1-1.5 Pure modules, launcher, configs, helpers, GIF (100%) :done, d11, after d10, 2d

    section Phase 1 recording
    1.6a-1.9 Fixture, scenes, stills, app (100%)    :done, d16, after d11, 2d
    1.10 Final takes, owner review (0%)            :active, d110, after d16, 1d

    section Phase 1 docs
    1.11-1.14 Docs with media (0%)                 :d111, after d110, 1d

    section Phase 2 (step 10.23)
    2.0-2.6 Claude Desktop and fake host (0%, not started) :d20, after d111, 3d
```

## Phase 16 detail — Savings report

Schedule view of the task table in [savings-report.md](plans/savings-report.md) §10. Status: Increment 1 18 of 18 code and docs tasks done (SR0-SR17, 2026-11-12 to 2026-11-13); the owner's docs review, D13-D15 and the release are open. Increment 2 (SR18-SR22) is not started; it begins after Increment 1 is released.

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
    "excludeBkgColor": "#161b22",
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
    title Phase 16 — Savings report
    dateFormat YYYY-MM-DD
    axisFormat %m-%d

    section Increment 1
    SR0 Spike, medium, Sonnet (100%)                 :done, sr0, 2026-11-12, 1d
    SR1-SR9 Schemas, pricer, classifier, detectors, actions (100%) :done, sr1, 2026-11-12, 2d
    SR10 Ranker, service, wiring, high, Opus (100%)  :done, sr10, 2026-11-13, 1d
    SR11 Mock-ups and approval (100%)                :done, sr11, 2026-11-12, 1d
    SR12 Route, RPC, dispatcher (100%)               :done, sr12, 2026-11-13, 1d
    SR13 E2E fixtures (100%)                         :done, sr13, 2026-11-13, 1d
    SR14 Savings tab (100%)                          :done, sr14, 2026-11-13, 1d
    SR15 UI specs (100%)                             :done, sr15, 2026-11-13, 1d
    SR16 A11y and security review, Opus (100%)       :done, sr16, 2026-11-13, 1d
    SR17 Docs, Sonnet (100%)                         :done, sr17, after sr16, 1d

    section Increment 2
    SR18-SR22 MCP tool, U18 view, specs, review (0%, not started) :sr18, after sr17, 5d
```

## Phase 17 detail — Dense ledger UI

Schedule view of the task tables in [dense-ledger-ui.md](plans/dense-ledger-ui.md) §6. Status: Increment 1 (P0-P7) done 2026-11-14, 8 of 14 tasks. Increment 2 (L1-L6) starts after Increment 1 merges; step 10.22 tasks 1.10-1.14 wait for the merge (owner decision D2).

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
    "excludeBkgColor": "#161b22",
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
    title Phase 17 — Dense ledger UI
    dateFormat YYYY-MM-DD
    axisFormat %m-%d

    section Increment 1 density
    P0 Docs, low, Sonnet (100%)                      :done, pp0, 2026-11-14, 1d
    P1 Tokens and base density, medium, Sonnet (100%)  :done, pp1, after pp0, 1d
    P2 Toolbar row, medium, Sonnet (100%)              :done, pp2, after pp1, 1d
    P3 Session list, medium, Sonnet (100%)             :done, pp3, after pp1, 1d
    P4 KPI strip and Savings rows, low, Sonnet (100%)  :done, pp4, after pp1, 1d
    P5 Charts and empties, medium, Sonnet (100%)       :done, pp5, after pp1, 1d
    P6 Inline styles and remaining density, medium, Sonnet (100%)     :done, pp6, after pp2, 1d
    P7 density.spec.ts and changelogs, medium, Sonnet (100%) :done, pp7, after pp6, 1d

    section Increment 2 ledger theme
    L1 Theme architecture, high, Opus (0%)           :l1, after pp7, 2d
    L2 Colour-mode switch, medium, Sonnet (0%)       :l2, after l1, 1d
    L3 Ledger component rules, medium, Sonnet (0%)   :l3, after l1, 1d
    L4 Playwright dark and switch, medium, Sonnet (0%) :l4, after l2, 1d
    L5 Docs and media, medium, Sonnet (0%)           :l5, after l4, 1d
    L6 Review, medium, Opus (0%)                     :l6, after l5, 1d
```

## Phase 12 detail — MCP Apps

Schedule view of the task tables in [mcp-apps.md](plans/mcp-apps.md) §7, §7.1 and §7.2. The design, exit criterion and risks stay there; this file only sequences the work.

- Status: done (100%, 36 of 36 tasks; Increment 3 shipped 2026-11-12 in extension 0.8.0 / app 0.12.0; the MVP shipped 2026-11-10 in extension 0.4.0 / app 0.10.0; Increment 2 (A17-A24) shipped 2026-11-11 in extension 0.6.0 / app 0.11.0, A24 done through step 10.17; extension 0.5.0 pre-release published 2026-11-10; A27-A33 done 2026-11-11): A0 done 2026-11-07 (owner ran the spike in VS Code Insiders 1.146 and Claude Desktop; results in `docs/plans/mcp-apps-spike-results/`), A1-A4 done 2026-11-07 (#176), A8 done 2026-11-07 (server views group), A5 done 2026-11-07 (`packages/mcp-apps` scaffold; bundle budget 900 KB by owner decision), A6 done 2026-11-07 (theme layering: `theme-mcp-host.css`, `brand.css`, contrast tests against the fallbacks, the recorded Claude set and the resolved VS Code set), A7 done 2026-11-07 (pure view models for U1-U3 in `packages/mcp-apps/src/view-models/`), A9 done 2026-11-07 (U1 `SessionCostView` with turn drill-down and copy-command button), A10 done 2026-11-07 (U2 `CostRollupView` with in-place drill-down into U1 and a fixed-template "Ask about this session"), A11 done 2026-11-07 (U3 `FindingsView` with kind and severity filters), A13 done 2026-11-07 (build order, `dist/mcp-apps/views.html` in the `.vsix`, `scripts/mcp-server.sh` serving the build), A14 done 2026-11-07 (axe over every view state, keyboard drill-down with focus return, the no-forwarding rule as a static test over every host call site, host style variables filtered, 360px layout fixes; findings in [mcp-apps.md](plans/mcp-apps.md) §6.1), A15 done 2026-11-07 (architecture.md §4.1.1, §4.4 and §11.4, threat-model.md §6.1, implementation-plan.md, User Guide, extension guide, both CHANGELOGs), A0b boards drawn and approved by the owner 2026-11-07 ([mockups/mcp-apps/](plans/mockups/mcp-apps/README.md)); the copy-command text `AI Credits Analyzer: Open Session <id>` adopted. A16 done 2026-11-10 (owner's checks in VS Code Insiders 1.146, Claude Desktop 4.23118.0 and Claude Code pass; 12 findings fixed test-first, among them VS Code's server-prefixed tool names, notes for Unknown input parts, the ranking basis in U1/U2 with an input-tokens chart, the U3 layout, and an `active` flag for sessions with a turn in the last 15 minutes; [results](plans/mcp-apps-a16-results/README.md)). Dependencies met: step 10.13 is done and `ext-v0.1.0` shipped 2026-11-03; the Phase 14 and 15 tools the increments need are done.

- Each increment starts with mock-up boards the owner approves (A0b, A17b, A25b; plan §5.6).
- Scope (updated 2026-11-07): MVP (A0-A16: U1-U3), Increment 2 (A17-A24: cost-analysis views U9-U11), Increment 3 (A25-A33: replay, price changes, statement and estimate, audit, picker). Each increment starts after the previous one's owner checks.
- Target releases (plan §7.3): MVP in extension 0.4.0 / app 0.10.0 (shipped with the Phase 14/15 work), Increment 2 shipped 2026-11-11 in 0.6.0 / 0.11.0, Increment 3 shipped 2026-11-12 in 0.8.0 / 0.12.0. Stable extension releases use even minors; an odd minor goes to the Marketplace pre-release channel.
- Estimates, not commitments: low = 1 day, medium = 2 days, spike = 1 day. Weekends are excluded. The start date 2026-11-09 is a placeholder.
- Labels carry task ID, model and complexity. The critical path is marked red.
- A12 is dropped: the A0 spike showed both hosts refuse `vscode://` links (the button copies a command).

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
    "excludeBkgColor": "#161b22",
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
    A0 Host spike, owner run (100%) :crit, done, a0, 2026-11-07, 1d
    A0b MVP mock-ups, approved (100%)    :done, a0b, 2026-11-07, 1d

    section Foundations
    A1 turnSeriesSchema, low, setup6 (100%)      :done, a1, 2026-11-07, 1d
    A2 injectBrand, low, setup6 (100%)           :done, a2, 2026-11-07, 1d
    A3 McpIdentity deepLinkBase, low, Haiku (100%) :done, a3, 2026-11-07, 1d
    A4 web package exports, low, Haiku (100%)    :done, a4, 2026-11-07, 1d

    section Views workspace
    A5 mcp-apps scaffold, medium, Sonnet (100%)  :done, a5, 2026-11-07, 1d
    A6 Theme layering, medium, Sonnet (100%)     :done, a6, after a5, 2d
    A7 View models, low, setup6 (100%)           :done, a7, 2026-11-07, 1d

    section Server
    A8 registerAppViews, medium, Sonnet (100%)   :done, a8, 2026-11-07, 1d

    section Views
    A9 U1 SessionCostView, medium, Sonnet (100%) :done, a9, after a0b a6 a7 a8, 2d
    A10 U2 CostRollupView, medium, Sonnet (100%) :crit, done, a10, after a9, 2d
    A11 U3 FindingsView, medium, Sonnet (100%)   :done, a11, after a0b a6 a7 a8, 2d

    section Extension and packaging
    A12 Deep link URI handler, dropped (hosts refuse vscode links) :done, a12, after a0, 1d
    A13 Packaging, medium, Sonnet (100%)         :done, a13, after a8, 2d

    section Review and release
    A14 A11y and security review, medium, Opus (100%) :crit, done, a14, after a9 a10 a11, 2d
    A15 Docs, medium, Sonnet (100%)              :crit, done, a15, after a13, 2d
    A16 Owner manual checks (100%)               :crit, done, a16, after a15, 1d

    section Increment 2 — cost analysis
    A17b Inc. 2 mock-ups and approval, medium, Sonnet + owner (100%) :done, a17b, after a16, 3d
    A17 web exports and splits, medium, Sonnet (100%) :done, a17, after a16, 2d
    A18 Cost view models, low, Sonnet (100%)      :done, a18, after a16, 1d
    A19 _meta.ui on cost tools, medium, Sonnet (100%) :done, a19, after a16, 2d
    A20 U9 CostOverTimeView, medium, Sonnet (100%) :done, a20, after a17 a17b a18 a19, 2d
    A21 U10 CostCompareView, medium, Sonnet (100%) :done, a21, after a20, 2d
    A22 U11 CostChangeView, medium, Sonnet (100%) :done, a22, after a17 a17b a18 a19, 2d
    A23 Review and docs, medium, Opus (100%)     :done, a23, after a21 a22, 2d
    A24 Checks, replaced by step 10.17 (100%)    :done, a24, after a23, 1d

    section Increment 3 — replay, prices, billing
    A25b Inc. 3 mock-ups and approval, medium, Sonnet + owner (100%) :done, a25b, after a24, 3d
    A25 View models, low, Sonnet (100%)          :done, a25, after a24, 1d
    A26 _meta.ui on remaining tools, medium, Sonnet (100%) :done, a26, after a24, 2d
    A27 U12 ReplayView, medium, Sonnet (100%) :done, a27, after a25 a25b a26, 2d
    A28 U13 PriceChangesView, medium, Sonnet (100%) :done, a28, after a25 a25b a26, 2d
    A29 U14 U15 Statement and Estimate, medium, Sonnet (100%) :done, a29, after a25 a25b a26, 2d
    A30 U4 U5 Audit and picker, medium, Sonnet (100%) :done, a30, after a25b a26, 2d
    A31 Fullscreen U2 U9, low, Haiku (100%) :done, a31, after a26, 1d
    A32 Review and docs, medium, Opus (100%) :done, a32, after a27 a28 a29 a30 a31, 2d
    A33 Checks as specs (G4 + G5), Opus (100%)   :done, a33, after a32, 1d

    section Target releases
    Ext 0.4.0 / app 0.10.0 (MVP) :milestone, m12a, after a16, 0d
    Ext 0.6.0 / app 0.11.0 (Increment 2) :milestone, m12b, after a24, 0d
    Ext 0.8.0 / app 0.12.0 (Increment 3) :milestone, m12c, after a33, 0d
```

### Critical path

MVP: A5 → A6 → A9 → A10 → A14 → A16 (all done). Increment 2: A17b (mock-ups and approval) → A20 → A21 → A23 → A24 (step 10.17). Increment 2 shipped 2026-11-11. Increment 3: A25b (mock-ups and approval) → A27/A28/A29/A30 → A32 → A33.

### Parallel lanes

- A6 and A7 run in parallel (A5 and A1 done); A13 can start any time (A8 done).
- A9 and A11 start together once A6 and A7 finish; A10 follows A9.
- Increment 2: A17, A17b, A18, A19 start together; A20 and A22 run in parallel.
- Increment 3: A25, A25b and A26 start together; A27-A31 run in parallel.

