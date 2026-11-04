# VS Code UI automation of the manual checks

Status: **code done on a branch, awaiting the owner's decisions and T15
(step 10.16)**; §6 records what was built and learned. Extends
[vscode-extension.md](vscode-extension.md) step 10.9 (integration suite,
manual checks) and step 10.11 (UI check). Automates the rows of
[vscode-extension-manual-checks.md](vscode-extension-manual-checks.md)
§1-§2 that need a real VS Code window, with
[`wdio-vscode-service`](https://github.com/webdriverio-community/wdio-vscode-service)
(WebdriverIO) on Linux under `xvfb-run`.

Today three layers exist:

| Layer | Runs | Reaches | Can't reach |
|---|---|---|---|
| Unit tests (vitest) | `npm test` | Pure code, jsdom | A real VS Code, CSS layout |
| Integration suite (`@vscode/test-cli` 0.0.15 + `@vscode/test-electron` 3.1.0, mocha 12) | `npm run test:integration`, `xvfb-run` in CI | VS Code API, the extension's internal test-hook commands, the MCP server over stdio | Anything rendered: the webview's DOM, tree rows, editor tabs, focus, themes |
| UI check (Playwright 1.64.1, Chromium) | `npm run test:ui` | The real `media/` build with the real `MessageDispatcher`/`ApiService`, VS Code theme variables faked in a page | VS Code's own chrome: iframes, workbench focus, real theme switching, editor tabs, side bar |

The new layer drives the real workbench and the real webview together.

## 1. Goal and non-goals

**Goal:** turn the §1-§2 checks below into a repeatable suite that runs in
CI on every PR, so the owner's per-release manual run shrinks to what no
automation can do.

| Check | Assertion | Deterministic |
|---|---|---|
| 1.5 Large session | Fixture session with 150 turns. Open it with `aiCreditsAnalyzer.openSession`. Assert 151 rows in the turns table (header included), `first-render`/`data-ready` marks under the §3.5 budget (`evaluateBudgets`, from `aiCreditsAnalyzer.internal.perfMarks`), and selecting a turn updates the Explanation within a generous CI bound (500 ms, actual time logged). No horizontal overflow at the panel's width. | Yes, except the interaction time: logged, bound loose. |
| 1.6 Cancel / retry | A new test hook holds the host's reply to `getInsights` (or `getAuditRollup` for the tool audit). Open the dashboard, assert the skeleton (`data-testid="async-skeleton"`) shows Cancel, press it, assert "Loading cancelled" with Retry, release the hold, press Retry, assert the dashboard renders. | Yes, with the hold hook (task T4). Without it, the load is too fast to catch. |
| 1.7 Keyboard only | No mouse calls. Focus the Sessions view by command, Down/Enter opens a session, focus moves into the panel (`workbench.action.focusActiveEditorGroup`), Tab walks every focusable element and each shows a visible focus style (outline or box-shadow not `none`), Enter opens the column chooser, Escape closes it and focus returns to Columns, arrow keys move the system prompt diagram's selection, "View as table" toggles `aria-pressed`. | Yes. Focus crossing the workbench/webview iframe boundary is the risky part (§5). |
| 1.8 High contrast | Set `workbench.colorTheme` to `Default High Contrast`, then `Default High Contrast Light`. In the webview, assert the body class (`vscode-high-contrast`, `vscode-high-contrast-light`) and run the UI check's contrast judge (`scripts/ui-check/contrast.mts`, `judge.mts`) on the real rendered page: every text at WCAG AA on its painted ground, selection and focus outlines present. "Charts still distinguishable" is not asserted; a screenshot per theme is kept as a CI artifact. | Text, selection, focus: yes. Charts: no (screenshot only). |
| 1.9 Narrow panel | Close the side bar, set the window size so the webview's `innerWidth` is 640 then 360 px (± 8). Assert the layout class (`layoutFor`: 2x2 KPIs, view select, priority columns, details drawer) and `document.documentElement.scrollWidth <= clientWidth`. VS Code's minimum window width (unverified, about 400 px) may force 360 px through an editor split instead of the window size. | Yes. |
| 1.10 Theme and font | Switch to `Default Light Modern`, assert the body class and a themed colour (`--vscode-editor-background`) change in the webview. Set `editor.fontSize` to 20, assert `--vscode-editor-font-size` is `20px` in the webview. **Finding to confirm:** `theme-vscode.css` sizes text from `--vscode-font-size` (the workbench size), not `--vscode-editor-font-size`, so the panel may not follow `editor.fontSize`. The test pins whichever behaviour the owner chooses (§5, Q4). | Yes. |
| 1.11 System prompt read-only | Open the fixture session with a system prompt, System prompt tab → open in editor (the `openTextDocument` host command). Assert, through `executeWorkbench`, the active editor's URI scheme is `ai-credits-analyzer-doc` (`READ_ONLY_DOCUMENT_SCHEME`), a typed key leaves `isDirty` false and the text unchanged, and select-all + copy puts the prompt on the clipboard (`vscode.env.clipboard.readText()`). | Yes. Clipboard under xvfb needs an X selection owner; to confirm in the spike. |
| 1.13 Learn view | Through the side bar page objects: open the Learn view, click a scenario, assert the panel is in Learn mode with no scenario list in the panel and full width; click another, assert it changed; click a session in Sessions, assert Analyze mode. | Yes. |
| 2.1, 2.2, 2.6 MCP setting | Toggle `aiCreditsAnalyzer.mcp.enabled` in User settings. Assert VS Code's own server list (*MCP: List Servers* quick pick) shows no `ai-credits-analyzer` when off, shows it when on, and its tool list has the 9 tools; off again, it's gone. The integration suite already asserts the provider level (`internal.mcpServerDefinitions`, 9 tools over stdio); this adds the workbench UI. Whether VS Code core lists extension-provided servers without Copilot Chat installed is unverified (spike T0). | Yes, if the list works without Copilot Chat. |
| 2.5 Restricted Mode | A workspace folder whose `.vscode/settings.json` sets the setting `true`, user setting off, workspace trust **on** (wdio-vscode-service disables it by default). Assert no server while untrusted, trust the folder through the trust editor, assert the server appears. | Yes, if trust can be re-enabled (§2, F8). |
| 1.12 Uninstall | Not in the first cut. The service only runs the extension from `extensionPath` as a development extension, which can't be uninstalled. Feasible only by installing the VSIX into the extensions dir, running `code --uninstall-extension`, relaunching and asserting no AI Credits Analyzer UI and an unchanged `settings.json`. Optional task T14. | Yes, if done. |

**Stays manual:**
- 1.1-1.4: need a fresh profile with Copilot Chat signed in and real
  chats; 1.2/1.3 parts are covered by unit tests and the Setup view's
  model.
- 2.3, 2.4: Copilot agent mode answering questions needs a signed-in
  Copilot and a live model; not deterministic.
- §3 Remote-SSH/WSL/Dev Container (D6).
- README/listing review (10.10) and the §4 screenshots (the suite keeps
  failure screenshots, not listing-quality ones).
- 1.8's "charts still distinguishable" judgement.

**Non-goals:** replacing the integration suite or the UI check (both stay;
the new suite reuses their fixtures and judges); Windows/macOS runs;
testing Copilot Chat itself; a VS Code web (`vscode.dev`) run.

## 2. Feasibility facts

Verified against the repo (2026-11-03, `main` at `1e6fc43`) and the
`wdio-vscode-service@8.0.0` package contents:

- **F1 Webview reachability.** The service's `WebView` page object finds
  `iframe.webview.ready`, switches into it, then into `#active-frame`
  (two nested frames); `workbench.getAllWebviews()` and
  `getWebviewByTitle(title)` list them. `webview.close()` returns to the
  workbench. The panel's title is `AI Credits Analyzer` (`TITLE` in
  `panel/analyzer-panel.ts`), its view type `aiCreditsAnalyzer.panel`.
- **F2 Test mode and test hooks.** The service launches VS Code with
  `--extensionDevelopmentPath` and its own `--extensionTestsPath` (a proxy
  that serves `browser.executeWorkbench`). VS Code should then run the
  extension in `ExtensionMode.Test`, so the internal commands in
  `diagnostics/test-hooks.ts` (`perfMarks`, `rpcTrace`, `sessionsTree`,
  `mcpServerDefinitions`, `resetDiagnostics`) are reachable through
  `executeWorkbench((vscode) => vscode.commands.executeCommand(...))`.
  Unverified at runtime: the spike's first assertion.
- **F3 Fixture user data.** The service sets `--user-data-dir` to
  `<storagePath>/settings` and, at session start, **overwrites**
  `<storagePath>/settings/User/settings.json` with its defaults plus the
  `userSettings` capability. So: seed the Copilot stores into
  `<storagePath>/settings` before launch (in `wdio.conf.mts`), and pass
  the fixture's `USER_SETTINGS` (`scripts/integration-fixture.mts`) as
  `userSettings`, not as a file. Overriding `userDataDir` through
  `vscodeArgs` would also work (they're spread last) but loses the
  service's proxy-port setting, which breaks `executeWorkbench`.
- **F4 Fixture sources to reuse.** `createIntegrationFixture`
  (200 Copilot Chat sessions, one with a debug log),
  `seedUiCheckFixture` in `scripts/ui-check/webview-harness.mts` (adds a
  system prompt and the Agent Host stores via `writeCopilotCliAgentHostStores`),
  `COPILOT_CLI_FIXTURE_HOME`/`COPILOT_CLI_FIXTURE_SESSION_IDS`
  (`packages/server/src/test-support/copilot-cli-fixtures.ts`). Missing: a
  session with 100+ turns for 1.5 (task T1).
- **F5 Isolation from the developer's data.** The extension derives every
  Copilot Chat and Agent Host path from `context.globalStorageUri`
  (`platform/vscode-user-data-dir.ts`, `copilot-log-paths.ts`), so
  `--user-data-dir` isolates them. The Copilot CLI event log (10.14) is
  read from `COPILOT_HOME`, else `~/.copilot`
  (`create-vscode-provider.ts`): the config must set `COPILOT_HOME` to
  `COPILOT_CLI_FIXTURE_HOME` in the launcher's environment (inherited by
  chromedriver and VS Code; to confirm in the spike), and a guard test
  asserts the Sessions view shows exactly the fixture's session count.
- **F6 Copilot Chat absent.** The service passes `--disable-extensions`
  and a fresh extensions dir, so Copilot Chat is not installed. The config
  check then reports `copilot-chat-unavailable` (severity `required`,
  `config-check.ts`), and the status bar says setup is needed. The
  integration suite runs the same way and still lists the seeded
  sessions, so listing doesn't depend on it. Tests treat that warning as
  the expected baseline.
- **F7 Network and telemetry.** `USER_SETTINGS` already sets
  `telemetry.telemetryLevel: off`, `update.mode: none`,
  `extensions.autoCheckUpdates: false`; the service adds
  `--disable-updates`, `--skip-welcome`, `--skip-release-notes`. Network
  is still needed once per VS Code version: the service downloads VS Code
  from `update.code.visualstudio.com` and the matching chromedriver
  (Chrome for Testing), cached under `cachePath` (default
  `./.wdio-vscode-service`). The dev container can't download VS Code
  (10.9 notes), so the suite runs in CI and on the owner's machine only.
- **F8 Workspace trust.** The service passes `--disable-workspace-trust`
  and sets `security.workspace.trust.enabled: false`. `vscodeArgs`
  `{ disableWorkspaceTrust: false }` would produce
  `--disable-workspace-trust=false` (`getValueSuffix`); whether VS Code
  reads that as off is unverified. 2.5 needs its own capability with
  trust on.
- **F9 Stable vs Insiders.** `browserVersion` takes `stable`, `insiders`
  or an exact version. Page-object locators ship for versions up to
  `1.123.0` plus `insiders`; any stable 1.143+ falls back to the 1.123
  locators (`getLocators`). D9 says tests run on stable; the owner's
  machine has only Insiders (manual-checks run log). Pin an exact stable
  `x.y.0` in CI: open issue #157 reports chromedriver lookup 404s on
  patch releases (e.g. 1.122.1).
- **F10 Headless.** No headless Electron; `xvfb-run -a` as the
  integration suite already does in `ci.yml` and
  `release-extension.yml`. The service starts VS Code maximised
  (`window.newWindowDimensions: maximized`); xvfb's default screen is
  1280x1024x24 unless `-s "-screen 0 1600x1000x24"` is given.
- **F11 Timeouts and flakiness.** The integration suite waits up to 30 s
  for a webview under xvfb (`WAIT_MS`), and its first CI run took 3 s for
  7 tests after start-up. The service's VS Code proxy defaults are 5 min
  to connect and 60 s per command. Use `waitUntil` on DOM or test-hook
  state, never fixed sleeps; one retry per spec file (`specFileRetries: 1`)
  only after the owner's flake measurement (T15).
- **F12 Selectors.** The web app mostly exposes accessible names (the UI
  check uses `getByRole`), plus a few `data-testid`s
  (`async-skeleton`, `inspector-columns`, `advice-dialog-backdrop`).
  WebdriverIO's `aria/` selector covers roles and names; add a
  `data-testid` only where no accessible name exists.

**Tool status** (npm registry and GitHub, 2026-11-03):

| | wdio-vscode-service | Playwright `_electron` | vscode-extension-tester (ExTester) |
|---|---|---|---|
| Latest | 8.0.0 (2026-06-19); last commit 2026-06-19 | 1.64.1 already a devDependency | 8.28.1 (2026-10-05) |
| Driver | WebdriverIO, peer `webdriverio ^9` (9.33.0 current); wdio 10.0.0 (2026-10-05) not supported yet | Playwright, CDP | selenium-webdriver, mocha |
| Node | `>=18`; `@wdio/mocha-framework` 9.33 needs Node 22 `>=22.23.4` | Same as today | `>=22` |
| Workbench page objects | Yes (activity bar, side bar views, editors, settings, notifications, webviews), locators to 1.123 + insiders | None; VS Code's own smoke tests drive the workbench with Playwright (from memory, unverified here) | Yes, maintained for current stable |
| VS Code API from tests | `executeWorkbench` | None built in | None built in |
| Extension mode | Development extension in Test mode (test hooks usable) | Any: dev path, or a VSIX in the extensions dir | Installs a VSIX: production mode, no test hooks; makes 1.12 feasible |
| New devDependencies | wdio cli/runner/mocha/reporter, the service (fastify 4, `@vscode/test-electron` ^2.4, a second VS Code download cache) | None | selenium-webdriver, ExTester |
| Health signals | 54 open issues; open PRs unmerged since June-August: #165 (fastify and downloader security bumps), #171 (camelCase `extensionDevelopmentPath`, reported on Windows), #172 (`@vscode/test-electron` 3.1); #157 chromedriver 404 on patch releases | Microsoft-maintained; `_electron` marked experimental | Red Hat, monthly releases |

**Recommendation:** run the spike (T0) with `wdio-vscode-service@8.0.0`
pinned to `webdriverio@9.33.x`, because `executeWorkbench` plus Test mode
lets the suite read the existing test hooks and change settings without
UI scripting, and its page objects cover the side bar and editor tabs.
Its maintenance is thin (no merged commit since June, security bumps
pending, locators 20 minor versions behind stable), so the go/no-go is
strict: if the spike needs a patched service, fails on the pinned stable,
or adds a high/critical `npm audit` advisory the owner won't accept, switch
to **Playwright `_electron`** with the VS Code binary that
`@vscode/test-electron` already downloads (no new dependencies; settings
and test hooks reached through a small bridge extension or `settings.json`
writes). ExTester is the second fallback only if 1.12 becomes a
requirement.

## 3. Architecture

```
packages/vscode-extension/
  wdio.conf.mts                 # capabilities, services, fixture seeding, COPILOT_HOME
  test/ui/
    tsconfig.json               # types: node, @wdio/globals, @wdio/mocha-framework, wdio-vscode-service
    specs/
      panel.e2e.ts              # 1.5, 1.6, 1.11
      keyboard.e2e.ts           # 1.7
      layout-theme.e2e.ts       # 1.8, 1.9, 1.10
      views.e2e.ts              # 1.13, Sessions guard (F5)
      mcp.e2e.ts                # 2.1, 2.2, 2.6
      mcp-trust.e2e.ts          # 2.5 (own capability: trust on, a workspace folder)
    support/
      vscode-host.ts            # port: runCommand, setSetting, testHook, clipboard
      analyzer-panel.ts         # page object: webview enter/leave, turns table, tabs, column chooser, async view
      sidebar-views.ts          # page object: Sessions, Learn, Setup trees
      focus-probe.ts            # pure: is a computed style a visible focus indicator
      panel-width.ts            # pure: window size for a target webview width
      *.test.ts                 # vitest for the pure helpers
  scripts/ui-automation/
    ui-fixture.mts              # seeds <storagePath>/settings; returns ids and USER_SETTINGS
    ui-fixture.test.ts
```

- **Config.** One `wdio.conf.mts`: `runner: local`, `framework: mocha`
  (TDD UI, like the integration suite), `maxInstances: 1` (one xvfb
  display, deterministic), `services: [["vscode", { cachePath:
  ".wdio-vscode-service" }]]`, `capabilities: [{ browserName: "vscode",
  browserVersion: <pinned stable>, "wdio:vscodeOptions": { extensionPath,
  storagePath, userSettings: USER_SETTINGS, verboseLogging: false } }]`.
  `mcp-trust.e2e.ts` gets a second capability with a workspace folder and
  trust on, filtered by spec. Screenshots and VS Code logs on failure go
  to `test/ui/out/` (git-ignored, uploaded by CI).
- **Fixture provisioning.** `ui-fixture.mts` composes the existing seeders
  (`createIntegrationFixture`, the system prompt write from
  `seedUiCheckFixture`, `writeCopilotCliAgentHostStores`) and one new
  seeder for a 150-turn session. The config calls it in `onPrepare` with
  a fresh `mkdtemp` root (short path: socket length, as
  `.vscode-test.mjs` notes), sets `process.env.COPILOT_HOME`, and removes
  the root in `onComplete`. Specs read the fixture's ids from an
  environment variable, as the integration suite does
  (`integration-fixture-env.mts`).
- **Build and scripts.** The suite tests the built extension
  (`dist/`, `media/`), like the integration suite.
  `"test:ui:vscode": "wdio run wdio.conf.mts"`, run as
  `npm run build && xvfb-run -a -s "-screen 0 1600x1000x24" npm run test:ui:vscode`.
  Not part of `npm test`; vitest excludes `test/ui/specs/`.
  `.gitignore` adds `packages/vscode-extension/.wdio-vscode-service/` and
  `packages/vscode-extension/test/ui/out/`.
- **CI.** A new `extension-ui` job in `ci.yml`, parallel to `extension`,
  so the existing job's time is unchanged: `npm ci`, build, `actions/cache`
  on `.wdio-vscode-service` keyed by the pinned VS Code version, the
  suite under `xvfb-run`, `upload-artifact` of `test/ui/out/` on failure.
  Informational (`continue-on-error: true`) until T15's flake measurement,
  then required. `release-extension.yml` gets the same step after the
  integration suite once it is required. Actions pinned by SHA as today.
- **Runtime budget.** Each spec file is one VS Code launch (wdio
  default). Target: under 4 min for the job's test step with a warm cache,
  under 10 s per launch after the first; measured in T0.
- **SOLID/CUPID.** `vscode-host.ts` is the one port specs use to reach
  VS Code (commands, settings, test hooks, clipboard); the wdio
  `executeWorkbench` adapter implements it, so a Playwright fallback
  swaps the adapter, not the specs (dependency inversion, Liskov). Page
  objects are per surface (panel, side bar), each with a small interface
  of domain verbs (`openSession(id)`, `turnRows()`, `openColumnChooser()`),
  never raw selectors in specs (single responsibility, interface
  segregation). Pure parts (`focus-probe.ts`, `panel-width.ts`, the reused
  `contrast.mts`/`judge.mts`) are unit-tested and composable. Names follow
  the manual-check vocabulary (domain-based); specs cite the check number
  in each `test` title.

## 4. Tasks

Models: Haiku for mechanical edits, Sonnet for typical work, Opus for
tricky logic. No local model in this repo. Every task: failing test first
(architecture.md §11.4); where only a real VS Code run can test a file
(config, specs, CI YAML), record it as a TDD exception like step 10.9 did.

| # | Task | Cx | Model | Files | Failing test first | Depends | Exit |
|---|---|---|---|---|---|---|---|
| T0 | **Spike** (time-box 1 day): add the wdio devDependencies, a minimal `wdio.conf.mts` and one spec that seeds the integration fixture into `<storagePath>/settings`, runs `aiCreditsAnalyzer.openSession` for the usage session through `executeWorkbench`, enters the panel's webview and reads the "Fix the bug" session's turn row. Also measure: launch time, cache size, `npm audit` delta, Test-mode hooks reachable (F2), `COPILOT_HOME` inherited (F5), clipboard under xvfb (1.11), *MCP: List Servers* without Copilot Chat (2.x), `--disable-workspace-trust=false` (F8), Insiders run once. | high | Opus | `package.json`, `wdio.conf.mts`, `test/ui/specs/spike.e2e.ts`, `test/ui/tsconfig.json` | The spec, red before the config seeds the fixture (no session row) | — | **Go** if: 5/5 green runs under `xvfb-run` locally and in CI on a pinned stable; no patch to the service; launch-to-first-assert under 60 s; `npm audit` delta accepted by the owner. **No-go:** rewrite the spike with Playwright `_electron` + `@vscode/test-electron`'s binary and re-judge; findings written into §2 of this plan. |
| T1 | UI fixture: compose existing seeders, add a 150-turn session with a debug log (server test-support helper if none exists), return ids, turn counts, `USER_SETTINGS`, Copilot home | medium | Sonnet | `scripts/ui-automation/ui-fixture.mts`, `.test.ts`; maybe `packages/server/src/test-support/copilot-session-store.ts` | `ui-fixture.test.ts`: layout under `settings/`, 150 turns read back through `createExtensionApiService` | — (parallel with T0) | vitest green; spike spec passes with it |
| T2 | Productionise config and scripts: `test:ui:vscode`, `.gitignore`, vitest exclude, failure screenshots/logs, fixture env var | low | Haiku | `wdio.conf.mts`, `package.json`, `.gitignore`, `vitest.config.mts` | Spike spec red with fixture env var unset (clear message, like `parseIntegrationFixture`) | T0 go, T1 | `npm run test:ui:vscode` green locally under xvfb |
| T3 | `vscode-host.ts` port + wdio adapter; page objects `analyzer-panel.ts`, `sidebar-views.ts`; pure `focus-probe.ts`, `panel-width.ts` | medium | Sonnet | `test/ui/support/*` | vitest for `focus-probe` and `panel-width`; spike spec rewritten on the page objects, red until they exist | T0 go | vitest green; spike spec green on page objects |
| T4 | Test hook: hold/release host replies per method (`aiCreditsAnalyzer.internal.holdRequests`, `releaseRequests`), a `RequestGate` port injected into `MessageDispatcher`, Test mode only | medium | Sonnet | `src/diagnostics/test-hooks.ts`, `src/rpc/message-dispatcher.ts`, `src/extension.ts`, tests | `test-hooks.test.ts`, `message-dispatcher.test.ts`: a held method doesn't reply until released; manifest and bundle-load tests: not contributed, absent in production | — (parallel) | Unit tests green; integration suite still green |
| T5 | Specs 1.5 and 1.6 | medium | Sonnet | `test/ui/specs/panel.e2e.ts` | Spec red before T4's hook is called (Cancel never seen) | T1, T3, T4 | Green 3/3 under xvfb |
| T6 | Spec 1.7 keyboard only, across the workbench/webview focus boundary | high | Opus | `test/ui/specs/keyboard.e2e.ts` | Spec red against a stub page object whose focus check always fails | T3 | Green 3/3; any real focus bug filed in the manual-checks run log |
| T7 | Specs 1.8 and 1.10: themes, contrast judge in the real webview, `editor.fontSize` | medium | Sonnet | `test/ui/specs/layout-theme.e2e.ts`, a browser-side wrapper around `contrast.mts`/`judge.mts` | Spec red before the theme switch (body class still `vscode-dark`) | T3; Q4 for the font assertion | Green 3/3; screenshots per theme in `test/ui/out/` |
| T8 | Spec 1.9 at 640 and 360 px | medium | Sonnet | `test/ui/specs/layout-theme.e2e.ts` (separate `suite`) | `panel-width.test.ts` red first; spec red before resizing | T3 | Green 3/3 at both widths |
| T9 | Specs 1.11 and 1.13 | medium | Sonnet | `test/ui/specs/panel.e2e.ts` (1.11), `views.e2e.ts` (1.13, Sessions count guard) | Spec red before the system prompt fixture is seeded / before the Learn click | T1, T3 | Green 3/3 |
| T10 | Specs 2.1, 2.2, 2.6 through *MCP: List Servers* | medium | Sonnet | `test/ui/specs/mcp.e2e.ts` | Spec red with the setting on but not yet asserted off-state | T0 (MCP list finding), T3 | Green 3/3, or dropped with a note if T0 shows the list needs Copilot Chat |
| T11 | Spec 2.5 Restricted Mode with trust on | high | Opus | `test/ui/specs/mcp-trust.e2e.ts`, `wdio.conf.mts` (second capability) | Spec red while trust is disabled by the service defaults | T0 (F8 finding), T10 | Green 3/3, or documented as staying manual |
| T12 | CI: `extension-ui` job (cache, `xvfb-run`, artifacts, informational) | low | Haiku | `.github/workflows/ci.yml` | TDD exception (YAML, only a real run tests it) | T2 | Job green on the PR |
| T13 | Docs: mark automated rows in the manual-checks doc ("automated: `<spec>`; manual only when red"), 10.16 status and tests count in `vscode-extension.md`, `architecture.md` testing section, this plan's status | low | Haiku | `docs/plans/vscode-extension-manual-checks.md`, `docs/plans/vscode-extension.md`, `docs/architecture.md`, this file | n/a (docs) | T5-T12 | Docs match the merged suite; no CHANGELOG entry (no user-visible change) |
| T14 | Optional: 1.12 uninstall via VSIX install, `code --uninstall-extension`, relaunch | medium | Sonnet | `test/ui/specs/uninstall.e2e.ts` or a script | Spec red before the uninstall step | T0, owner's Q5 | Green, or stays manual |
| T15 | **Owner:** run the job 10 times on `main` (flake rate), run the same checks by hand once in VS Code and compare, decide required vs informational and whether the release workflow runs it | low | Owner | — | — | T12 | Flake rate recorded here; manual-checks doc updated; `continue-on-error` removed or kept by decision |

Parallel groups: {T0, T1, T4} first; after T0 go and T3: {T5, T6, T7, T8,
T9, T10} in separate files (T7 and T8 share a file: separate `suite`
blocks, or run them sequentially); then {T11, T12}; T13 last; T15 after
merge.

**Exit criterion (step 10.16):** the `extension-ui` job runs 1.5-1.11,
1.13, 2.1, 2.2 and 2.6 (plus 2.5 if T11 lands) green in CI on a pinned
stable VS Code, the manual-checks doc lists only the checks in §1 "Stays
manual", and the owner's comparison run (T15) found no check the suite
passes but a human fails.

## 5. Risks and open questions

**Risks:**
- **R1 Service maintenance.** No merged commit since 2026-06-19; security
  bumps (#165) and a `@vscode/test-electron` 3.1 bump (#172) wait;
  wdio 10 is out. Mitigation: pin exact versions, keep specs behind
  `vscode-host.ts` and page objects so a Playwright `_electron` adapter
  can replace it.
- **R2 Locator drift.** Stable 1.143+ uses the 1.123 locators. Mitigation:
  prefer commands and `executeWorkbench` over workbench clicks; the
  webview frame selectors haven't changed since 1.37.
- **R3 Two VS Code downloads in CI** (`.vscode-test/` and
  `.wdio-vscode-service/`, about 150 MB each, size unverified).
  Mitigation: cache both; or point `wdio:vscodeOptions.binary` at the
  `@vscode/test-electron` download (chromedriver matching then unverified).
- **R4 Flakiness** from focus across iframes (1.7), window sizing under
  xvfb (1.9) and timing (1.5). Mitigation: state-based waits, loose time
  bounds with logged actuals, informational job first.
- **R5 Test-only production code.** T4 adds a hook to the shipped bundle
  (registered only in Test mode, like the existing hooks).

**Open questions for the owner:**
1. **Q1 Dependency weight:** accept about five wdio devDependencies plus
   the service (and its transitive fastify 4) for this, or go straight to
   Playwright `_electron` with no new dependencies?
2. **Q2 CI time and gating:** a separate parallel job, informational for
   how long before it's required? Run it in `release-extension.yml` too?
3. **Q3 Stable vs Insiders:** pin stable in CI (D9) and run Insiders only
   locally (the owner's machine has no stable), or add a nightly
   Insiders job to catch the next VS Code early?
4. **Q4 `editor.fontSize`:** should the panel follow `editor.fontSize`
   (it uses the workbench `--vscode-font-size` today), or should check
   1.10 change to the workbench font?
5. **Q5 Uninstall (1.12):** keep manual, or worth a VSIX-based test
   (T14)?
6. **Q6 Hold hook (T4):** acceptable to add another Test-mode-only hook
   to the shipped bundle for 1.6?

## 6. What was built (2026-11-04, branch `worktree-agent-a096a711cedd6f415`)

Built with the recommended path: `wdio-vscode-service@8.0.0`, run against
pinned stable VS Code 1.145.0 under `xvfb-run -a -s "-screen 0 1600x1000x24"`.
The spike (T0) went **go**: no patch to the service was needed, and the
whole suite (6 spec files, one VS Code start per file) takes about 35 s
with a warm download cache. The `npm audit` delta is the
open item for the owner (Q1): 19 advisories before (2 high), 50 after (19
high; fastify, `@fastify/static`, `find-my-way`, `serialize-javascript`,
`basic-ftp`, `extract-zip` via the service and wdio), all in dev
dependencies that never ship.

### 6.1 Automated, and what stays manual

| Check | Spec | Notes |
|---|---|---|
| 1.5 | `panel.e2e.ts` | 150-turn session: 151 rows with the header, `first-render` about 100 ms and `data-ready` about 130 ms against the 1 s budget, selecting a turn about 10 ms against a 500 ms bound, no sideways overflow |
| 1.6 | `panel.e2e.ts` | The new `holdRequests`/`releaseRequests` hooks hold `getInsights`; Cancel, "Loading cancelled", Retry, dashboard |
| 1.7 | `keyboard.e2e.ts` | Down/Enter in the Sessions tree, Tab walk with a visible focus indicator on every stop, column chooser Enter/Escape and focus return, Pretty/Raw/Icicle radios by arrow keys, arrow keys inside the diagram, View as table `aria-pressed` |
| 1.8 | `layout-theme.e2e.ts` | Both High Contrast themes: the UI check's probe and judge on the real page (zero findings), focus outline, selected row. Screenshots in `test/ui/out/`. **Manual:** "charts still distinguishable" |
| 1.9 | `layout-theme.e2e.ts` | 640 px gives `medium`, 360 px gives `narrow` (view `<select>`, no radio group); no sideways scroll once the setup banner is dismissed |
| 1.10 | `layout-theme.e2e.ts` | Light theme changes the body class and `--vscode-editor-background`; `editor.fontSize` reaches the webview as a variable that nothing uses (Q4, pinned as today's behaviour) |
| 1.11 | `panel.e2e.ts` | `ai-credits-analyzer-doc` scheme, a typed key leaves it clean, copy puts the prompt on the clipboard (the clipboard works under xvfb) |
| 1.13 | `views.e2e.ts` | Learn scenario, another, then a session; plus the Sessions count guard (F5) |
| 2.1, 2.2, 2.6 | `mcp.e2e.ts` | VS Code's own *MCP: List Servers* (`workbench.mcp.listServer`) lists the server without Copilot Chat installed. The 9 tools stay the integration suite's |
| 2.5 | `mcp-trust.e2e.ts` | Own capability: Workspace Trust on, a folder whose settings enable the server; untrusted gives no server, the Trust button in the Workspace Trust editor gives one |

**Still manual:** 1.1-1.4, 1.12 (T14 not built, Q5), 2.3, 2.4, §3, §4, the
README review, 1.8's chart judgement, and 2.1's *Configure Tools* wording
in Copilot Chat. 2.2's "9 tools" is asserted by the integration suite, not
here.

### 6.2 Deviations from the plan, and facts it got wrong or left open

- **Versions.** `webdriverio@9.33.0` and `@wdio/cli@9.33.0` don't exist;
  everything wdio is pinned to 9.33.1 (exact, in `package.json`).
- **F2, F5, F8 verified.** The Test-mode hooks are reachable through
  `executeWorkbench`; `COPILOT_HOME` set in the config reaches VS Code (the
  Sessions guard checks it); `vscodeArgs: { disableWorkspaceTrust: false }`
  plus `security.workspace.trust.enabled: true` in `userSettings` does turn
  Workspace Trust on. The service's default `startupPrompt` is replaced by
  `never`.
- **2.x without Copilot Chat works** (the T0 question): core VS Code lists
  extension-provided MCP servers.
- **Webview frames (new, R4).** Under xvfb the workbench produces frames
  only when asked (about 2 s after), so `ResizeObserver` never ran after a
  resize and the responsive layout never switched. `PanelView.requestFrame()`
  takes a screenshot, which forces one; the config also passes
  `--disable-renderer-backgrounding` and the occlusion flags. Any spec that
  waits for resize-driven UI must poll with it.
- **Resizing (1.9).** The driver can't resize Electron's window
  (`Browser.getWindowForTarget` is missing) and VS Code's minimum is about
  400 px, so the panel's width is set through `vscode.setEditorLayout`, with
  a pure `nextGroupFraction` nudging the group's share until the webview
  measures the target (`panel-width.ts`). The plan's `windowWidthFor` and
  window sizing were dropped.
- **Focus (1.7, 1.8).** `document.hasFocus()` stays false without a window
  manager although keys reach the page, so `focusIntoPanel` runs
  `workbench.action.focusActiveEditorGroup` until a Tab moves focus off the
  body.
- **Start-up Welcome tab.** On a fresh user-data dir VS Code opens a
  Welcome tab (the Get Started walkthrough) a moment after start-up, later
  on a slow machine. It took the editor group and the keyboard focus from the
  keyboard specs. Seeding the extension's `walkthroughOffered` flag into
  `state.vscdb` did **not** stop it (tried, removed), so
  `VscodeHost.waitForExtension()` waits for the tab, once per launch, when an
  earlier launch on the same user-data dir hasn't recorded the offer
  (`walkthrough-state.ts`, unit-tested), then closes all editors. Doing this on
  every call (a spec's `setup` runs it per test) closed the panel a test had
  just opened and failed `1.11` every time; the once-per-launch guard fixed it.
- **Fixture.** The seeded Copilot workspace storage names the fixture's own
  folder in a `workspace.json` (a unit-tested guess at VS Code's storage
  cleaner; the cleaner was never observed deleting it, so the file is
  precautionary).
- **Flake record (this machine, Linux, 24 cores).** Before the two fixes
  above, the first run after a pause of a minute or two failed 1-3 specs in
  about half the batches (slow starts: 2-3 min instead of 35 s); warm runs
  passed. After them: 6 of 6 plain runs and 1 of 1 run beside 24 busy loops
  passed (35 s and 62 s). The owner's 10-run measurement (T15) still decides
  gating, and a cold CI runner is the case not measured here.
- **No `actions/cache` for the second download.** Only the wdio download is
  cached (`.wdio-vscode-service`, keyed on `wdio.conf.mts`); the
  integration suite's `.vscode-test/` is unchanged.
- **T14 (1.12) not built;** `test/ui/specs/mcp-trust.e2e.ts` is the only spec
  with its own VS Code launch.
- **Failure artefacts:** an `afterTest` hook saves a screenshot per failing
  test into `test/ui/out/`, which the CI job uploads.

### 6.3 Findings for the owner

- **1.9 bug (skipped test).** With Copilot Chat missing the config warning
  banner is wider than a 360 px panel (elements reach 404-511 px), so the
  page scrolls sideways. The suite dismisses the banner for the 1.9 checks
  and keeps `1.9 the config warning banner fits a 360 px panel` as
  `test.skip`: unskip it with the fix.
- **1.10 / Q4.** Confirmed: the panel ignores `editor.fontSize`; the spec
  pins that.
- **CI is informational** (`continue-on-error: true`) until T15.

### 6.4 Task status

| Task | Status |
|---|---|
| T0 | Done, **go**; audit delta awaits Q1 |
| T1 | Done (`scripts/ui-automation/ui-fixture.mts`, 8 tests) |
| T2 | Done |
| T3 | Done (`vscode-host.ts`, `analyzer-panel.ts`, `sidebar-views.ts`, `keyboard.ts`, `mcp-server-list.ts`; `focus-probe.ts` and `panel-width.ts` unit-tested) |
| T4 | Done (`request-gate.ts`, dispatcher option, two hooks; unit, manifest and bundle-load tests) |
| T5-T11 | Done, see 6.1 |
| T12 | Done, informational |
| T13 | Done |
| T14 | Not built (Q5) |
| T15 | Owner |
