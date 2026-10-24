# VS Code extension: implementation and deployment plan

Status: **planned (Phase 10), not started.** This plan expands
[implementation-plan.md](../implementation-plan.md) Phase 10 and
[architecture.md](../architecture.md) §12 into concrete, test-first steps.
Nothing here is implemented yet.

## 1. Context

The app ships today as two local processes: an Express API on
`127.0.0.1:3001` (`packages/server`) and a Vite + React SPA
(`packages/web`). Vision §5 lists one future path: repackage the app as a
VS Code extension with a webview. Phase 10 is the only phase in the plan
that hasn't started.

### 1.1 Two products, one codebase

Decided on 2026-10-24: the repo will ship **two separate products** that
share most of their code (vision §5).

| | **Extension** | **Standalone app** |
|---|---|---|
| Working name (§9 Q1) | "AI Credits Analyzer" (no "Copilot" in the name, §3.4) | "Agent Cost Analyzer" |
| Audience | VS Code + GitHub Copilot Chat users (Marketplace, Open VSX) | Developers using several coding agents |
| Log providers | **VS Code / Copilot Chat only** | VS Code, Claude Code, pi, mitmproxy (all of today's providers) |
| Learn mode | yes | yes |
| Analyze mode, turn inspector, system prompt | yes | yes |
| Tool audit, insights dashboard | **yes** (over the Copilot provider only) | yes (across every provider) |
| MCP server | **yes**, Copilot data only, registered with VS Code | yes, stdio (`npm run mcp`), every provider |
| Extension-only UX | one-click setting fixes, VS Code merged settings, VS Code-supplied paths | — |
| Delivery | `.vsix` from the Marketplace / Open VSX | `npm start` from the repo |
| Version | independent (`ext-v*` tags) | independent (`app-v*` tags) |

The standalone app stays a strict superset: it keeps VS Code support.

### 1.2 Goals

1. Install the extension from the VS Code Marketplace (and Open VSX) as
   one `.vsix`. No `npm install`, no second terminal, no browser tab.
2. Reuse `packages/web`'s components and charts and `packages/server`'s
   data sources and services unchanged, or with only refactors that also
   help the standalone app.
3. The extension contains **no** Claude Code, pi or mitmproxy code. A test
   enforces this; it isn't left as a convention (§3.1).
4. Keep the standalone web app and its stdio MCP server working exactly as
   today.
5. Use what only an extension can do. Settings warnings become one-click
   fixes, settings are read through VS Code's own merged configuration, and
   the VS Code user-data directory comes from VS Code itself on every
   platform.

Non-goals for this plan: a multi-user or cloud-hosted variant (vision §6),
a Copilot Chat participant, and telemetry. Constraint 1 forbids outbound
network calls, so neither product sends telemetry.

## 2. Analysis of the existing code

### 2.1 What already fits

| Area | Finding | Consequence |
|---|---|---|
| Provider registry | `composeLogProviders()` (`packages/server/src/composition/compose-log-providers.ts`) is the only place that chooses which providers exist. It has no Express dependency, and every path can be overridden through `LogProviderCompositionOptions`. The registry is open/closed (constraint 12). | The product split is a **second composition root**, not a fork (§3.1). |
| Query services | `AuditQueryService`, `AnalysisQueryService` and `createInsightsService` take a registry and are already shared by HTTP and MCP. | Both products reuse them; insights and audit simply see one provider in the extension. |
| MCP server | `createMcpServer` (`packages/server/src/mcp/mcp-server.ts`) takes its services as arguments; only `mcp/stdio.ts` composes them. | The extension gets its own Copilot-only MCP entry point with no change to the tools. |
| Web data access | All but one call goes through `packages/web/src/api-client/*`, which uses three helpers in `http.ts` (`getJson`, `getText`, `putJson`). | That one module is the transport seam (architecture §12). |
| Domain | Every response shape has a zod schema in `packages/domain`. | The host can validate messages at the boundary for free. |
| Config warnings | `ConfigWarning` already carries `settingId`. | A "Fix" button can open exactly that setting. |
| SQLite | Reads use the built-in `node:sqlite` (`DatabaseSync`), read-only, with no native npm module. | No `node-gyp` or per-platform prebuilt binaries to ship, if the extension host's Node supports it (risk R1). |

### 2.2 Gaps to close

| # | Gap | Location | Fix (step in §6) |
|---|---|---|---|
| G1 | Route logic lives inline in `app.ts`. The `/api/sessions/:id/system-prompt` route (~70 lines of VS Code/pi branching) and the turn-index validation can't be reused without Express. The pi branch also hard-wires a pi dependency into shared logic. | `packages/server/src/app.ts` | Extract an `ApiService`, with system-prompt reading behind an optional per-provider `SystemPromptTextReader` (10.1) |
| G2 | `App.tsx` calls `fetch("/api/health")` directly, bypassing `api-client`. | `packages/web/src/App.tsx:93` | Move into `api-client/health.ts` (10.2) |
| G3 | `api-client` is bound to `fetch` and relative `/api/...` URLs. | `packages/web/src/api-client/http.ts` | `ApiTransport` port with HTTP and webview adapters (10.2) |
| G4 | `import.meta.url` locates the learn-scenario fixtures and `package.json`. This breaks once the code is bundled into one CJS file. | `learn-scenarios/loader.ts:13`, `app.ts:29`, `mcp/stdio.ts:12` | Inject the fixtures dir and version (10.1) |
| G5 | `resolveUserDataDir` is Linux-only, so on macOS and Windows the VS Code provider is always unavailable. | `platform/vscode-paths/resolve-user-data-dir.ts` | In the extension, derive it from `context.globalStorageUri` (10.4). Separately, add macOS/Windows candidates for the standalone app. |
| G6 | The config check reads only the user `settings.json` (workspace merge not implemented, Phase 5 note). | `services/config-check` | `SettingsSource` port with a `vscode.workspace.getConfiguration` adapter (10.4) |
| G7 | The Vite build emits `/assets/...` absolute URLs and no manifest. Webviews need `asWebviewUri` URLs and a strict CSP. | `packages/web/vite.config.ts`, `index.html` | Extension build mode with `base: './'` and `build.manifest` (10.3) |
| G8 | `navigator.clipboard` (advice export) isn't reliable in every webview host. | `AdviceExportDialog.tsx:30` | `HostCapabilities` port: clipboard, open setting, open text document (10.5) |
| G9 | ESM-only workspace (`"type": "module"`), with `domain` exporting TypeScript source. | all `package.json` | esbuild bundle to CJS `dist/extension.js` and `dist/mcp-stdio.js` (10.3, 10.6) |
| G10 | The UI assumes a multi-provider product: the header provider select, "across every provider" wording on the dashboard, and the provider column. It also says nothing about which product it is. | `AppHeader.tsx`, `components/insights/*` | `ProductProfile` sent by the host; the UI renders from it, never from `isExtension` checks (10.5) |
| G11 | `composeLogProviders` imports all four providers statically, so any bundle that imports it includes them. | `composition/compose-log-providers.ts` | Split per-provider factories, plus a `composeCopilotProviders` root (10.3) |

## 3. Target architecture

```mermaid
flowchart LR
  subgraph Shared["Shared code (both products)"]
    DOM[packages/domain]
    UI[packages/web<br/>components, charts, api-client]
    API[ApiService]
    SVC[Audit / Analysis / Insights /<br/>config-check services]
    VSP[VscodeLogProvider]
    MCP[createMcpServer]
  end
  subgraph Ext["Extension (packages/vscode-extension)"]
    CR1[composeCopilotProviders] --> VSP
    D[MessageDispatcher] --> API
    CAP[VscodeHostCapabilities]
    MCP1[mcp-stdio entry, Copilot only] --> MCP
  end
  subgraph App["Standalone (packages/server)"]
    CR2[composeLogProviders] --> VSP
    CR2 --> OTH[ClaudeCode / Pi / Mitmproxy providers]
    HTTP[Express app.ts] --> API
    MCP2[mcp/stdio.ts] --> MCP
  end
  UI -->|postMessage RPC| D
  UI -->|HTTP /api| HTTP
```

### 3.1 Product boundary

- **Option A (adopted): one repo, two composition roots.** The extension
  imports only `composeCopilotProviders()`, which registers just
  `VscodeLogProvider`. The standalone app keeps `composeLogProviders()`,
  which builds on the same per-provider factories. No packages move.
- **Boundary test (TDD, step 10.3).** `bundle-boundary.test.ts` reads
  esbuild's metafile for `dist/extension.js` and `dist/mcp-stdio.js` and
  fails if any input path matches `data-sources/(claude-code|pi-agent|
  log-providers/mitmproxy)/` or `platform/(claude-code|pi-agent)-paths/`.
  This turns "Copilot-only" into a test that can fail.
- **Option B (deferred): package split.** Split into `core`,
  `provider-vscode`, `provider-claude-code`, `provider-pi`,
  `provider-mitmproxy` plus the two app packages. Do this only if the
  products need separate contributors or the boundary test keeps
  catching leaks. It's a mechanical move once Option A's factories exist.

### 3.2 Decisions

- **D1: In-process message bridge, no embedded HTTP server.** Running
  Express inside the extension host would open a loopback port that any
  local process could reach, and would need webview port mapping and
  Host-guard changes. A typed `postMessage` RPC opens no port at all and is
  the design architecture §12 already describes.
- **D2: One transport-neutral `ApiService` in `packages/server`.** Express
  routes and the extension dispatcher both become thin adapters over it, so
  there's a single implementation (SRP, DIP). Its methods mirror the
  existing REST surface: `listSessions`, `getSession`, `getTurnDetail`,
  `getSystemPromptText`, `getConfigStatus`, `setRetentionThreshold`,
  `listLearnScenarios`, `getLearnScenario`, `getLogProviderStatus`,
  `setActiveLogProvider`, `getSessionAudit`, `listToolCalls`,
  `getAuditRollup`, `getInsights` and `getHealth`. It adds one new method,
  `getProductProfile`. `ApiService` doesn't know which product it runs in;
  it only sees the registry it was given.
- **D3: A new workspace, `packages/vscode-extension`.** It holds only
  VS Code glue: activation, panel, dispatcher, VS Code adapters, the
  Copilot composition root, the MCP definition provider and packaging. It's
  the only package that imports `vscode`.
- **D4: Paths come from VS Code.**
  `context.globalStorageUri` = `<userData>/User/globalStorage/<extension-id>`,
  so the user-data dir is three levels up. That works on every platform and
  for Stable, Insiders, portable and remote servers, and it removes G5 for
  the extension.
- **D5: App-owned settings.** The extension stores its own settings
  (retention threshold) in `context.globalState` behind an
  `AppSettingsStore` port. The standalone app keeps its file in
  `resolveAppSettingsDir()`. The two products are independent, so one
  can't change the other's active provider. Constraint §11.2 holds: neither
  product writes to VS Code's own files.
- **D6: `extensionKind: ["workspace"]`.** Copilot Chat writes its logs
  where its own extension host runs. On Remote-SSH, WSL and Dev Containers
  that's the remote side, so this extension must run there too to see the
  same files. Validate in step 10.7.
- **D7: Copilot-only MCP in the extension.** The extension registers an MCP
  server definition with VS Code whose process composes only the Copilot
  provider (step 10.6). The tool list and schemas are identical to the
  standalone server's; only the data behind them differs.
- **D8: Independent versions and names.** Each product has its own
  version, changelog, tag prefix and listing. The shared packages stay
  private and unversioned.

### 3.3 `ProductProfile`

A new schema in `packages/domain`, returned by `getProductProfile` (and by
`GET /api/product` in the standalone app):

```ts
type ProductProfile = {
  productId: "vscode-extension" | "standalone";
  displayName: string;
  version: string;
  features: {
    providerSelect: boolean;          // false when exactly one provider
    crossProviderInsights: boolean;   // drives dashboard wording and provider facet
    settingFixes: boolean;            // "Fix" buttons on config warnings
    openInEditor: boolean;            // system prompt -> editor document
  };
};
```

The web app reads this once at startup. Components take the flags they
need as props (ISP), so no component knows which product it's in.

### 3.4 Naming and Marketplace metadata

The extension's name doesn't include "GitHub Copilot". On the VS Code
Marketplace the audience is already VS Code users, and Copilot support is
stated where people search and read instead. This also avoids putting
another company's trademark in the product name.

- `displayName`: the product name only (working name "AI Credits
  Analyzer", §9 Q1). The `name` (the Marketplace id) is its kebab-case
  form, e.g. `ai-credits-analyzer`.
- `description`: names the use case, e.g. "See where your GitHub Copilot
  Chat tokens and AI Credits go: prompt caching, per-turn cost, tool-call
  failures and insights, from your local logs."
- `keywords` (Marketplace allows at most 30): `copilot`, `github copilot`,
  `copilot chat`, `ai credits`, `tokens`, `token usage`, `cost`,
  `prompt caching`, `llm`, `agent`, `mcp`.
- `categories`: `Visualization`, `AI`, `Chat`, `Other` (only values VS Code
  accepts for this field).
- Command, setting and view ids use the product prefix
  (`aiCreditsAnalyzer.*`), never `copilot*`. Renaming them is free until
  the first publish, so they follow the final name from §9 Q1.
- The README and listing refer to GitHub Copilot only to describe what
  the extension works with.

## 4. Message protocol

In `packages/domain/src/rpc.ts`, so both sides share it:

```ts
// webview -> host
type RpcRequest = { kind: "request"; id: string; method: ApiMethod; params: unknown };
// host -> webview
type RpcResponse =
  | { kind: "response"; id: string; ok: true; result: unknown }
  | { kind: "response"; id: string; ok: false; error: { status: 400 | 404 | 500; message: string } };
// host -> webview, unsolicited (e.g. settings changed -> refetch config status)
type HostEvent = { kind: "event"; name: "configChanged" | "themeChanged"; payload?: unknown };
```

- The host validates `method` against an allow-list and validates
  `params` with a per-method zod schema before dispatching. Anything else
  is rejected with `400` (§11.2 defence in depth: the webview is
  untrusted content).
- `setActiveLogProvider` with any id other than `vscode` returns `400` in
  the extension, from the registry itself (no special case).
- Error `status` values match the HTTP API's, so the web code handles
  "unknown session" (404) the same way on both transports.
- The webview transport correlates responses by `id`, rejects after a
  timeout (default 60 s, since insights over large histories can be slow),
  and rejects with the same `Error` message format as `http.ts`.
- Payloads are structured-cloned. Big sessions are already fetched per
  turn (`getTurnDetail`), which matches architecture §11.1.

## 5. Webview security

- CSP: `default-src 'none'; script-src 'nonce-…'; style-src ${cspSource}
  'unsafe-inline'; img-src ${cspSource} data:; font-src ${cspSource};
  connect-src 'none'`. `connect-src 'none'` makes "no network from the UI"
  enforceable rather than a convention.
- `localResourceRoots` is restricted to the extension's `media/` folder.
  The webview never gets file URIs for user logs, and all log reads stay
  on the host.
- Existing redaction (`redactSecrets`) and `isValidSessionId` path
  validation are reused unchanged, because the same services run. The
  extension never contains the mitmproxy code, so HAR captures with
  credential headers can't reach it at all.
- No `retainContextWhenHidden` by default (memory). State is restored via
  `vscode.setState`/`getState` for the selected mode, session and turn.

## 6. Implementation steps (TDD, each with an exit criterion)

Each step follows architecture §11.4/§11.5: write the failing test first,
make it pass, refactor. Commit when the step's exit criterion is met.
Steps 10.1 and 10.2 are pure refactors of existing packages. The whole
existing suite must stay green and the standalone app must behave
identically.

### 10.0 Spike: runtime check (time-boxed, about half a day)

- In a throwaway extension on the minimum supported VS Code version
  (proposal: the release from 3 months before the start date), confirm
  that `require('node:sqlite')` works in the extension host, read-only,
  without flags (R1). Also confirm that an esbuild CJS bundle of
  `VscodeLogProvider` loads, and that `vscode.lm.registerMcpServerDefinitionProvider`
  is available on that version (D7).
- Record the result in architecture §12.
- **Exit:** a short decision note. Either `node:sqlite` is usable, or we
  fall back to a `SqliteReader` port with a WASM adapter (`sql.js`, latest
  stable, §11.6), chosen before step 10.4.

### 10.1 Transport-neutral `ApiService` (server)

- Tests first: `services/api/api-service.test.ts` covers every method from
  D2 with fakes for the registry and services (`test-support/*`). It
  covers success, unknown id → `NotFound`, bad input → `BadRequest`
  (turn index, retention threshold, provider id), and provider failure →
  `Internal`.
- Move the logic out of `app.ts` into `ApiService` (G1). System-prompt
  text becomes an optional `SystemPromptTextReader` capability per
  provider. `VscodeLogProvider` gets the existing `main.jsonl` logic, and
  `PiAgentLogProvider` already has `readSystemPromptText`. The
  `=== "pi-agent"` branch goes away, and `ApiService` no longer imports
  any provider (OCP). `app.ts` becomes a thin adapter that maps typed
  errors to status codes. Existing `app*.test.ts` stay unchanged and
  green; they're the regression net.
- `AppSettingsStore` port (D5): the existing file-backed implementation is
  the standalone default.
- G4: `loadLearnScenarios({ fixturesDir })` and an injected `appVersion`.
  The defaults keep the current `import.meta.url` behaviour for the
  standalone app.
- `ProductProfile` schema in `domain` (tests first), plus
  `getProductProfile` and `GET /api/product` for the standalone app.
- **Exit:** `npm test`, `npm run typecheck` and `npm run lint` are green,
  `app.ts` holds no business logic, and existing HTTP API responses are
  byte-identical.

### 10.2 `ApiTransport` seam (web)

- Tests first: `api-client/transport.test.ts` defines an
  `ApiTransport { call(method, params): Promise<unknown> }` contract that
  both adapters must pass. Write `HttpTransport` (maps methods to today's
  URLs, keeps the error messages) and `WebviewTransport` (with a fake
  `acquireVsCodeApi` and `window` message events; covers correlation,
  timeout, error propagation and out-of-order replies).
- Rewrite `api-client/*` functions to take the transport via a small
  provider (`setApiTransport` or a React context). Components and charts
  don't change (architecture §12). Move the health check into
  `api-client/health.ts` (G2).
- Select the transport at startup: `WebviewTransport` when
  `acquireVsCodeApi` exists, `HttpTransport` otherwise.
- **Exit:** the web suite is green and `rg 'fetch\(' packages/web/src`
  finds matches only in `api-client/http-transport.ts`.

### 10.3 Extension skeleton, Copilot composition root, build

- **Composition (G11), tests first.** Split `composeLogProviders` into
  per-provider factories (`createVscodeProvider(paths)`, and the same for
  each other provider). Add `composeCopilotProviders(options)` in
  `packages/server/src/composition/compose-copilot-providers.ts`, which
  registers `VscodeLogProvider` only. `composeLogProviders` keeps its
  signature and behaviour, built on the same factories. Tests: the Copilot
  registry lists exactly `["vscode"]`, and the standalone registry is
  unchanged.
- New workspace, `packages/vscode-extension`:
  - `package.json` with `name` and `displayName` from §9 Q1, `publisher`
    (§9 Q2), its own `version` (D8), `engines.vscode` from 10.0,
    `main: ./dist/extension.js`, `extensionKind: ["workspace"]`, and
    contributed command `aiCreditsAnalyzer.open`. Commands activate
    implicitly, with no `*` activation. It also adds a status-bar entry
    point and an `icon`.
  - `src/extension.ts` with `activate`/`deactivate`, wired through a
    composition root (`src/composition.ts`) as the only place that
    constructs concrete classes. It uses `composeCopilotProviders`, never
    `composeLogProviders`.
  - `src/panel/analyzer-panel.ts`: singleton `WebviewPanel`, CSP/nonce HTML
    built from the Vite manifest, `asWebviewUri` for assets.
- Build: `esbuild src/extension.ts --bundle --platform=node --format=cjs
  --external:vscode --metafile=dist/meta.json --outfile=dist/extension.js`.
  The web build gets an `extension` mode (`base: './'`,
  `build.manifest: true`, `outDir: ../vscode-extension/media`).
  Learn-scenario fixtures are copied to `media/learn-scenarios/` (they're
  data, not code).
- Tests first:
  - `panel-html.test.ts` (pure function: manifest + nonce + `cspSource` →
    HTML that contains the CSP, no absolute `/assets` URLs, nonce on every
    script).
  - `bundle-boundary.test.ts` (§3.1). It fails first against a bundle
    built from `composeLogProviders`, then passes with
    `composeCopilotProviders`.
- **Exit:** `npm run build` produces `dist/extension.js` and `media/`, the
  boundary test passes, and running the extension (F5) opens a panel
  showing Learn mode.

### 10.4 Host dispatcher and VS Code adapters

- `src/rpc/message-dispatcher.ts`: tests first. Unknown method → 400,
  invalid params → 400, `ApiService` typed errors → their status, and
  thrown errors → 500 without stack traces. It depends only on `ApiService`
  plus `HostCapabilities` interfaces (DIP), so it's testable without
  `vscode`.
- `src/platform/vscode-user-data-dir.ts`: pure function from a
  `globalStorageUri` path to the user-data dir, tested for Linux, macOS,
  Windows, Insiders and remote-server layouts (D4). Its result feeds
  `composeCopilotProviders({ sessionStoreDbPath, debugLogsDirPaths,
  agentTracesDbPath, vscodeSettingsPath })`.
- `SettingsSource` port in `services/config-check` (G6):
  `checkConfig({ settings })` reads `get(settingId)`. Adapters are the
  existing JSONC `settings.json` file reader (standalone, default) and
  `VscodeSettingsSource` using `vscode.workspace.getConfiguration()`. Tests
  first, and both adapters pass a shared contract test.
- `GlobalStateAppSettingsStore` (D5), passing the same `AppSettingsStore`
  contract test as the file-backed store.
- Re-run the config check on `workspace.onDidChangeConfiguration` for the
  two `agentDebugLog` settings and push a `configChanged` event.
- **Exit:** in a dev host, Analyze mode lists real VS Code sessions on
  Linux and on macOS or Windows (G5 resolved for the extension). The
  `ConfigStatus` matches the effective setting, including a
  workspace-level override. The tool audit and insights dashboard render
  for those sessions.

### 10.5 Product profile in the UI and extension-only UX

- **`ProductProfile` (G10), tests first:**
  - `AppHeader` hides the provider select when
    `features.providerSelect` is false.
  - The insights dashboard drops the provider list box and changes its
    "across every provider" wording when `crossProviderInsights` is false.
  - The header and the advice-export bundle show `displayName`.
  - Snapshot-free component tests cover both profiles.
- **`HostCapabilities`** (web port; the standalone implementation keeps
  today's behaviour):
  - `openSetting(settingId)` → `workbench.action.openSettings` with the
    id. This is the "Fix" button on `ConfigWarningBanner`, shown only when
    `features.settingFixes` is true.
  - `copyToClipboard(text)` → `vscode.env.clipboard.writeText` (G8).
  - `openTextDocument(text, language)`: "Open system prompt in editor"
    from `SystemPromptInspector` as an untitled read-only document.
- Theme: map `theme.css` tokens to `--vscode-*` variables when
  `body.vscode-light`, `body.vscode-dark` or `body.vscode-high-contrast`
  is present. Keep the Industry palette as the fallback, and keep the
  standalone look unchanged.
- Tests first: component tests for the Fix button (rendered only with
  the flag; calls `openSetting` with the warning's `settingId`) and the
  capability-absent fallbacks.
- **Exit:** clicking Fix on a `logging-disabled` warning opens the
  settings UI on `github.copilot.chat.agentDebugLog.fileLogging.enabled`.
  The extension shows no provider select, and the standalone app looks
  unchanged.

### 10.6 Copilot-only MCP server in the extension (D7)

- Tests first: `createCopilotMcpServices()` builds the same services as
  `mcp/stdio.ts` over `composeCopilotProviders`. Test that `tools/list`
  returns the same 9 tools and output schemas as the standalone server,
  and that `get_cost_rollup` only ever reports the `vscode` provider.
- Bundle `src/mcp/stdio.ts` as `dist/mcp-stdio.js` (covered by the
  boundary test). Paths reach the child process as CLI args or env
  computed from D4 in the host, since the child has no `vscode` API.
- Register it with `vscode.lm.registerMcpServerDefinitionProvider`
  (contribution `mcpServerDefinitionProviders`). The command is
  `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, so users don't need a
  separate Node install.
- Gate it behind a setting, `aiCreditsAnalyzer.mcp.enabled` (default
  `false`, with a description that explains what data it exposes),
  because it returns redacted session data to whichever model the chat
  uses (architecture §11.2).
- **Exit:** with the setting on, Copilot Chat agent mode lists the 9
  read-only tools, and `get_session_cost` answers for a real Copilot
  session. With it off, no server is registered.

### 10.7 Integration tests, remote check, packaging

- `@vscode/test-cli` + `@vscode/test-electron` integration suite. It
  activates the extension, opens the panel, and round-trips `getHealth`,
  `getProductProfile`, `listLearnScenarios` and `getConfigStatus` (temp
  user-data dir with a seeded `settings.json` and `temp-sqlite-db`
  fixture).
- Manual check on Remote-SSH or WSL and a Dev Container (D6), recorded in
  architecture §12.
- `vsce package --no-dependencies` (everything is bundled). Add
  `.vscodeignore` (ship only `dist/` minus `meta.json`, `media/`,
  `README.md`, `LICENSE`, `CHANGELOG.md`, `icon.png`) and a size budget
  (proposal: under 5 MB).
- **Exit:** `<name>-<version>.vsix` installs into a clean VS Code via
  "Install from VSIX…" and passes the 10.4/10.5/10.6 exit checks with no
  repo checkout present.

## 7. Deployment

### 7.1 CI (every PR)

Extend `.github/workflows/ci.yml` with a second job, `extension`, on
`ubuntu-latest`. The existing `test` job keeps covering the standalone app.

1. `npm ci`, then `npm run build --workspace=packages/vscode-extension`
   (it builds web in `extension` mode first).
2. Run the unit tests, including the bundle-boundary test.
3. `xvfb-run -a npm run test:integration --workspace=packages/vscode-extension`.
4. `npx vsce package` and upload the `.vsix` as a workflow artifact
   (`actions/upload-artifact`, pinned by SHA like the existing actions).

Optional matrix: `macos-latest` and `windows-latest` for the integration
suite only, to cover the D4 path derivation for real.

### 7.2 Releases (independent per product, D8)

**Extension, on tag `ext-v*`.** New workflow
`.github/workflows/release-extension.yml`:

1. Build and test as in CI.
2. `vsce publish --packagePath *.vsix` with `VSCE_PAT` (Azure DevOps PAT
   with Marketplace "Manage" scope) as a repository secret, in a
   protected `release` environment with required reviewers.
3. `ovsx publish *.vsix` with `OVSX_PAT` for Open VSX (VSCodium, Cursor,
   and others).
4. Attach the `.vsix` to a GitHub Release named after the extension.

- **Versioning:** the version lives in `packages/vscode-extension/package.json`
  and starts at `0.1.0`. Use the Marketplace pre-release channel
  (`--pre-release`, odd minor) until 10.7's remote check passes, then
  publish a stable even minor.
- **Marketplace listing:** README (Learn/Analyze/dashboard screenshots), a
  privacy statement ("reads local Copilot Chat logs only; no network; no
  telemetry"), `CHANGELOG.md`, and the description, categories and
  keywords from §3.4. It links to the standalone app for users of other
  agents.

**Standalone app, on tag `app-v*`.** A GitHub Release with notes only (it
runs from source), and the root `package.json` version bump. Its
changelog sits at the repo root.

- **Permissions:** `contents: write` only on the release jobs (for GitHub
  Releases); everything else stays `contents: read`.

### 7.3 Manual and sideload distribution

Until a publisher is set up, the `.vsix` from the CI artifact or the
GitHub Release installs with
`code --install-extension <name>-<version>.vsix`.

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | `node:sqlite` is missing or flagged in the extension host's Electron/Node. | Spike 10.0. Fallback: a `SqliteReader` port with a WASM adapter, used only by the extension. |
| R2 | The webview `postMessage` payload for a large insights dataset is slow. | Insights already accept `limit`. Measure in 10.4, and stream by provider if needed (§11.1 open question). |
| R3 | Copilot Chat's storage layout differs on remote hosts. | D6 plus the manual remote check in 10.7. The provider reports "unavailable" with a reason, never a crash (§11.3). |
| R4 | Bundling ESM code that relies on `import.meta.url`. | G4 refactor in 10.1, and an integration test that loads the bundled file. |
| R5 | Marketplace PAT leakage. | Protected environment, PAT scoped to Marketplace only, rotated yearly. Open VSX token separate. |
| R6 | Non-Copilot code leaks into the extension through a shared import. | Bundle-boundary test in CI (§3.1). Move to Option B if it keeps failing. |
| R7 | The two products drift (a fix lands in only one). | Shared code has one implementation; product-specific code is limited to composition roots, adapters and `ProductProfile`. Both CI jobs run on every PR. |

## 9. Open questions (need a decision before the step named)

1. **Final product names** (before 10.3). The working names are
   "AI Credits Analyzer" (extension) and "Agent Cost Analyzer"
   (standalone). Alternatives for the extension: "Chat Cost Analyzer",
   "Token Cost Lens". Neither name includes "Copilot" (§3.4). The repo
   name, the internal `@copilot-cost-analyzer/*` package scope and the
   app settings directory stay as they are, to avoid a migration.
2. **Publisher id** (before 10.3).
3. **Minimum VS Code version** (10.0): this depends on `node:sqlite` and on
   the MCP definition-provider API.
4. **Webview placement:** an editor-area panel only, or also an
   activity-bar view with the session list? Proposal: panel only in v1.

Settled on 2026-10-24: the extension is Copilot-only; it includes the
tool audit and insights dashboard; both products ship an MCP server; the
products have separate names and independent versions; and the
standalone app keeps VS Code support.

## 10. Exit criterion (Phase 10 as a whole)

A clean VS Code (no repo checkout, no Node install) installs the
extension from the Marketplace or a `.vsix`. Its "Open" command shows
Learn mode. On Linux, macOS and Windows it shows the user's real Copilot
Chat sessions in Analyze mode, the tool audit and the insights dashboard,
with the same numbers as the standalone app for the same session. A
`logging-disabled` warning's Fix button opens that exact setting. With
MCP enabled, Copilot Chat lists the same 9 read-only tools, backed by
Copilot data only. The bundle-boundary test proves no Claude Code, pi or
mitmproxy code ships in the `.vsix`. The webview makes no network
requests (CSP `connect-src 'none'`). The standalone app, its HTTP API and
its stdio MCP server suites are unchanged and green.
