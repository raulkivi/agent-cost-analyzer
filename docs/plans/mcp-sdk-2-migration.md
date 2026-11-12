# MCP SDK 2 and ext-apps 2.x migration (Phase 12 follow-up)

**Last changed:** 2026-11-12 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **planned 2026-11-12, not started.** Four owner decisions (§6) come before M1.

Moves both MCP servers, the extension's MCP child and the MCP App views from `@modelcontextprotocol/sdk` 1.32.2 and `@modelcontextprotocol/ext-apps` 1.7.5 to the split SDK 2 packages and ext-apps 2.x. It is the first follow-up in [mcp-apps.md](mcp-apps.md) §11. The pin and its reason are in mcp-apps.md §4.2.

## 1. Why now

- **ext-apps 1.x has had no release since 1.7.5 (2026-07-23).** 2.0.0 came out 2026-09-08, 2.0.4 on 2026-10-27 and 2.1.0 on 2026-11-10. Spec changes, such as app-provided tools and `object-src 'none'` (mcp-apps.md §10), land only in 2.x.
- **SDK 1.x has an end date.** The TypeScript SDK README says v1.x "continues to receive bug fixes and security updates for at least six months after the v2 release (2026-07-27)", so until at least 2027-01-27.
- **A server on the 1.x transport serves 2025-era clients only.** The upgrade guide says a server that calls `server.connect(new StdioServerTransport())` "serves 2025-era clients only, and a client pinned to 2026-07-28 cannot connect to it". Both stdio entry points do that today. When VS Code or Claude Desktop moves to the 2026-07-28 spec, the servers would stop connecting.
- **New views come after.** U16 and U17 (mcp-apps.md §11) should be built on 2.x, not ported later.

## 2. What changes (from the migration guides)

Sources: the ext-apps [migrate-to-2](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/migrate-to-2.md) doc (read in full), the [TypeScript SDK README](https://github.com/modelcontextprotocol/typescript-sdk) and the [upgrade guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2). Part of the upgrade guide was read only as a summary; M0 checks the rows marked *(summary)*.

| Area | 1.x (today) | 2.x |
|---|---|---|
| Packages | `@modelcontextprotocol/sdk` | `@modelcontextprotocol/server`, `client`, `core` (zod `*Schema` constants), `node` and `express` (HTTP only). All v2 packages share one version; 2.4.0 on 2026-10-23 |
| Server class | `sdk/server/mcp.js` | `@modelcontextprotocol/server` |
| Stdio | `sdk/server/stdio.js`, `server.connect(new StdioServerTransport())` | `@modelcontextprotocol/server/stdio`; `serveStdio(() => createServer())` serves both 2025-era and 2026-07-28 clients |
| Test transports | `sdk/inMemory.js`, `sdk/client/index.js` | `InMemoryTransport` from `client` or `server` (both halves from one package); `Client` from `client` *(summary)* |
| Tool schemas | Raw zod shapes accepted | Standard Schema objects (`z.object({...})`); raw shapes work only through deprecated overloads. Needs zod ≥ 4.2.0; the repo has 4.6.7 |
| Advertised `inputSchema` | JSON Schema draft as today | JSON Schema 2020-12; tests that compare listed schemas need re-baselining *(summary)* |
| `structuredContent` | Object | `unknown`; check with `!== undefined` *(summary)* |
| Unknown or disabled tool | `result.isError: true` | JSON-RPC error `ProtocolError(-32602)` |
| Errors | `McpError`, `ErrorCode` | `ProtocolError` (numeric code), `SdkError` (string code); no `MCP error N:` prefix |
| Capabilities | As declared | `tools`, `resources`, `prompts` advertised with `listChanged: true` *(summary)* |
| Handler context | `extra.signal`, `extra.requestId` | `ctx.mcpReq.signal`, `ctx.mcpReq.id` (the code uses neither) |
| ext-apps peers | `@modelcontextprotocol/sdk` | `@modelcontextprotocol/client` and `core` required (`App` and `AppBridge` extend the client's `Protocol`); `server` only for `./server` |
| ext-apps API | — | "`App` / `AppBridge` constructors, the `on*` setters, `addEventListener`, `callServerTool`, `readServerResource`, `registerAppResource`, the React hooks and the `_meta.ui.resourceUri` handling are unchanged." `registerAppTool`, the theme helpers and `sendMessage`/`requestDisplayMode` aren't mentioned (M0) |
| Wire | — | "The `ui/*` messages exchanged over the iframe channel are byte-identical to 1.x. A 2.x View runs in a 1.x host and a 2.x host renders 1.x Views." |
| Runtime | — | Node 20+ (the repo requires 22.18); ESM first, with a CommonJS build |
| Tooling | — | Codemod: `npx @modelcontextprotocol/codemod@latest v1-to-v2 .`, then grep for `@mcp-codemod-error` |

The two SDKs share no classes or types, so an object must not cross between a v1 and a v2 module. A process boundary (stdio) is fine.

### 2.1 Spec 2026-07-28 and release items that touch this project

SDK 2 implements the MCP spec revision 2026-07-28 ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)). The release notes ([SDK](https://github.com/modelcontextprotocol/typescript-sdk/releases), [ext-apps](https://github.com/modelcontextprotocol/ext-apps/releases)) don't say which SDK version added which spec item, or which hosts speak 2026-07-28 (M0 finds out). Items for a read-only stdio server that serves views:

| Item | Source | What it means here | Task |
|---|---|---|---|
| Stateless protocol: no `initialize`; each request carries its protocol version and client capabilities in `_meta`; servers must answer `server/discover`, which clients may use to probe a stdio server | Spec, SEP-2575 | The reason for D1. A test sends `server/discover` and a 2026-07-28 request to each stdio entry | M2 |
| Cache hints: `tools/list`, `resources/list` and `resources/read` results carry `ttlMs` and `cacheScope` | Spec, SEP-2549 | `views.html` is read from disk on every `resources/read`, so a long TTL could keep a host on an old copy after an update. D4 sets the views resource's hints | M2, D4 |
| `tools/list` SHOULD be in a fixed order | Spec | The tool-list comparison test can compare in order | M2 |
| Resource not found `-32002` → `-32602`; spec error codes renumbered (`-32020` to `-32099` reserved) | Spec | The views' drill-down error paths and the fake host must expect the new codes (with D2) | M1, M2 |
| `ping` and `logging/setLevel` removed; logging deprecated | Spec, SEP-2577 | No effect: the servers log to stderr and send no log notifications | — |
| `inputSchema`/`outputSchema` any JSON Schema 2020-12; `structuredContent` any JSON value | Spec, SEP-2106 | All 22 tools return objects; the comparison test pins it | M2 |
| `outputSchema` from `z.object(...).meta({ id })` treated as an object; no `{ result }` wrapping on 2025-11-25 | SDK 2.4.0 | Check the domain schemas that carry `.meta({ id })` keep their result shape | M2 |
| `maxToolInputElements` on `McpServer` (off by default): an oversized tool argument returns `isError: true` | SDK 2.3.0 | A cheap guard for a read-only server; turn it on with a limit above the largest real argument | M2 |
| A server or transport serves one connection at a time | SDK 2.3.0 | No effect: each stdio process has one connection; in-process tests build a server per client | M2 |
| WebMCP bridge: tools a view registers with `App.registerTool()` are mirrored to `document.modelContext`, and tools the page registers there are served over the Apps channel; on by default (`webMcpBridge: false` turns it off) | ext-apps 2.1.0 | The views register no app tools. Set `webMcpBridge: false` so the views' surface stays exactly what `no-forwarding.test.ts` reviews; a test asserts the view declares no `tools` capability | M1 |
| Hosts no longer need double-sandboxed iframes (draft spec) | ext-apps 2.1.0 | Host side. The views keep relying on the host's sandbox and CSP (threat-model §6.1) | M5 |
| Skills, input requests (MRTR), the Tasks extension, sampling, elicitation, HTTP headers, OAuth | Spec, SDK 2.3.0–2.4.0 | Not used: read-only stdio, no server-started requests | — |

## 3. What uses the SDK today

| Where | Uses | Imports |
|---|---|---|
| `packages/server/src/mcp/` (23 files), `composition/`, `test-support/` | `McpServer`, `registerTool` (22 calls; 19 `inputSchema` raw shapes), `StdioServerTransport`; tests use `Client` and `InMemoryTransport` | `server/mcp.js`, `server/stdio.js`, `client/index.js`, `inMemory.js`, `types.js` |
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
| M0 | **Facts and spike.** Pick the ext-apps version current at M1's start (2.1.0 on 2026-11-12, still inside Dependabot's 7-day cooldown) and read its type definitions (tarball) for `registerAppTool`, `App`'s methods, the theme helpers and the `_meta.ui` shape; read the upgrade guide's middle section (annotations, server instructions, `outputSchema`, the *(summary)* rows). Run the codemod in a throwaway worktree and count what it leaves. Measure `dist/views.html` with ext-apps 2.x. Find which `protocolVersion` VS Code 1.146 and Claude Desktop send in `initialize` (from a real-Copilot run's MCP log and the owner's Claude Desktop log). | A findings section in this plan; §6's decisions ready for the owner; the task estimates below confirmed or changed | medium | Sonnet | — |
| M1 | **Views on ext-apps 2.x.** `packages/mcp-apps`: ext-apps 2.x (M0's version), `@modelcontextprotocol/client` and `core` ^2; `webMcpBridge: false` (§2.1); `ext-apps-port.ts`, the theme binding, the fake host (`e2e/`) and the visual harness. `AppHostPort` keeps the views themselves unchanged. | Unit, a11y, keyboard, `no-forwarding.test.ts`, `bundle-size.test.ts` (within the budget, or §6 D3) and every G5 spec pass against the 1.x servers | medium | Sonnet | M0, D3 |
| M2 | **Servers on SDK 2.** `packages/server/src/mcp/**`, `composition/`, `test-support/`, the extension's `src/mcp/`: imports; `server/discover` and the cache hints per D4 (§2.1); `maxToolInputElements`; `inputSchema` raw shapes → `z.object`; `structuredContent` typing; `register-app-views.ts` on `ext-apps/server` 2.x; both stdio entries per D1; error mapping; tests' `Client`/`InMemoryTransport`. The esbuild bundle of `mcp-stdio.js` still builds and loads. | The server and extension unit suites pass; a `tools/list` comparison test shows the same tool names, annotations, `_meta.ui`, `outputSchema` and server instructions as before (schema dialect aside); tool counts 22/21 and 20/19 unchanged; `mcp/security.test.ts` passes | high | Opus | M0, D1, D2, D4 |
| M3 | **Stdio test clients on SDK 2.** web e2e support, copilot-e2e support, the extension's integration test and `mcp-stdio-bundle.test.ts` (its `protocolVersion` per D1). | `web-e2e`, `extension`, `extension-ui` and `mcp-apps-e2e` pass in CI | low | Sonnet | M2 |
| M4 | **Remove v1.** Drop `@modelcontextprotocol/sdk` from every `package.json`; `npm ci`; grep for leftovers and `@mcp-codemod-error`. | `npm ls @modelcontextprotocol/sdk` is empty; all checks in [mcp-apps-handover.md](mcp-apps-handover.md) §6 pass | low | Haiku | M1, M3 |
| M5 | **Docs and review.** architecture.md (MCP section), mcp-apps.md §4.2 (the pin) and §10, threat-model.md §4 and §6.1 (the unknown-tool error, the protocol version, the views file), both CHANGELOGs if D1 adds 2026-07-28 support, the Gantt. A security read of the diff: no new tool, argument, `_meta` or host call. | Docs match the code; the review finds no new surface, or records it | medium | Opus | M4 |
| M6 | **Release check.** The real-Copilot release gate on the merged commit (owner), then the releases. Claude Desktop can't be driven, so G5 covers it with recorded host context; a hand check there needs the owner's explicit exception ([release-ui-gate.md](release-ui-gate.md)). | Gate `PASS`; extension and app released | low | none (owner) | M5 |

Critical path: M0 → D1–D4 → M2 → M3 → M4 → M5 → M6. M1 can run beside M2.

## 6. Owner decisions (before M1)

- **D1. Protocol versions.** Move both stdio entries to `serveStdio`, which serves 2025-era and 2026-07-28 clients (recommended), or keep `connect(new StdioServerTransport())` until a host needs 2026-07-28. M0 reports what the hosts send today.
- **D2. Unknown-tool error.** Accept that a call to an unknown or disabled tool becomes a JSON-RPC error (`-32602`) instead of `isError: true` (recommended: it is the SDK's behaviour and no view calls an unknown tool), or keep the old answer with a wrapper.
- **D3. Bundle budget.** If ext-apps 2.x pushes `dist/views.html` over 1.2 MiB (the guide says its bundled builds are about 25% larger; this repo bundles from npm, so M0 measures), raise the budget or split the views into lazy chunks.

- **D4. Cache hints for the views resource.** Spec 2026-07-28 lets a host cache `resources/read` for `ttlMs`. Give `views.html` a short TTL (recommended: one that outlives a chat turn but not an update, set from M0's findings) or `ttlMs: 0`, so a host never shows views older than the installed server.

## 7. Risks

| Risk | Effect | Handling |
|---|---|---|
| A host still speaks only 2025-era MCP and the 2.x server behaves differently with it | Tools or views missing in VS Code or Claude Desktop | D1's `serveStdio` serves both; G4 in real Copilot Chat and G5 with recorded Claude context before release |
| The JSON Schema 2020-12 `inputSchema` or `listChanged: true` changes how a host reads the tools | A host rejects a tool or re-lists tools | M2's `tools/list` comparison; G4 lists the extension's tools in real Copilot Chat |
| esbuild can't bundle the new packages into `mcp-stdio.js` (ESM/CJS, subpath exports) | The extension's MCP child doesn't start | M2 exit criterion; `mcp-stdio-bundle.test.ts` |
| `registerAppTool` or `App` changed in ways the migration doc doesn't list | Views or `_meta.ui` break | M0 reads the chosen version's types first |
| Bundle growth | Over budget | D3 |
| A host caches `views.html` past an update (spec cache hints) | Old views against a new server | D4 |
| SDK 1.x fixes stop after 2027-01-27 | Security fixes missing | Finish M0–M6 before then |

## 8. Exit criterion

No `@modelcontextprotocol/sdk` in the dependency tree; both servers, the extension's MCP child and the views run on SDK 2 and ext-apps 2.x. `tools/list` in both products lists the same tools, annotations and `_meta.ui` as before; every CI check and the real-Copilot release gate pass; the docs in M5 match the code.
