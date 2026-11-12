# MCP SDK 2 and ext-apps 2.x migration (Phase 12 follow-up)

**Last changed:** 2026-11-12 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **M0 to M4 done 2026-11-12 (findings in §9); owner decisions D1–D4 taken 2026-11-12 (§6); M5–M6 not started.**

Moves both MCP servers, the extension's MCP child and the MCP App views from `@modelcontextprotocol/sdk` 1.32.2 and `@modelcontextprotocol/ext-apps` 1.7.5 to the split SDK 2 packages and ext-apps 2.x. It is the first follow-up in [mcp-apps.md](mcp-apps.md) §11. The pin and its reason are in mcp-apps.md §4.2.

## 1. Why now

- **ext-apps 1.x has had no release since 1.7.5 (2026-07-23).** 2.0.0 came out 2026-09-08, 2.0.4 and 2.1.0 on 2026-10-27 (npm registry `time`; an earlier draft said 2.1.0 was 2026-11-10). Spec changes, such as app-provided tools and `object-src 'none'` (mcp-apps.md §10), land only in 2.x.
- **SDK 1.x has an end date.** The TypeScript SDK README says v1.x "continues to receive bug fixes and security updates for at least six months after the v2 release (2026-07-27)", so until at least 2027-01-27.
- **A server on the 1.x transport serves 2025-era clients only.** The upgrade guide says a server that calls `server.connect(new StdioServerTransport())` "serves 2025-era clients only, and a client pinned to 2026-07-28 cannot connect to it". Both stdio entry points do that today. When VS Code or Claude Desktop moves to the 2026-07-28 spec, the servers would stop connecting.
- **New views come after.** U16 and U17 (mcp-apps.md §11) should be built on 2.x, not ported later.

## 2. What changes (from the migration guides)

Sources: the ext-apps [migrate-to-2](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/migrate-to-2.md) doc (read in full), the [TypeScript SDK README](https://github.com/modelcontextprotocol/typescript-sdk) and the [upgrade guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2). M0 checked the rows that were first read only as a summary against the 2.4.0 type definitions and the full upgrade guide (§9); each row says what settled it.

| Area | 1.x (today) | 2.x |
|---|---|---|
| Packages | `@modelcontextprotocol/sdk` | `@modelcontextprotocol/server`, `client`, `core` (zod `*Schema` constants), `node` and `express` (HTTP only). All v2 packages share one version; 2.4.0 on 2026-10-23 |
| Server class | `sdk/server/mcp.js` | `@modelcontextprotocol/server` |
| Stdio | `sdk/server/stdio.js`, `server.connect(new StdioServerTransport())` | `@modelcontextprotocol/server/stdio`; `serveStdio(() => createServer())` serves both 2025-era and 2026-07-28 clients |
| Test transports | `sdk/inMemory.js`, `sdk/client/index.js` | `InMemoryTransport` is exported by both `@modelcontextprotocol/client` and `@modelcontextprotocol/server` (guide, "Imports & transports"; both `index.d.mts`); `Client` from `@modelcontextprotocol/client`; `StdioClientTransport` from `@modelcontextprotocol/client/stdio` (confirmed, §9b) |
| Tool schemas | Raw zod shapes accepted | Standard Schema objects (`z.object({...})`); raw shapes work only through deprecated overloads (`ZodRawShape`, `LegacyToolCallback`). Needs zod ≥ 4.2.0; the repo has 4.6.7 (confirmed, §9b) |
| Advertised `inputSchema` | JSON Schema draft as today | JSON Schema 2020-12 (guide: `z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' })` is "the dialect v2 advertises"); tests that compare listed schemas need re-baselining (confirmed) |
| `structuredContent` | Object | `unknown` (guide: "widened from `{ [k: string]: unknown }` to `unknown`"; ext-apps 2.1.0 schema: `structuredContent: ZodOptional<ZodUnknown>`); check with `!== undefined` (confirmed) |
| Unknown or disabled tool | `result.isError: true` | JSON-RPC error `ProtocolError(-32602)` |
| Errors | `McpError`, `ErrorCode` | `ProtocolError` (numeric code), `SdkError` (string code); no `MCP error N:` prefix |
| Capabilities | As declared | A declared `tools: {}`, `resources: {}` or `prompts: {}` is "advertised with `listChanged: true` at construction"; `listChanged: false` opts out (guide, "Server (McpServer…)", "Eager capability-handler install"; confirmed) |
| Handler context | `extra.signal`, `extra.requestId` | `ctx.mcpReq.signal`, `ctx.mcpReq.id` (the code uses neither) |
| ext-apps peers | `@modelcontextprotocol/sdk` | `@modelcontextprotocol/client` and `core` required (`App` and `AppBridge` extend the client's `Protocol`); `server` only for `./server` |
| ext-apps API | — | "`App` / `AppBridge` constructors, the `on*` setters, `addEventListener`, `callServerTool`, `readServerResource`, `registerAppResource`, the React hooks and the `_meta.ui.resourceUri` handling are unchanged." M0 compared the `.d.ts` files of 1.7.5, 2.0.4 and 2.1.0: every symbol this repo uses keeps its name and call signature; only `registerAppTool`'s generics changed (§9a) |
| Wire | — | "The `ui/*` messages exchanged over the iframe channel are byte-identical to 1.x. A 2.x View runs in a 1.x host and a 2.x host renders 1.x Views." |
| Runtime | — | Node 20+ (the repo requires 22.18); ESM first, with a CommonJS build |
| Tooling | — | Codemod: `npx @modelcontextprotocol/codemod@latest v1-to-v2 .`, then grep for `@mcp-codemod-error` |

The two SDKs share no classes or types, so an object must not cross between a v1 and a v2 module. A process boundary (stdio) is fine.

### 2.1 Spec 2026-07-28 and release items that touch this project

SDK 2 implements the MCP spec revision 2026-07-28 ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)). The release notes ([SDK](https://github.com/modelcontextprotocol/typescript-sdk/releases), [ext-apps](https://github.com/modelcontextprotocol/ext-apps/releases)) don't say which SDK version added which spec item, or which hosts speak 2026-07-28 (M0 found no local evidence of any host that does, §9e). Items for a read-only stdio server that serves views:

| Item | Source | What it means here | Task |
|---|---|---|---|
| Stateless protocol: no `initialize`; each request carries its protocol version and client capabilities in `_meta`; servers must answer `server/discover`, which clients may use to probe a stdio server | Spec, SEP-2575 | The reason for D1. `serveStdio` answers `server/discover` itself (the pinned `Server` has a `_ondiscover` handler; §9b). A test sends `server/discover` and a 2026-07-28 request to each stdio entry. `serveStdio` calls the server factory once per connection and once more for a discarded `server/discover` probe, so `createServer` must have no side effects | M2 |
| Cache hints: `tools/list`, `resources/list` and `resources/read` results carry `ttlMs` and `cacheScope` | Spec, SEP-2549 | `views.html` is read from disk on every `resources/read`, so a long TTL could keep a host on an old copy after an update. The SDK default is `ttlMs: 0`, `cacheScope: 'private'`, and 2025-era responses never carry the fields (§9b), so doing nothing is already safe. D4 only decides whether to set a longer TTL | M2, D4 |
| `tools/list` SHOULD be in a fixed order | Spec | The tool-list comparison test can compare in order | M2 |
| Resource not found `-32002` → `-32602`; spec error codes renumbered (`-32020` to `-32099` reserved) | Spec | The views' drill-down error paths and the fake host must expect the new codes (with D2) | M1, M2 |
| `ping` and `logging/setLevel` removed; logging deprecated | Spec, SEP-2577 | No effect: the servers log to stderr and send no log notifications | — |
| `inputSchema`/`outputSchema` any JSON Schema 2020-12; `structuredContent` any JSON value | Spec, SEP-2106 | All 22 tools return objects; the comparison test pins it | M2 |
| `outputSchema` from `z.object(...).meta({ id })` treated as an object; no `{ result }` wrapping on 2025-11-25 | SDK 2.4.0 | Check the domain schemas that carry `.meta({ id })` keep their result shape | M2 |
| `maxToolInputElements` on `McpServer` (off by default; "largest combined number of array elements and object members a single `tools/call` `arguments` payload may contain", at least 1) | SDK 2.3.0 | A cheap guard for a read-only server; turn it on with a limit above the largest real argument. The types don't say what an oversized call returns (the earlier draft said `isError: true`; unverified), so M2 pins it with a test | M2 |
| A server or transport serves one connection at a time | SDK 2.3.0 | No effect: each stdio process has one connection; in-process tests build a server per client | M2 |
| WebMCP bridge: tools a view registers with `App.registerTool()` are mirrored to `document.modelContext`, and tools the page registers there are served over the Apps channel; on by default; `AppOptions.webMcpBridge?: boolean` (the third `App` constructor argument) turns it off. Present in 2.1.0 only: 2.0.4 has no such option or bridge (§9a) | ext-apps 2.1.0 | The views register no app tools. M1 uses 2.0.4, which has no bridge. When the views move to 2.1.0 or later, pass `new App(info, {}, { webMcpBridge: false })` so the views' surface stays exactly what `no-forwarding.test.ts` reviews; a test asserts the view declares no `tools` capability | M1 (2.0.4), later bump |
| Hosts no longer need double-sandboxed iframes (draft spec) | ext-apps 2.1.0 | Host side. The views keep relying on the host's sandbox and CSP (threat-model §6.1) | M5 |
| Skills, input requests (MRTR), the Tasks extension, sampling, elicitation, HTTP headers, OAuth | Spec, SDK 2.3.0–2.4.0 | Not used: read-only stdio, no server-started requests | — |

## 3. What uses the SDK today

| Where | Uses | Imports |
|---|---|---|
| `packages/server/src/mcp/` (23 files), `composition/`, `test-support/` | `McpServer`, `registerTool` (22 calls; 19 `inputSchema` raw shapes), `registerPrompt` (6 `argsSchema` raw shapes in `prompts.ts`; M0 found them), `StdioServerTransport`; tests use `Client` and `InMemoryTransport` | `server/mcp.js`, `server/stdio.js`, `client/index.js`, `inMemory.js`, `types.js` |
| `packages/server/src/mcp/apps/register-app-views.ts` | `registerAppTool`, `registerAppResource`, `RESOURCE_MIME_TYPE`, `RESOURCE_URI_META_KEY` | `ext-apps/server` |
| `packages/vscode-extension/src/mcp/` (stdio entry, server factory) | The server code above, bundled by esbuild into `dist/mcp-stdio.js` | `server/stdio.js` and the server package |
| `packages/vscode-extension` tests (`mcp-stdio-bundle.test.ts`, integration, copilot-e2e support) | `Client` over stdio; the bundle test sends `protocolVersion: "2025-06-18"` | `client/*` |
| `packages/mcp-apps/src/` | `App` (`host/ext-apps-port.ts`), `applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts` | `ext-apps` (no direct SDK import) |
| `packages/mcp-apps/e2e/` (fake host), `test/visual/` | `AppBridge`, `McpUiHostContextSchema`, `getToolUiResourceUri`; `Client` to the real server | `ext-apps/app-bridge`, `sdk/client/*` |
| `packages/web/e2e/support` | `Client` over stdio | `sdk/client/*` |

Three tests assert `isError: true` for an unknown input (`register-app-views.test.ts`, `billing-tools.test.ts`, `cost-analysis-tools.test.ts`). M2 checks whether these test an unknown *tool* (behaviour changes) or an unknown *argument value* (no change).

## 4. Approach

Staged, in the order the upgrade guide recommends: add v2, move sources, remove v1 last. The stages follow process boundaries, so no v1 object meets a v2 one:

1. **Views first (M1).** `packages/mcp-apps` moves to ext-apps 2.x on its own. Its wire is byte-identical, so the 2.x views keep working with the 1.x servers. npm workspaces let `mcp-apps` depend on ext-apps 2.x while `packages/server` keeps 1.7.5.
2. **Servers together (M2).** `packages/server` and the extension's MCP child share `createMcpServer`, so they move in one change, with their in-process tests.
3. **Stdio test clients (M3).** web e2e, copilot-e2e and the extension's integration and bundle tests talk to the server over stdio, so they can move after M2.
4. **Remove v1 (M4).** No `@modelcontextprotocol/sdk` left in `package-lock.json`.

Every task is test-first (architecture.md §11.4): the behaviour each change keeps is pinned by a test before the code moves. The codemod does the mechanical part of M2 and M3; its output is reviewed like any other diff.

## 5. Tasks

Models per the planning rules: Haiku for mechanical edits, Sonnet for typical work, Opus for cross-cutting design. No local model in this repo.

| Task | Work | Exit criterion | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| M0 | **Facts and spike.** **Done 2026-11-12; findings in §9.** Read the ext-apps 2.0.4 and 2.1.0 and SDK 2.4.0 type definitions (tarballs), the upgrade guide and the repo's use of each symbol; ran the codemod in the worktree (discarded); built `views.html` with ext-apps 2.x; searched local host logs for protocol versions. | A findings section in this plan; §6's decisions ready for the owner; the task estimates below confirmed or changed | medium | Sonnet | — |
| M1 | **Done 2026-11-12:** ext-apps 2.0.4, client/core 2.4.0, sdk devDependency dropped, fake host on the v2 client (own `e2e/support/stdio-server.ts`, since packages/web stays on SDK 1.x); `views.html` 741,922 bytes; all checks and 167 G5 specs pass. **Views on ext-apps 2.0.4** (M0's pick, §9a). `packages/mcp-apps`: ext-apps 2.0.4 exact (as today's exact pin), `@modelcontextprotocol/client` and `core` 2.4.0; `ext-apps-port.ts` and the theme binding need no code change (M0: `tsc` and all 1642 package tests pass against 2.0.4); the fake host (`e2e/`) takes `CallToolResult`/`Tool`/`Client` types from `@modelcontextprotocol/client` instead of `sdk/types.js`; check `oninitialized`'s now-optional `params`. `packages/server` keeps ext-apps 1.7.5 until M2, so two versions sit in the tree meanwhile. `AppHostPort` keeps the views themselves unchanged. | Unit, a11y, keyboard, `no-forwarding.test.ts`, `bundle-size.test.ts` and every G5 spec pass against the 1.x servers | low | Sonnet | M0 |
| M2 | **Servers on SDK 2.** **Done 2026-11-12:** both servers on `@modelcontextprotocol/server`/`client`/`core` 2.4.0 and ext-apps 2.0.4 under `serveStdio`, `maxToolInputElements` 256; the SDK 1 tool-list snapshots match except the schema dialect and the dropped default `execution: { taskSupport: "forbidden" }`. `packages/server/src/mcp/**`, `composition/`, `test-support/`, the extension's `src/mcp/`: imports; `server/discover` is automatic under `serveStdio`; cache hints per D4 (default `ttlMs: 0` needs no code, §2.1); `maxToolInputElements`; `inputSchema` and `registerPrompt` `argsSchema` raw shapes → `z.object` (the codemod does this, §9c); `createServer` free of side effects (`serveStdio` calls the factory once per connection plus once per `server/discover` probe, §9b); `structuredContent` typing; `register-app-views.ts` on `ext-apps/server` 2.x; both stdio entries per D1; error mapping; tests' `Client`/`InMemoryTransport`. The esbuild bundle of `mcp-stdio.js` still builds and loads. | The server and extension unit suites pass; a `tools/list` comparison test shows the same tool names, annotations, `_meta.ui`, `outputSchema` and server instructions as before (schema dialect aside); tool counts 22/21 and 20/19 unchanged; `mcp/security.test.ts` passes | high | Opus | M0, D1, D2, D4 |
| M3 | **Stdio test clients on SDK 2.** **Done 2026-11-12:** web e2e helper, copilot-e2e support, extension integration and bundle-load tests on `@modelcontextprotocol/client` 2.4.0 (`client/stdio`); `@modelcontextprotocol/client` added to packages/web; mcp-apps e2e uses web's shared `mcp-stdio.ts` again (the M1 copy is deleted); no assertion changed; `mcp-stdio-bundle.test.ts` keeps its raw 2025-06-18 `initialize` and had no SDK import. web e2e support, copilot-e2e support, the extension's integration test, `mcp-stdio-bundle.test.ts` and the two `packages/vscode-extension/test` files the codemod pass did not scan (§9c) (its `protocolVersion` per D1). | `web-e2e`, `extension`, `extension-ui` and `mcp-apps-e2e` pass in CI | low | Sonnet | M2 |
| M4 | **Remove v1. Done 2026-11-12:** dropped the `@modelcontextprotocol/sdk` devDependency from `packages/vscode-extension` and `packages/web`; lockfile updated; `npm ls` finds no installed copy; no `@mcp-codemod-error` in source; all repo checks pass. | `npm ls @modelcontextprotocol/sdk` is empty; all checks in [mcp-apps-handover.md](mcp-apps-handover.md) §6 pass | low | Haiku | M1, M3 |
| M5 | **Docs and review.** architecture.md (MCP section), mcp-apps.md §4.2 (the pin) and §10, threat-model.md §4 and §6.1 (the unknown-tool error, the protocol version, the views file), both CHANGELOGs if D1 adds 2026-07-28 support, the Gantt. A security read of the diff: no new tool, argument, `_meta` or host call. | Docs match the code; the review finds no new surface, or records it | medium | Opus | M4 |
| M6 | **Release check.** The real-Copilot release gate on the merged commit (owner), then the releases. Claude Desktop can't be driven, so G5 covers it with recorded host context; a hand check there needs the owner's explicit exception ([release-ui-gate.md](release-ui-gate.md)). | Gate `PASS`; extension and app released | low | none (owner) | M5 |

Critical path: M0 → D1–D4 → M2 → M3 → M4 → M5 → M6. M1 can run beside M2.

## 6. Owner decisions (decided 2026-11-12)

The owner took every recommendation on 2026-11-12.

- **D1. Protocol versions: `serveStdio`.** Both stdio entries move to `serveStdio`, which serves 2025-era and 2026-07-28 clients; its default `legacy: 'serve'` keeps today's hosts working. M0 found no host on 2026-07-28 yet (Claude Desktop negotiated 2025-11-25; VS Code logs no MCP version, §9e). M2 tests `server/discover` and a 2025-era `initialize` on each entry.
- **D2. Unknown-tool error: accept SDK 2's behaviour.** A call to an unknown or disabled tool becomes a JSON-RPC error (`-32602`) instead of `isError: true`. No view calls an unknown tool. M2 updates the tests that expect `isError` for an unknown *tool*; those for an unknown argument value keep theirs.
- **D3. Bundle budget: raise if needed; not needed.** `dist/views.html` is 741,922 bytes with ext-apps 2.0.4 against 957,451 today (-22.5%), far under 1.2 MiB. The budget stays.
- **D4. Cache hints: `ttlMs: 0`.** The SDK already emits `ttlMs: 0`, `cacheScope: 'private'` unless the server sets a hint, and 2025-era responses carry none (§9b). M2 sets no hint and adds a test that `resources/read` of `views.html` answers `ttlMs: 0` on a 2026-07-28 request, so a host never shows views older than the installed server.

## 7. Risks

| Risk | Effect | Handling |
|---|---|---|
| A host still speaks only 2025-era MCP and the 2.x server behaves differently with it | Tools or views missing in VS Code or Claude Desktop | D1's `serveStdio` serves both; G4 in real Copilot Chat and G5 with recorded Claude context before release |
| The JSON Schema 2020-12 `inputSchema` or `listChanged: true` changes how a host reads the tools | A host rejects a tool or re-lists tools | M2's `tools/list` comparison; G4 lists the extension's tools in real Copilot Chat |
| esbuild can't bundle the new packages into `mcp-stdio.js` (ESM/CJS, subpath exports) | The extension's MCP child doesn't start | M2 exit criterion; `mcp-stdio-bundle.test.ts` |
| `registerAppTool` or `App` changed in ways the migration doc doesn't list | Views or `_meta.ui` break | Retired by M0 for the views: no used symbol changed signature (§9a). `registerAppTool`'s generics change for M2; the raw-shape overload still compiles (deprecated) |
| Bundle growth | Over budget | Retired by M0: the bundle shrinks (§9d) |
| A host caches `views.html` past an update (spec cache hints) | Old views against a new server | D4 |
| SDK 1.x fixes stop after 2027-01-27 | Security fixes missing | Finish M0–M6 before then |

## 8. Exit criterion

No `@modelcontextprotocol/sdk` in the dependency tree; both servers, the extension's MCP child and the views run on SDK 2 and ext-apps 2.x. `tools/list` in both products lists the same tools, annotations and `_meta.ui` as before; every CI check and the real-Copilot release gate pass; the docs in M5 match the code.

## 9. M0 findings (2026-11-12)

Method: `npm pack` of each package into a scratch directory, each extracted into its own directory, `.d.ts`/`.d.mts` read only (no package code run); 1.7.5 from `node_modules`. "Unverified" marks what the types don't settle.

### 9a. ext-apps 2.x API

Versions (npm registry `time`): 1.7.5 2026-07-23; 2.0.0 2026-09-08; 2.0.4 and 2.1.0 both 2026-10-27 (2.1.0 about 75 minutes after 2.0.4). dist-tag `latest` is 2.0.4. Both are older than Dependabot's 7-day cooldown.

2.1.0 vs 2.0.4: `app.d.ts` differs (+22 lines: the `webMcpBridge` option and private WebMCP members); `app-bridge.d.ts`, `server/index.d.ts`, `styles.d.ts`, `types.d.ts` and `constants.d.ts` are identical. So 2.1.0 is 2.0.4 plus the WebMCP bridge.

Peers (2.1.0 `package.json`): `@modelcontextprotocol/client` ^2.0.0, `core` ^2.0.0, `zod` ^4.2.0; `server` ^2.0.0 optional; the only dependency is `@standard-schema/spec`.

Per symbol, 1.7.5 against 2.0.4/2.1.0 (paths under `dist/src/`):

| Symbol | Result |
|---|---|
| `registerAppTool` | Signature changed (types only). 1.x (`server/index.d.ts:184`): `<OutputArgs extends ZodRawShapeCompat \| StandardSchemaWithJSON, InputArgs extends undefined \| ZodRawShapeCompat \| StandardSchemaWithJSON = undefined>(server: Pick<McpServer, "registerTool">, name, config, cb: ToolCallback<...>)`. 2.x (`:201`): `<OutputArgs extends StandardSchemaWithJSON, InputArgs extends StandardSchemaWithJSON \| undefined = undefined>(..., cb: ToolCallback<InputArgs>): RegisteredTool`, plus a deprecated overload (`:210`) taking a `ZodRawShape` with `cb: LegacyToolCallback<InputArgs>`. `ToolCallback`, `McpServer`, `RegisteredTool` now come from `@modelcontextprotocol/server`; the callback's second parameter is `ctx: ServerContext`. The repo's raw-shape calls still type-check through the deprecated overload; M2 moves them to `z.object`. Runtime behaviour is unverified (types only) |
| `registerAppResource` | Unchanged: `(server: Pick<McpServer, "registerResource">, name, uri, config: McpUiAppResourceConfig, readCallback: McpUiReadResourceCallback): RegisteredResource` (`:335`, was `:309`). `McpUiAppResourceConfig extends ResourceMetadata` and has no `cacheHint` key, so a per-resource hint is set on the returned `RegisteredResource.cacheHint` or through the server's `cacheHints` option (§9b) |
| `RESOURCE_MIME_TYPE`, `RESOURCE_URI_META_KEY` | Unchanged values (`"text/html;profile=mcp-app"`, `"ui/resourceUri"`); now declared in the new `constants.d.ts` and still exported from `ext-apps`, `ext-apps/app-bridge` and `ext-apps/server` (`server/index.d.ts:37`) |
| `getToolUiResourceUri` | Unchanged: `(tool: Partial<Tool>) => string \| undefined` (`app-bridge.d.ts:31`); `Tool` is now the client package's type |
| `McpUiHostContextSchema` | Export unchanged (`generated/schema.d.ts:613`, via `types.d.ts` `export *`). Embedded schemas changed: `structuredContent` is `ZodOptional<ZodUnknown>`, result `_meta` gains `io.modelcontextprotocol/serverInfo` and loses `related-task` |
| `McpUiDisplayMode`, `McpUiHostContext`, `McpUiHostCapabilities`, `McpUiResourceCsp` | Unchanged names, still exported from `ext-apps/app-bridge` via `types.d.ts`. `requestDisplayMode` still returns `mode: "inline" \| "fullscreen" \| "pip"` |
| `App` constructor | Unchanged shape: `(appInfo: Implementation, appCapabilities?: McpUiAppCapabilities, options?: AppOptions)` (`app.d.ts:290`, was `:501`). `AppOptions` is now `Omit<ProtocolOptions, "supportedProtocolVersions"> & {...}` (was `ProtocolOptions & {...}`); `App` extends the client's `Protocol<BaseContext>` (was `ProtocolWithEvents<...>`) |
| `App` members the repo calls | All unchanged: `ontoolinput` get/set (`:437`), `ontoolresult` (`:509`), `onhostcontextchanged` (`:573`), `getHostContext(): McpUiHostContext \| undefined` (`:410`), `getHostCapabilities(): McpUiHostCapabilities \| undefined` (`:362`), `connect(transport?: Transport, options?: RequestOptions): Promise<void>` (`:1275`), `callServerTool(params: CallToolRequest["params"], options?): Promise<CallToolResult>` (`:735`), `openLink` (`:1049`) and `sendMessage` (`:929`) both `Promise<{ [x: string]: unknown; isError?: boolean }>`, `requestDisplayMode(...)`: `Promise<{ [x: string]: unknown; mode: "inline" \| "fullscreen" \| "pip" }>` (`:1186`). `readServerResource` also unchanged (`:776`) |
| `AppBridge` | Constructor unchanged in shape: `(client: Client \| null, hostInfo: Implementation, hostCapabilities: McpUiHostCapabilities, options?: HostOptions)` (`app-bridge.d.ts:246`); `Client` is now `@modelcontextprotocol/client`'s. Setters `oncalltool`, `onmessage`, `onopenlink`, `onupdatemodelcontext`, `onrequestdisplaymode`, `onsizechange` and methods `sendToolInput`, `sendToolResult`, `sendHostContextChange`, `connect(transport: Transport)` unchanged. One change: `oninitialized`'s callback parameter is now optional (`params?: McpUiInitializedNotification["params"]`, `:404`; was required). `PostMessageTransport` is still exported from `ext-apps/app-bridge` |
| `applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts` | Unchanged signatures (`styles.d.ts:62`, `:121`, `:184`); still exported from `ext-apps` |
| Other | `AppRequest`, `AppNotification`, `AppResult` unions are now `@deprecated` (nothing consumes them); the repo uses none |

`webMcpBridge` (2.1.0 only, `app.d.ts:78`): `AppOptions.webMcpBridge?: boolean`, "Pass `false` to disable the bridge", `@default true`. Set it through the third `App` argument: `new App({ name, version }, {}, { webMcpBridge: false })`. `createExtAppsHostPort` (`packages/mcp-apps/src/host/ext-apps-port.ts`) passes only two arguments today. 2.0.4 has no such option, so passing it there is a type error.

**Recommendation: ext-apps 2.0.4 for M1, pinned exactly like 1.7.5 is today.**
- It is the npm `latest` tag and 16 days old.
- It has no WebMCP bridge, so there is no new surface to switch off.
- 2.1.0's only change for this repo is that bridge (+4,558 bytes, §9d).
- When Dependabot proposes 2.1.0 or later, that bump adds `webMcpBridge: false` and the "no `tools` capability" test in the same PR.
- 2.1.0 is also acceptable now if the owner prefers to avoid a second bump; the cooldown has passed.

### 9b. SDK 2.4.0 server and client API

Packages: `server` exports `.`, `./stdio`, `./ext/skills`, `./ext/skills/node`, `./validators/ajv`, `./validators/cf-worker`, `./_shims`; `client` exports `.`, `./stdio`, `./ext/skills`, `./validators/*`, `./_shims`; `core` exports `.`, `./internal`, `./ext/skills`. All three: Node >=20, dependency `zod` ^4.2.0; `server` and `client` depend on `core` 2.4.0 exactly. The `node` and `express` packages were not read.

| Item | Result (`dist/` of the extracted tarball; line) |
|---|---|
| `McpServer` | `import { McpServer } from "@modelcontextprotocol/server"`. `constructor(serverInfo: Implementation, options?: McpServerOptions)` (`mcp-*.d.mts:3267`) |
| Options | `McpServerOptions = ServerOptions & { maxToolInputElements?: number }` (`:3226`). `ServerOptions = ProtocolOptions & { capabilities?: ServerCapabilities; instructions?: string; jsonSchemaValidator?; cacheHints?: Partial<Record<CacheableResultMethod, CacheHint>> }` (`:2822`). `instructions` ("Optional instructions describing how to use the server and its features") keeps the 1.x name, so `{ instructions: identity.instructions }` in `mcp-server.ts:102` carries over. `maxToolInputElements`: "Largest combined number of array elements and object members a single `tools/call` `arguments` payload may contain. A number of at least 1; unset or `Infinity` means no limit." The failure mode is not in the types (unverified) |
| `registerTool` | `registerTool(name: string, config: { title?: string; description?: string; inputSchema?: InputArgs; outputSchema?: OutputArgs; annotations?: ToolAnnotations; icons?: Icon[]; scopeChallenge?: ScopeChallengeHandler; _meta?: Record<string, unknown> }, cb: ToolCallback<InputArgs>): RegisteredTool` (`:3373`); `InputArgs`/`OutputArgs extends StandardSchemaWithJSON`. Deprecated raw-shape overload at `:3385`. `annotations`, `description`, `_meta` keep their 1.x names, so the `READ_ONLY` annotations and the `_meta.ui` the views group adds need no rename |
| `registerResource` | `registerResource(name, uriOrTemplate: string, config: ResourceMetadata & { cacheHint?: CacheHint; scopeChallenge? }, readCallback: (uri: URL, ctx: ServerContext) => ReadResourceResult \| InputRequiredResult \| Promise<...>): RegisteredResource` (`:3333`, `:3596`). `RegisteredResource` has a writable `cacheHint?: CacheHint` |
| Cache hints | `CacheHint { ttlMs?: number; cacheScope?: 'public' \| 'private' }` (`:2685`). Set per operation in `ServerOptions.cacheHints`, keyed `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `resources/read`, `server/discover` (`:2696`); a per-resource `cacheHint` wins field by field. Without hints: "cacheable 2026-07-28 results are emitted with `ttlMs: 0` and `cacheScope: 'private'`. Responses to 2025-era requests are never" given the fields (`:2860`) |
| `serveStdio` | `import { serveStdio } from "@modelcontextprotocol/server/stdio"`. `serveStdio(factory: McpServerFactory, options?: ServeStdioOptions): StdioServerHandle` (`stdio.d.mts`). `McpServerFactory = (ctx: McpRequestContext) => McpServer \| Server \| Promise<McpServer \| Server>`; a zero-argument factory is assignable. `ServeStdioOptions { legacy?: 'serve' \| 'reject'; transport?: Transport; onerror?; maxSubscriptions? }`, `legacy` default `'serve'`. `StdioServerHandle { close(): Promise<void> }`. The factory runs once per connection "plus once for a `server/discover` probe instance that is discarded again if the client falls back to `initialize`" (`createMcpHandler-*.d.mts`) |
| Stdio transports | `StdioServerTransport` from `@modelcontextprotocol/server/stdio` (same file); `StdioClientTransport` from `@modelcontextprotocol/client/stdio`. On stdin EOF the server transport closes itself and fires `onclose` |
| `InMemoryTransport`, `Client` | Both exported from `@modelcontextprotocol/client` and from `@modelcontextprotocol/server` (`index.d.mts`). `Client` has `getInstructions()`, `getServerCapabilities()`, `getServerVersion()`, `getDiscoverResult()` (`client-*.d.mts:733-782`), so `mcp-server.test.ts`'s `client.getInstructions()` carries over |
| Errors | `ProtocolError`, `ProtocolErrorCode`, `SdkError`, `SdkErrorCode` exported from both. The repo imports no `McpError` or `ErrorCode` (grep) |
| `server/discover` | Answered by the server itself: `Server` has a private `_ondiscover` ("Answers `server/discover` (protocol revision 2026-07-28). `supportedVersions` lists only modern revisions"). Whether a hand-wired `server.connect(new StdioServerTransport())` serves modern clients is not in the types; the guide statement quoted in §1 says it doesn't. Unverified beyond that |

Upgrade guide (full page read in two parts through a summarising fetch, so the quotes are the fetch's, not verbatim checks):
- Confirmed: `InMemoryTransport` from `client` and `server`; `extra.signal` → `ctx.mcpReq.signal`; `structuredContent` widened to `unknown`; 2020-12 advertised dialect; declared capabilities advertised with `listChanged: true` (opt out with `false`); "Unknown / disabled tool calls now reject" with `ProtocolError(-32602)`; `resources/read` for an unknown URI answers `-32602` on every revision; client cache modes honour `ttlMs`/`cacheScope`.
- Not stated in the page: tool annotations and server instructions. The types settle both (rows above): same names, `ToolAnnotations` and `instructions`.
- `outputSchema` root may now be an array or a string; no change for the repo's object schemas.
- The page's "Server" section says `registerResource` "reserves the `cacheHint` config key", matching the types.

Rows of §2/§2.1 settled by this: test transports, `Client`, `inputSchema` dialect, `structuredContent`, capabilities, `server/discover`, cache hints. Corrected: the `maxToolInputElements` failure mode is unverified, not `isError: true`.

### 9c. Codemod dry run

`@modelcontextprotocol/codemod` v1-to-v2, run per path, then `git checkout -- .` and `git clean`; the tree was clean afterwards.

| Path | Files changed (incl. `package.json`) | Lines | `@mcp-codemod-error` markers |
|---|---|---|---|
| `packages/server` | 32 (31 source; tool reported 68 changes) | +198 / -189 | 20 |
| `packages/vscode-extension/src` | 6 (5 source) | +10 / -10 | 0 |
| `packages/web/e2e` | 2 (1 source: `support/mcp-stdio.ts`) | +4 / -4 | 0 |
| `packages/mcp-apps/e2e` | 4 (3 source) | +5 / -6 | 0 |

- It does: rewrites imports (`sdk/server/mcp.js` → `server`; `sdk/client/index.js` and `inMemory.js` → `client`; `sdk/types.js` → `client` or `server`; `server/stdio.js` → `server/stdio`; `client/stdio.js` → `client/stdio`), wraps raw `inputSchema`/`argsSchema` object literals in `z.object()` (25 INFO notes, including the six `registerPrompt` calls in `prompts.ts`), and edits each `package.json` (removes `@modelcontextprotocol/sdk`, adds `client` and/or `server`).
- All 20 markers are one warning: "Could not verify `outputSchema` is a schema object" (19) or `inputSchema` (1, `session-tools.ts:70`). The tool says no change is needed if the value is already a schema object; whether all 20 are is unverified, and M2's type-check settles it.
- It does not: change `server.connect(new StdioServerTransport())` to `serveStdio` (only the import moved); touch the `ext-apps` imports or versions; handle the unknown-tool error change, `structuredContent` typing, cache hints, `maxToolInputElements` or the `captureRegisteredTools` wrapper in `register-app-views.ts`; add `core` or bump `ext-apps`; reformat (prettier needed); or check test expectations such as `isError: true` for an unknown tool.
- Not scanned: `packages/vscode-extension/test` (2 files import the old SDK) and any path outside the four. Files importing the SDK today: server/src 31, vscode-extension/src 5, vscode-extension/test 2, web/e2e 1, mcp-apps/e2e 3.
- Verdict: the mechanical part of M2 and M3 is small. The judgement parts (D1 entry, error mapping, tests) are as planned.

### 9d. Bundle size

`npm -w packages/mcp-apps run build`, file `packages/mcp-apps/dist/views.html`:

| ext-apps | `@modelcontextprotocol/client` / `core` | Bytes |
|---|---|---|
| 1.7.5 (today, main) | none (SDK 1.32.2) | 957,451 |
| 2.0.4 | 2.4.0 | 741,922 (-215,529, -22.5%) |
| 2.1.0 | 2.4.0 | 746,480 (+4,558 over 2.0.4) |

- With 2.0.4: the build succeeded, `tsc --noEmit` (`src` and `test`) reported no errors, and all 1642 `packages/mcp-apps` unit tests passed, including `bundle-size.test.ts`. `e2e/` is outside `tsconfig` and was neither type-checked nor run.
- The budget is 1.2 MiB (1,258,291 bytes); 2.0.4 leaves 516,369 bytes. D3 is moot.
- `npm install` put ext-apps 2.0.4 in `packages/mcp-apps/node_modules` and hoisted `client` and `core` to the root. All `package.json` and lockfile changes were reverted and `npm ci` rerun; the baseline rebuilds to 957,451.

### 9e. Protocol versions hosts send

Read-only search of `~/.config/Code - Insiders/logs`, `~/.config/Claude/logs` and `~/.cache/aica-copilot-e2e`; only version strings, app names and log dates kept.

- **Claude Desktop** (`main.log`, `main1.log`; "LocalMcpServerManager … negotiated protocol version"): `2025-11-25` in all 31 lines, for every local server (3 lines for this repo's server `ai-credits-analyzer`, all on 2026-11-10; the others dated 2026-10-14 to 2026-11-10). App versions in `main.log` around those dates: 4.23118.0 and 4.23118.1 (2026-11-10, 2026-11-11). The log records the negotiated version, not the version the client offered in `initialize`.
- **VS Code Insiders** (logs 2026-11-10, 2026-11-11) and the real-Copilot run directory `~/.cache/aica-copilot-e2e/user-data/logs` (2026-11-06, 2026-11-11): the MCP server logs (`mcpServer.*.log`, `mcpGateway.log`) record no `initialize` or MCP protocol version. The only `protocolVersion` strings found are the Agent Host Protocol's (`1.0.0`, `0.10.0`, `0.9.0`), a different protocol. VS Code's MCP protocol version: not found.
- No log shows a 2026-07-28 `_meta` protocol version. The VS Code build number was not read. To learn what VS Code sends, wrap the extension's MCP child with a logging proxy or read VS Code's MCP client source (not done).
- Implication for D1: no host on this machine is known to speak 2026-07-28, so D1 is about readiness, not an outage today.

### 9f. Changes to the plan from M0

- M1: ext-apps 2.0.4, not 2.1.0; complexity medium → low; no longer depends on D3.
- M2: adds `registerPrompt` `argsSchema`; `createServer` must be side-effect free (the factory runs per connection plus per probe); `server/discover` needs no code; a test pins the `maxToolInputElements` failure mode.
- M3: adds the two `packages/vscode-extension/test` files.
- D3 and D4 are settled by the findings (recommend: close D3 with no change; keep the SDK's `ttlMs: 0` for D4). D1 and D2 stay with the owner.
- The 2.1.0 publication date is 2026-10-27, not 2026-11-10 (§1 corrected).

### 9g. M2 findings (2026-11-12)

- `tools/list`: SDK 1 listed `execution: { taskSupport: "forbidden" }` on every tool; SDK 2 leaves `execution` out. An absent `taskSupport` means `"forbidden"`, so the comparison test (`tool-list-contract.test.ts`, `copilot-tool-list-contract.test.ts`) drops that default. Everything else matches the SDK 1 snapshots once `$schema` is set aside; tools without arguments advertise `{ type: "object", properties: {} }` with no `$schema`, as before.
- `maxToolInputElements` failure mode (was unverified, §9b): the SDK throws inside the `tools/call` handler's `try`, so an oversized call is an `isError` result ("arguments contain more than the maximum of N elements"), not a JSON-RPC error. An unknown tool is checked before that `try`, so it is the JSON-RPC error `-32602`.
- `createCopilotMcpServer` composed the services on every call; it is now `createCopilotMcpServerFactory`, which composes once and returns the factory `serveStdio` calls.
