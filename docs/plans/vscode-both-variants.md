# Read VS Code Stable and Insiders together (1.0 C16)

**Last changed:** 2026-11-14 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **proposed 2026-11-14, awaiting owner decisions (§9)**. 1.0 criterion C16 (owner, 2026-11-14), found while planning MA13 ([monthly-allowance-standalone.md](monthly-allowance-standalone.md) §3.2, D5). No code before the owner approves this plan.

## Contents

1. Why
2. Goals and non-goals
3. What exists
4. Spike VB0 (run 2026-11-14)
5. Design
6. Threat-model rows
7. UI checks (Playwright)
8. Tasks
9. Owner decisions
10. Risks
11. Exit criterion
12. Docs to update

## 1. Why

- The standalone app reads one VS Code install. `resolveUserDataDir()` returns "Code - Insiders" if that folder exists, else "Code". The session store, debug logs, Agent Traces db, Agent Host catalog and the settings check all derive from it.
- With both variants installed, Stable's Copilot Chat sessions and AI Credits are invisible in the app. The extension in each variant still sees its own, so the app and the two extensions show three different totals for one GitHub allowance.
- Owner decision 2026-11-14: a new 1.0 criterion C16, "the app reads Stable and Insiders together: sessions tagged by variant, both in totals"; plan first.

## 2. Goals and non-goals

Goals:

- The standalone app (HTTP app and stdio MCP server) lists the Copilot sessions of every installed variant, Stable and Insiders, in one `vscode` provider.
- Each VS Code session carries its variant (`stable` or `insiders`); the web UI shows it and can filter by it; MCP outputs carry it.
- Every total that reads the `vscode` provider includes both variants: Dashboard, cost by repository and project, statements, estimates, savings, audit, insights, replay, allowance (MA13).
- Existing session ids, URLs, MCP calls and insights keys keep working.
- The startup configuration check runs per variant and names the variant in each warning.

Non-goals:

- The extension. It reads its own variant from its `globalStorageUri` (`copilot-log-paths.ts`, vscode-extension.md D4) and keeps doing so; its MCP child keeps its one `--user-data-dir`.
- VS Code Server (remote) data, Code - OSS, VSCodium, Cursor, Windsurf, portable mode, Flatpak paths, a custom `--user-data-dir` and per-profile storage (D5). The root list is built as data, so each later addition is one row plus tests.
- A per-variant split of Dashboard charts or cost tables in 1.0 (D4).
- Re-issuing frozen statements (D11).

## 3. What exists

### 3.1 `resolveUserDataDir()` and its callers

`packages/server/src/platform/vscode-paths/resolve-user-data-dir.ts`: candidates per OS (Linux `~/.config/Code - Insiders`, `~/.config/Code`; macOS `~/Library/Application Support/...`; Windows `%APPDATA%\...`), Insiders first; returns the first candidate that **exists as a folder**, whether or not it holds a `User` folder.

| Caller | What it derives | Product |
|---|---|---|
| `data-sources/sqlite/copilot-chat-global-storage-path.ts` `resolveCopilotChatGlobalStorageFile` | `session-store.db` (via `resolveSessionStoreDbPath`) and `agent-traces.db` (via `resolveAgentTracesDbPath`) under `User/globalStorage/github.copilot-chat/` | app |
| `data-sources/jsonl/session-log-path.ts` `listWorkspaceDebugLogsDirPaths` (default) | every `User/workspaceStorage/*/GitHub.copilot-chat/debug-logs` plus the global `debug-logs` | app (extension and scripts pass `userDataDir`) |
| `data-sources/vscode-settings/vscode-settings-path.ts` `resolveVscodeSettingsPath` | `User/settings.json` for the settings check | app |
| `composition/providers/create-vscode-provider.ts` `createVscodeProvider` | default for all four paths above and `agentHostUserDataDir` | app and extension (the extension passes every path) |
| `composition/create-standalone-api-service.ts` | `agentHostUserDataDir` for `agentHostCatalogProbe` in `checkConfig` | app |
| `server.ts` | startup `checkConfig` with `agentHostCatalogProbe(resolveUserDataDir())` | app |
| `scripts/extract-calibration-capture.mts` | default `--user-data-dir` | dev script |

The `REAL_DATA` scripts (`sa18-subagent-credits`, `savings-exit`, `replay-exit`) and `measure-subagent-spend.mts` already loop over both `~/.config/Code` and `~/.config/Code - Insiders` with explicit paths.

### 3.2 How providers and ids are keyed

- One provider, `VscodeLogProvider`, id `vscode` (`PROVIDER_ID`), label "VS Code (local Copilot Chat)". `composeLogProviders` registers it with mitmproxy, pi and Claude Code; `composeCopilotProviders` (extension) registers it alone.
- It merges two stores: the classic session store (`sessions` rows with `agent_name = 'GitHub Copilot Chat'`, AI Credits from each session's `main.jsonl`) and the Agent Host catalog (`AgentHostSessionSource`). `listSessions` concatenates both and sorts by start; `readSession(id)` tries classic then Agent Host. Domain `Session` has `providerId` and `copilotHarness` (`local` or `agent-host`).
- HTTP: `/api/sessions/:id` and its sub-routes take a bare id and resolve it against the active provider; the web client `encodeURIComponent`s it.
- MCP: per-session tools take `sessionId` and an optional `provider` (`providerArg`); `list_sessions` returns `copilotHarness`.
- Insights key sessions as `providerId:sessionId` (`sessionKeyOf`); `findings-query.ts` splits on the first `:`.

### 3.3 Could session ids collide across variants?

- Classic ids are UUIDs written by each variant's Copilot Chat; two installs generate them independently, so a collision is not expected. The spike found 0 overlaps (§4), with only Insiders holding data.
- Agent Host ids are the Copilot CLI session ids from `copilotcli:/<id>` catalog URIs. Both variants read Copilot CLI event logs from the **same** Copilot home (`~/.copilot/session-state/<id>/events.jsonl`). If one CLI session were catalogued by both variants, both would report it and its AI Credits would count twice. Unverified whether VS Code catalogues CLI sessions it did not create; VB0b measures it (D3).

### 3.4 Startup configuration check (Phase 5, architecture §6.3)

`checkConfig({ settingsPath, minRetainedSessionLogsThreshold, agentHostCatalogPresent })` reads one `settings.json` and probes one `agent-host.db`. Warnings (settings not found, Copilot Chat unavailable, file logging disabled, retention below threshold, Agent Traces off) name no variant. With both installed, Stable's settings are never checked.

### 3.5 Agent Host stores per variant

- Catalog: `<root>/User/globalStorage/agent-host.db` (`agentHostDbPath`).
- Per-session store: `<root>/agentSessionData/<id>/session.db` (`agentSessionDbPath`, id checked against `^[0-9A-Za-z][0-9A-Za-z-]*$`).
- Event log: `<copilotHome>/session-state/<sdkSessionId>/events.jsonl`, one Copilot home for both variants (`resolveCopilotHome`).

### 3.6 Other forks and locations

Not read today and not proposed for 1.0 (D5):

- Code - OSS, VSCodium, Cursor, Windsurf: separate user-data folders. Copilot Chat ships through Microsoft's Marketplace for VS Code; whether it runs in a fork with the same stores is unverified, and none was found on the owner's machine.
- VS Code Server (Remote SSH, WSL, tunnels): `~/.vscode-server/data` (and `-insiders`). The spike found a `github.copilot-chat` globalStorage folder there with no session store and no debug logs.
- Profiles: Copilot Chat's globalStorage is not per profile on the owner's machine (the one custom profile has its own `settings.json` and `globalStorage/state.vscdb` only). The settings check reads the default profile's `settings.json`, as today.

## 4. Spike VB0 (run 2026-11-14)

Read-only Node script with `node:sqlite` in read-only mode, kept outside the repo; it printed counts and id shapes, never titles or prompt text. Machine: the owner's Linux workstation.

| Measure | Stable `~/.config/Code` | Insiders `~/.config/Code - Insiders` | VS Code Server `~/.vscode-server/data` |
|---|---|---|---|
| Folder exists | yes | yes | yes |
| `User` folder | **no** (only `Azure Accounts`) | yes | yes |
| `session-store.db` | no | yes | no |
| Classic sessions (`agent_name = 'GitHub Copilot Chat'`) | 0 | 115 (627 turns) | 0 |
| `agent-traces.db` | no | yes | no |
| `User/settings.json` | no | yes | no |
| Workspace storage folders | 0 | 108 | 1 |
| Debug-log folders holding sessions | 0 | 29 | 0 |
| Session folders under debug-logs / with `main.jsonl` | 0 / 0 | 260 / 259 | 0 / 0 |
| Classic sessions with a debug-log folder | 0 | 115 of 115 | 0 |
| Agent Host catalog | no | yes: 109 `copilotcli` rows, 11 of them with a URI form other than `copilotcli:/<uuid>` | no |
| `agentSessionData` folders | n/a | 977 | n/a |

- Shared Copilot home: 101 `~/.copilot/session-state` folders.
- Id overlaps between variants: 0 classic, 0 debug-log, 0 Agent Host, 0 classic-vs-Agent-Host. Classic ids are all UUIDs.
- Other forks (`Code - OSS`, `VSCodium`, `Cursor`, `Windsurf`): none present. `code` (Stable CLI) is not on the PATH; `code-insiders` is.
- Product today (installed MCP server, `get_cost_rollup provider=vscode limit=500`): 178 sessions (115 classic, 63 Agent Host), 785 turns, 14,207.88 billed AI Credits known on 566 of 785 turns. All from Insiders.

Findings:

1. **Stable has no Copilot data on this machine.** `~/.config/Code` is a leftover folder without `User`. The both-installed case cannot be verified here until Stable is installed and used (VB0b, D9).
2. `resolveUserDataDir()` accepts a folder without `User`. Had Insiders been absent, the app would have picked the leftover Stable folder and shown "no sessions". The root rule in §5.2 fixes this class (D10).
3. VS Code Server holds a Copilot Chat globalStorage folder but no sessions here; out of 1.0 (D5).
4. 11 of 109 Agent Host catalog rows use another URI form and are skipped by the reader, as today; no change proposed.

VB0b (owner step, then rerun): install VS Code Stable here, sign in to Copilot, run one classic Agent-mode chat and one Agent Host chat, then rerun the spike. It must report per-variant counts, id overlaps, and whether one Copilot CLI session id appears in both catalogs (§3.3).

## 5. Design

### 5.1 One provider over N roots (D1)

Recommendation: keep one provider, id `vscode`, built from one reader per user-data root.

- `VscodeRootReader` = today's `VscodeLogProvider` logic for one root, unchanged apart from tagging its sessions with its variant. Single responsibility: one install's stores.
- `VscodeLogProvider` becomes the composite: it holds `VscodeRootReader[]`, merges lists, routes per-session reads by id, and answers availability as "any root available". It implements every capability interface the class implements today (`LogProvider`, `SystemPromptTextReader`, `RequestTraceReader`, `CacheBreakTraceReader`, and any other found in VB4), each by dispatching to the owning root.
- Open/closed: a new variant is a root, not a provider. Liskov: a one-root composite behaves exactly as today's provider; the existing provider tests run against it unchanged (VB4's contract test). Dependency inversion: the composition root hands it readers; it never resolves paths.
- The extension keeps building a one-root provider through `createVscodeProvider(paths)`; `composeCopilotProviders` does not change.

Why not one provider per variant (`vscode` and `vscode-insiders`): the meaning of `vscode` would differ by machine (Stable on a Stable-only machine, Insiders where both exist), so either existing ids on Stable-only machines get a new provider id (breaking insights keys, frozen statements, MCP calls with `provider: "vscode"`) or Insiders sessions do. The active-provider select would also show one variant at a time, and MA13 and every "VS Code" total would need to sum two providers.

### 5.2 Root discovery

- `listVscodeUserDataRoots({ platform, homeDir, env, exists })` in `platform/vscode-paths`: a fixed table `{ variant, folderName, label }` per OS (`insiders` "Code - Insiders" "VS Code Insiders"; `stable` "Code" "VS Code"), order Insiders then Stable.
- A root is present when `<folder>/User` exists (D10). A folder without `User` is skipped (spike finding 2).
- `resolveUserDataDir()` returns the first present root, keeping its single-root callers (dev script, tests) working with the same rule.
- Paths come only from the home dir, `APPDATA` and the fixed names; nothing from requests or settings.

### 5.3 Session ids (D2)

- Ids stay bare for every variant: `/api/sessions/<uuid>`, `get_session_cost { sessionId }`, insights `vscode:<uuid>` all keep working, and on a both-installed machine every id the app showed before (Insiders) is unchanged.
- The composite builds an id → root index on each `listSessions` and resolves `readSession` and the other per-id reads through it; on an index miss it tries each root in order (a session created after the last list).
- Collision (the same bare id in two roots, not Agent Host): the first root in order keeps the bare id; the later root's session is listed as `<id>~<variant>` (for example `…~stable`). `~` is URL-unreserved, so URLs need no encoding change, and it is not `:` (the insights key separator). The composite strips a known suffix before handing the bare id to that root's reader; an unknown suffix is an unknown session.
- Agent Host duplicate (D3): the same Copilot CLI session id in both catalogs is one session, listed once from the root whose catalog row was modified last and tagged with that variant, because its AI Credits come from the one shared event log.

### 5.4 Variant tag

- Domain: `vscodeVariantSchema = z.enum(["stable", "insiders"])`; `Session.vscodeVariant?` (VS Code sessions only, like `copilotHarness`); fixed labels "VS Code" and "VS Code Insiders" in one domain module, shared by the web UI, MCP and MA13.
- The extension leaves it unset (it shows one variant).
- Web UI (D4): when sessions of two variants are present, each VS Code session row and the session header show a small text badge ("Stable" or "Insiders"), and the session list gets a "VS Code variant" select (All, VS Code, VS Code Insiders). With one variant, neither shows. Words, not colour; accessible name "VS Code Insiders session".
- Provider status (`GET /api/log-providers`, `list_log_providers`): the `vscode` descriptor gains `variants`: the labels of present roots, so "why is Stable missing?" has an answer.

### 5.5 What changes in each feature

Every aggregate reads `registry.getProvider("vscode").listSessions()` or the dataset built from it, so most features need no code change, only tests that prove both variants are counted.

| Feature | Change |
|---|---|
| Session list, session detail, turn inspector | Both variants listed; badge and filter (§5.4); per-id reads routed by the composite |
| Dashboard and cost over time | Totals include both; `byProvider` keeps one `vscode` row. No variant split in 1.0 (D4) |
| Cost by repository and project | None in code: attribution is per session (working folder, remote); Stable sessions gain attribution and may add repositories to the list |
| Statements | Drafts include both. A statement frozen before C16 keeps its figures; its re-run diff shows the Stable sessions as added, exactly as late logs (cost-by-repository-and-project.md §8.5). User Guide note (D11) |
| Estimates | Include both (they read the same cubes) |
| Savings report | Includes both; `sessionsLeftOut` stays per provider |
| Tool-call audit, findings, insights | Include both; keys `vscode:<id>` unique by §5.3 |
| Replay and compare | Per-id reads routed to the owning root's request trace |
| Allowance (MA13) | Sums both variants: MA13's D5 option (c) becomes the 1.0 behaviour. `source.variant` becomes `source.variants` (labels), and the details gain a by-variant split (D8) |
| Learn mode | None |

### 5.6 Performance

- Listing reads every classic session's `main.jsonl` for its AI Credits, so time grows with the session count. Roots are listed concurrently (`Promise.all`).
- Budget (VB11): on a fixture with N sessions per root, a two-root list takes at most 1.2 × (the sum of the two one-root lists); on the owner's data, `GET /api/sessions` stays within 1.2 × today's time plus the Stable root's own list time.
- Any cache keyed by session id or path (VB4 lists them) is keyed by root as well.

### 5.7 Settings check per variant (D6)

- `checkConfig` runs once per present root that holds Copilot Chat data (`User/globalStorage/github.copilot-chat` exists), with that root's `settings.json` and Agent Host probe. With no such root, it runs once for the first present root, as today.
- `ConfigWarning` gains `variant?`; each message starts with the label ("VS Code: file logging is off …"); fix steps name that variant's `settings.json`.
- `server.ts` startup prints warnings grouped by variant; `GET /api/config/status` returns all of them.
- The extension's check is unchanged (one root, no variant).

### 5.8 MCP (D7)

- `provider: "vscode"` keeps meaning "VS Code Copilot sessions", now from both variants. No new argument.
- `list_sessions` and the session summaries of `get_session_cost` and `get_session_audit` add `vscodeVariant` when set. `list_log_providers` adds the `variants` list. Output schemas and `tool-list-standalone.json` snapshot updated; tool count unchanged.
- `mcp-identity.ts` instructions gain one sentence: "VS Code sessions come from VS Code and VS Code Insiders on this machine; vscodeVariant says which."
- The extension's MCP server is unchanged.

### 5.9 Extension unaffected

`copilotLogPathsFromUserDataDir(own)` → `composeCopilotProviders` → `createVscodeProvider(paths)` stays one root. VB4's one-root contract test and the extension's existing tests (unchanged) prove it.

## 6. Threat-model rows

Rows for [threat-model.md](../threat-model.md) §4 (task VB13, test names cited when written):

| Component | Threat | Finding to record |
|---|---|---|
| `platform/vscode-paths` root list | Reading outside VS Code's data | Two fixed roots per OS, built from the home dir, `APPDATA` and fixed folder names; a root needs a `User` folder; no input from requests, settings or the environment beyond `APPDATA`. Every store path below a root is built as today |
| Composite `vscode` provider, id routing | Path traversal through a crafted id or suffix (`../x~stable`, `x~../../`) | The suffix is matched against the fixed variant keys only; the remaining bare id goes to the root's reader, which keeps its checks (`agentSessionDbPath`'s id pattern; SQL parameters). Test: crafted ids return 404 and touch no file outside the roots |
| Second `settings.json` read by the settings check | Disclosure of settings | Read-only, the same keys as today; warnings carry the variant label and the fixed settings path shape, as today |
| Variant tag in UI and MCP | Leaking local paths to a model | Only the fixed labels "VS Code" and "VS Code Insiders"; no root path in any answer. Test in `mcp/security.test.ts` |
| Extension MCP child | Scope creep to the other variant | Unchanged: one `--user-data-dir`, checked as today |

## 7. UI checks (Playwright)

`packages/web/e2e/specs/vb-both-variants.spec.ts`, light and dark projects. Its fixture home seeds both `~/.config/Code` and `~/.config/Code - Insiders` (a separate fixture home or seeds added in the same task as the composite, because today's code would switch every existing spec to Insiders the moment an Insiders folder appears):

- The session list shows sessions of both variants, each with its badge; the accessible name names the variant.
- The variant select filters to VS Code only and to VS Code Insiders only, then back to All; counts match the fixture.
- Opening a Stable session and an Insiders session shows each one's turns (per-id routing).
- The Dashboard's AI Credits total equals the sum of both variants' fixture sessions.
- A fixture with one variant: no badge, no select.
- A colliding classic id in both fixture roots: two rows, the Stable one opens through its `~stable` id.
- The configuration banner lists a warning per variant, each naming its variant.
- MCP: `list_sessions` through `e2e/support/mcp-stdio.ts` returns both variants with `vscodeVariant`; `get_cost_rollup provider=vscode` equals the Dashboard total.
- axe passes on the session list with badges and the select; 320 px has no horizontal scroll.

## 8. Tasks

TDD in every code task: the failing test is written and seen red first ([CLAUDE.md](../../CLAUDE.md), architecture §11.4). No local model in this repo. The extension's tests stay unchanged in what they assert.

| ID | Task | Exit | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| VB0 | Read-only spike on the owner's machine (§4) | Done 2026-11-14: numbers in §4 | low | Opus | — |
| VB0b | Owner installs VS Code Stable, runs one classic and one Agent Host chat; spike rerun | §4 updated with per-variant counts, overlaps and the shared-CLI-session answer (D3) | low | Owner step, then Sonnet | D9 |
| VB1 | `listVscodeUserDataRoots` (fixed table, `User` required, order Insiders then Stable) on Linux, macOS, Windows; `resolveUserDataDir` = first present root | Unit tests per OS: none, one, both, a folder without `User`; existing `resolve-user-data-dir.test.ts` cases still pass or are updated with the D10 rule | low | Sonnet | D10 |
| VB2 | Domain: `vscodeVariantSchema`, labels, `Session.vscodeVariant?`, `ConfigWarning.variant?`, provider descriptor `variants?` | Domain schema tests; every package type-checks | low | Haiku | D1 |
| VB3 | `VscodeRootReader`: today's provider logic for one root with a `variant` option; tags classic and Agent Host sessions | Existing `vscode-log-provider.test.ts` green against the reader; new tag tests | medium | Sonnet | VB2 |
| VB4 | Composite `VscodeLogProvider` over readers: merged list, id index, collision suffix, Agent Host dedupe, availability, every capability interface routed; caches keyed by root | One-root contract test (the existing provider suite against a one-root composite, unchanged); two-root tests for list, every per-id read, collision, dedupe, crafted ids | high | Opus | VB3, D2, D3 |
| VB5 | Composition: `composeLogProviders` builds the composite from `listVscodeUserDataRoots`; `LogProviderCompositionOptions` accepts explicit roots for tests; `composeCopilotProviders` unchanged | `provider-factories.test.ts` two-root case; `create-standalone-api-service` tests; extension tests unchanged and green | medium | Sonnet | VB1, VB4 |
| VB6 | Settings check per variant (§5.7): `checkConfig` per root, labels, `server.ts` startup, `GET /api/config/status` | Tests: both roots with different settings give per-variant warnings; a root without Copilot data gives none; one root unchanged | medium | Sonnet | VB2, VB5, D6 |
| VB7 | Web: badge, variant select, session header (§5.4); mock-up board in `docs/plans/mockups/vscode-both-variants/` approved first | Component tests: two variants, one variant, filter; `a11y.test.tsx` axe pass | medium | Sonnet (frontend-design skill) + owner | VB2, D4 |
| VB8 | Playwright `vb-both-variants.spec.ts` and the two-root fixture home (§7) | Specs green in light and dark, locally and in CI; existing specs unchanged and green | medium | Sonnet | VB5, VB6, VB7 |
| VB9 | MCP: `vscodeVariant` in outputs, `variants` in `list_log_providers`, identity sentence, snapshot | `tool-list-contract.test.ts`, `stdio.test.ts`, `mcp/security.test.ts` (no path) green; two-root MCP test | medium | Sonnet | VB5, D7 |
| VB10 | MA13 alignment: `source.variants` and the by-variant split in the allowance answer and details (or MS4 builds it that way if it comes later) | Allowance tests with two roots; MA13 plan amended | low | Sonnet | VB5, D8; MS4 if built first |
| VB11 | Performance (§5.6) | Fixture budget met; owner-data timing recorded here | low | Sonnet | VB5 |
| VB12 | `REAL_DATA` check `variants-exit.real.test.mts` and `variants-oracle.mts`; npm script `test:real-data:variants`, added to `test:real-data` | §11 met on the owner's logs; owner signs off its output | high | Opus | VB0b, VB5, VB9 |
| VB13 | Threat-model rows (§6) | Rows written with test names | low | Haiku | VB4, VB9 |
| VB14 | Docs (§12); app CHANGELOG `[Unreleased]` | Each doc updated with its header; links resolve | low | Sonnet | VB7, VB9 |
| VB15 | Review: code review, full suite, `npm run headers:check`, `npm run lint`, the real-data run; Gantt updated | §11 met; one `main` commit per CLAUDE.md | medium | Opus | VB8, VB10, VB11, VB12, VB13, VB14 |

Parallelism: VB1 with VB2; VB7's mock-up with VB3 and VB4; VB9 with VB6 to VB8; VB12 once VB0b and VB9 land.

## 9. Owner decisions

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | Provider shape | (a) one `vscode` provider over N roots; (b) one provider per variant | **(a).** Keeps `vscode` meaning "VS Code Copilot" on every machine, every existing id and key, and MA13's single-provider read; a variant is a root, not a provider (§5.1). |
| D2 | Session ids | (a) bare for all, `<id>~<variant>` only for the later root on a collision; (b) always prefix the non-first variant; (c) always prefix both | **(a).** No existing id changes on any machine; collisions of UUIDs are not expected (0 in the spike). (b) changes Stable ids on Stable-only machines; (c) changes every id. |
| D3 | One Copilot CLI session in both Agent Host catalogs | (a) one session, from the root whose catalog row changed last; (b) list both | **(a).** Its AI Credits come from the one shared event log; (b) counts them twice. VB0b measures whether it happens. |
| D4 | UI | (a) badge and variant select in the session list, only when two variants have sessions; (b) also a per-variant split on the Dashboard; (c) no UI | **(a)** for 1.0. Totals combined; a Dashboard split later if asked. |
| D5 | Scope of roots | (a) Stable and Insiders; (b) also VS Code Server, Code - OSS, VSCodium, Cursor, portable, custom dirs | **(a).** No other source holds sessions on the owner's machine; Copilot Chat support in forks is unverified. The root table is data, so each later root is one row plus tests. |
| D6 | Settings check | (a) per root with Copilot Chat data; (b) the first root only (today); (c) every present root | **(a).** Warns where the user actually chats; (c) nags about a variant never used with Copilot. |
| D7 | MCP | (a) `vscodeVariant` in outputs, `variants` in `list_log_providers`, one identity sentence; (b) also a `variant` argument on `list_sessions` | **(a).** No schema-breaking argument; a model can filter on the field. |
| D8 | MA13 alignment | (a) the allowance sums both variants, `source.variants` plus a by-variant split; (b) MA13 stays on one variant | **(a).** One allowance pays for both; this is MA13 D5 (c), now in 1.0. Amend MA13's §4.6 before MS4 is built. |
| D9 | Where the real-data check runs | (a) install Stable on this Linux machine and use it for a few chats; (b) another machine that has both | **(a).** The other real-data checks already run here; Stable has no Copilot data here today (§4). |
| D10 | When is a root present? | (a) the folder has `User`; (b) the folder exists (today); (c) it has Copilot Chat data | **(a).** Skips leftovers like this machine's `~/.config/Code`; (c) would hide a fresh install from the settings check's "Copilot Chat unavailable" warning. |
| D11 | Statements frozen before C16 | (a) unchanged; the re-run diff shows Stable sessions as added; (b) re-issue automatically | **(a).** Frozen means frozen (cost-by-repository-and-project.md §8.5); the diff already explains late logs. |

## 10. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| No Stable Copilot data on the owner's machine today | C16 cannot be verified on real data | VB0b (D9) before VB12; fixtures cover both roots meanwhile. **Biggest risk.** |
| One Copilot CLI session in both catalogs | AI Credits counted twice | D3 dedupe; VB0b measures it; oracle counts by CLI session id |
| The composite misses a capability interface or a per-id path | A Stable session opens empty or 404s | VB4 lists every interface and per-id method; two-root tests for each; Playwright opens a session of each variant |
| Existing e2e specs switch to Insiders when an Insiders fixture appears | Unrelated spec failures | Separate fixture home or seeds added with the composite (§7) |
| Listing both roots slows the session list | Slower first load | Concurrent roots; VB11 budget |
| Frozen statements differ from new drafts | User confusion | The re-run diff (D11); User Guide note |
| macOS and Windows candidate paths still unverified on real installs (architecture §6.2.2) | A variant missed off Linux | Unchanged from today; the root table is unit-tested per OS |
| MA13 builds the single-variant answer first | Rework | D8: amend MA13 §4.6 now; VB10 otherwise |

## 11. Exit criterion

With Stable and Insiders both holding Copilot sessions, the standalone app and its stdio MCP server list both variants' sessions in the `vscode` provider, each tagged with its variant, every total includes both, existing ids still resolve, the settings check names each variant's warnings, the extension's tests pass unchanged, and these automated checks pass:

- Unit and component tests of VB1 to VB10, and the full suite.
- **Playwright** `vb-both-variants.spec.ts` (§7), light and dark.
- **`npm run test:real-data:variants`** on the owner's logs:
  - The oracle (`variants-oracle.mts`) shares no code with the product. It enumerates `~/.config/Code` and `~/.config/Code - Insiders` itself, opens each store read-only and counts per variant: classic sessions (`sessions` rows with `agent_name = 'GitHub Copilot Chat'`), Agent Host sessions (`sessions_v2` rows of provider `copilotcli` with a `copilotcli:/` URI, minus tombstones, with the product's empty-store rule restated), and billed AI Credits from raw `main.jsonl` (classic, with subagent logs through the SA18 scanners) and `events.jsonl` (Agent Host, through the V3 oracle's reader), each session known or unknown as a whole.
  - Per variant: the app's session count (`GET /api/sessions` grouped by `vscodeVariant`) and MCP `list_sessions` equal the oracle's exactly; the sum of known AI Credits is within 0.01 of the oracle's; known and total counts exact.
  - Together: `get_cost_rollup provider=vscode` and the Dashboard total equal the oracle's two-variant sum within 0.01, with a Copilot CLI session in both catalogs counted once.
  - Every id the app listed before the change (a saved list from the one-root build) still resolves to the same session.
  - Output carries ids, variant labels, dates, counts and sums only, never titles, prompts or paths. The owner signs off the output.
- Threat-model rows written; docs updated; the owner approved the mock-up board.

## 12. Docs to update

Task VB14 unless noted; each with its header date:

- [architecture.md](../architecture.md): §4 `platform/vscode-paths` row; §6.2.2's `<user-data-dir>` paragraph (both roots, `User` rule, composite provider); §6.2.2.1 (Agent Host per root, shared Copilot home, dedupe); §6.3 (settings check per variant); §13's multi-variant open question (variants resolved; profiles, forks and remote still open).
- [standalone-app.md](../standalone-app.md): the store and `settings.json` locations (both variants read, no fallback).
- [UserGuide.md](../UserGuide.md): the variant badge and select; totals include both; frozen statements and the re-run diff; the allowance counts both.
- [threat-model.md](../threat-model.md) §4: §6's rows (VB13).
- [monthly-allowance-standalone.md](monthly-allowance-standalone.md): §4.4, §4.6, D5 and the risk row, per D8 (VB10).
- The root `CHANGELOG.md` (the app's) `[Unreleased]`: "The app reads VS Code and VS Code Insiders together".
- implementation-plan.md (C16 row and build tasks), the Gantt and docs/README.md: the main session, not this task.
