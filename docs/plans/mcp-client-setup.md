# MCP client setup for the standalone app (Phase 18)

**Last changed:** 2026-11-18 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **Approved 2026-11-18** (owner interview, D1-D12 in §8). MC0-MC9
and MC19 done 2026-11-18 (MC8 signed off by the owner). Before Increment 1's
release: MC20 (VS Code Insiders, D14) and MC21 (review findings R5 and R6,
D15). Testing is Linux only (D13).

Phase 18 in [implementation-plan.md](../implementation-plan.md#phase-18--mcp-client-setup-for-the-standalone-app).
Task IDs are `MC0`-`MC21` (§10).

## 1. Why

The npm package already serves the MCP server (`npx agent-cost-analyzer
mcp`, [npm-package.md](npm-package.md)). Registering it with an MCP client
is still manual:

- The User Guide gives one `claude mcp add …` line
  ([UserGuide.md](../UserGuide.md#querying-the-audit-from-claude-code-mcp)).
  Users of every other client translate it into that client's JSON shape
  and file path themselves.
- On Windows the user has to know to wrap it in `cmd /c` for clients that do
  not resolve `.cmd` files.
- Nothing in the app or its terminal output says the MCP server exists.

The VS Code extension does not have this gap: it registers its own server
through `vscode.lm.registerMcpServerDefinitionProvider`
(`aiCreditsAnalyzer.mcp`).

## 2. Goals and non-goals

Goals:

- One command registers the server with each client the user picks:
  `npx agent-cost-analyzer mcp install`.
- One command removes it again, and one shows where it is registered.
- The app tells users the MCP server exists: in the terminal at start,
  and in a "Connect an agent" panel in the web app.
- Users can also find and install it through each client's own
  channels: the official MCP Registry, a Claude Desktop bundle (`.mcpb`)
  and a Claude Code plugin.

Non-goals:

- **No `postinstall` or other npm install script** (§4, option F). The
  package keeps "no dependencies and no install scripts"
  ([npm-package.md](npm-package.md) §2).
- **The local server and web app write no client config.** No HTTP route
  writes files. The web panel only shows commands and client install links
  (§5.6, threat model).
- No remote (HTTP) MCP transport. The server stays stdio only.
- No MCP setup inside the VS Code extension. It already registers the
  server.
- No editing of JSONC or TOML config files in Increment 1 (Zed, Codex
  files). Clients with their own `mcp add` CLI are driven through that CLI
  instead (§5.3).

## 3. What exists

Read on `main` at `f7793274`.

| Area | Today | Source |
|---|---|---|
| CLI commands | `agent-cost-analyzer [--port] [--no-open]`, `mcp [--project-billing-details] [--app-views-html <path>]`, `--help`, `--version`. `mcp` rejects any argument other than its two flags. | `packages/cli/src/args.ts`, `usage.ts` |
| MCP entry | `cli.ts` → `serveStandaloneMcpStdio({ layout, … })`. stdout carries JSON-RPC only. | `packages/cli/src/cli.ts`, `packages/server/src/mcp/standalone-mcp-server.ts` |
| Documented registration | `claude mcp add agent-cost-analyzer -- npx -y --prefer-offline agent-cost-analyzer mcp`, plus a `cmd /c` note for Windows and a note on pinning through a global install | `docs/UserGuide.md` §"Querying the audit from Claude Code (MCP)", `docs/standalone-app.md` |
| Package | `agent-cost-analyzer` 1.0.0, `bin` only, zero dependencies, Node ≥ 22.18. The alias `agent-cost-analyser` points to it. | `packages/cli/package.json`, `packages/cli-alias` |
| CI smoke | Runs from the packed tarball on Linux, macOS and Windows. It fails on any change in the fixture home outside the app's settings folder. | `packages/cli/smoke/`, `smoke-home.test.ts` |
| Extension | Registers `aiCreditsAnalyzer.mcp` with VS Code. Not affected by this plan. | `packages/vscode-extension/src/vscode/vscode-mcp-server-definitions.ts` |
| Threat model | The standalone MCP server row (§4) and the `agent-cost-analyzer` bin row. The bin row's guarantee: no write outside the settings folder. | `docs/threat-model.md` |

### 3.1 Client facts (checked 2026-11-18)

Checked against each client's docs on 2026-11-18, then by MC0 (§3.2).
**Unconfirmed** marks a fact that the named task checks before code
depends on it.

| Client | How to register | Config file and shape | Source |
|---|---|---|---|
| Claude Code | `claude mcp add [--scope local\|project\|user] <name> -- <cmd> [args…]`; `claude mcp remove <name> [--scope]`; `claude mcp get <name>` (starts the server to check it); `claude mcp add-json <name> '<inner json>'`. No login needed. A name that exists exits 1 with "already exists"; removing a missing name exits 1. | `~/.claude.json` (local and user scopes; user scope is the top-level `mcpServers`); `.mcp.json` at the project root (project scope). Entry: `{"type":"stdio","command","args","env":{}}` | code.claude.com/docs/en/mcp; MC0 |
| Claude Desktop | Edit the file, then restart Claude Desktop | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows `%APPDATA%\Claude\claude_desktop_config.json`; Linux `~/.config/Claude/claude_desktop_config.json` (as documented). Shape: `{"mcpServers":{name:{command,args,env}}}`. The file also holds Claude Desktop's own settings (`preferences` and others). | modelcontextprotocol.io/docs/develop/connect-local-servers; MC0 |
| Claude Desktop bundle | `.mcpb` (formerly DXT). `manifest.json` with `manifest_version: "0.3"`, `server.type: "node"`, `entry_point`, `mcp_config`; `mcp_config.args` may hold extra arguments after the entry point. The bundle ships the server. Packed with `@anthropic-ai/mcpb` 2.1.2. Whether it has a `validate` command is unconfirmed (MC15). | — | github.com/modelcontextprotocol/mcpb MANIFEST.md; MC0 |
| VS Code | `code --add-mcp '{"name","type":"stdio","command","args"}'` adds to the user profile (not used by `mcp install`: §5.3). There is no command to remove a server. The `vscode:mcp/install?` URL is not in the official docs. | User `mcp.json`, top-level `servers`: Linux `~/.config/Code/User/mcp.json`, macOS `~/Library/Application Support/Code/User/mcp.json`, Windows `%APPDATA%\Code\User\mcp.json` (third-party sources; the docs name only the "MCP: Open User Configuration" command; unconfirmed, MC8). The `servers` format is labeled deprecated in favor of Copilot's `mcpServers` in `.mcp.json` or `~/.copilot/mcp-config.json`. | code.visualstudio.com/docs/agents/reference/mcp-configuration; MC0 |
| Cursor | Edit the file. Install link `cursor://anysphere.cursor-deeplink/mcp/install?name=<name>&config=<config>`, where `config` is the base64 of the inner server JSON (`{"command","args"}`), percent-encoded. | `~/.cursor/mcp.json`, project `.cursor/mcp.json`, `{"mcpServers":{…}}` | cursor.com/docs/context/mcp, cursor.com/docs/mcp/install-links; MC0 |
| Codex CLI | `codex mcp add <name> -- <cmd> [args…]`; `codex mcp list`. The docs show no `remove`. What `add` does with a name that exists is undocumented. | `~/.codex/config.toml`, `[mcp_servers.<name>]` | OpenAI Codex docs; MC0 |
| Gemini CLI | `gemini mcp add [-s user\|project] <name> <cmd> [args…]` (default scope: project); `gemini mcp remove -s <scope> <name>`. What `add` does with a name that exists is undocumented. | `~/.gemini/settings.json`, `mcpServers` | geminicli.com/docs/tools/mcp-server; MC0 |
| MCP Registry | `mcpName: "io.github.<user>/<name>"` in `package.json`; `server.json` with `packages[{registryType:"npm", identifier, version, transport:{type:"stdio"}}]`; `mcp-publisher login github-oidc` from Actions (`id-token: write`). The `mcp` subcommand: `packageArguments: [{"type":"positional","value":"mcp"}]`. Schema `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`. The registry checks `mcpName` in the published npm version; 1.0.0 has none. | — | modelcontextprotocol.io/registry/quickstart, /registry/github-actions; MC0 |
| Claude Code plugin | A plugin root with `.claude-plugin/plugin.json` and `.mcp.json`. A repository marketplace has `.claude-plugin/marketplace.json`. Users run `/plugin marketplace add raulkivi/agent-cost-analyzer`, then `/plugin install <name>@<marketplace>`. `claude plugin validate <dir>` runs without login: `plugin.json` needs only `name`; `marketplace.json` needs `name`, `owner.name` and `plugins[].source`. | — | code.claude.com/docs/en/plugins-reference; MC0 |
| npm scripts | npm 12 (2026) no longer runs dependency install scripts unless the project allows them. pnpm 10+ blocks them by default. | — | github.blog changelog 2026-06-09; pnpm.io/settings/build |

### 3.2 MC0 results (2026-11-18)

Claude Code was run with a throwaway home on Linux; no other client CLI is
installed on the owner's machine, so their rows rest on their docs.

- **Windows `cmd /c`:** only Claude Code's docs ask for `cmd /c npx` on
  native Windows, and an April 2026 issue says Claude Code 2.1.119 dropped
  that warning. Claude Desktop, Cursor, VS Code, Codex and Gemini document
  plain `npx`. §5.2 follows this.
- **Duplicates:** Claude Code refuses a name that exists; Codex and Gemini
  do not document it. Adapters read the client's config, or its `list`
  command, before `add` (§5.3).
- **Removal:** Claude Code and Gemini have a remove command; VS Code and
  Codex do not (§5.3).
- **Registry:** the first registry publish needs an npm release that carries
  `mcpName`, so Increment 1's release adds it (MC19).
- **Not checked on a real install:** VS Code (the user `mcp.json` path,
  the extension check), Codex and Gemini. MC4's tests use
  the documented shapes; MC8 checks VS Code on a machine that has it.

## 4. Options considered

| | Option | Verdict |
|---|---|---|
| A | `mcp install` / `uninstall` / `status`: detects clients and registers through each client's CLI or a JSON merge with a backup | **Recommended (Increment 1).** One command for every client, opt-in, reversible. |
| B | `mcp config --client X`: prints the snippet or command and writes nothing | **Recommended (Increment 1).** Option A reuses the same pure code, and it is the safe fallback for any client A cannot write. |
| C | A start-up hint line, plus a web "Connect an agent" panel with copy buttons and client install links | **Recommended (hint in Increment 1, panel in Increment 2).** The web panel never writes files. |
| D | A Claude Desktop `.mcpb` bundle and a Claude Code plugin with a marketplace in this repository | **Recommended (Increment 3).** One-click install for the two Claude clients. |
| E | Publish to the official MCP Registry | **Recommended (Increment 3).** Clients that read the registry can then find the server. |
| F | An npm `postinstall` that registers the server | **Rejected.** npx and npm 12 do not run it reliably, pnpm blocks it, and `--ignore-scripts` skips it. It writes outside the package without being asked, which is the pattern supply-chain scanners flag. It also breaks the package's no-install-scripts promise. |

## 5. Design

### 5.1 Commands

```text
agent-cost-analyzer mcp                       # unchanged: run the server on stdio
agent-cost-analyzer mcp config  --client <id> [--pin] [--project-billing-details]
agent-cost-analyzer mcp install [--client <id>[,<id>…]|all] [--scope user|project]
                                [--pin] [--project-billing-details] [--dry-run] [--yes]
agent-cost-analyzer mcp uninstall [--client …] [--scope …] [--dry-run] [--yes]
agent-cost-analyzer mcp status
```

- `mcp` with no positional argument keeps today's behavior, so existing
  registrations (`… agent-cost-analyzer mcp`) do not change.
- `config` prints to stdout and exits.
- `install` with no `--client` lists the clients it detected and asks which
  ones to register. When stdin is not a TTY it requires `--client` and does
  not prompt.
- A client named with `--client` that is not detected gets its `mcp config`
  snippet printed and nothing written.
- Before changing anything, `install` prints each planned action ("add
  `agent-cost-analyzer` to ~/.cursor/mcp.json"). It applies them only after
  the user confirms or passes `--yes`. `--dry-run` prints the plan and
  stops.
- `status` reads each client's config and prints one line per client:
  `registered (npx, latest)`, `registered (pinned 1.0.0)`, `not registered`
  or `not detected`. It writes nothing.
- Exit codes: 0 success; 1 an action failed, with the client named; 2 a
  usage error.

### 5.2 Launch specification (pure)

`McpLaunchSpec` is built from the version, the platform and the flags.
It holds no I/O.

- Default: `npx -y --prefer-offline agent-cost-analyzer mcp`.
- `--pin`: `npx -y --prefer-offline agent-cost-analyzer@<running version> mcp`.
- `--project-billing-details` is appended after `mcp`.
- On Windows, the `claude-code` adapter writes `cmd` with `["/c", "npx", …]`,
  as Claude Code's docs ask; that note may be stale (§3.2), so it is a
  per-adapter flag. Every other client gets plain `npx`.
- The server name is always `agent-cost-analyzer` (D5).

### 5.3 Client adapters (open for extension)

`McpClientTarget` is the interface each client implements. Each adapter
gets its ports injected (DIP):

- `id`, `label`
- `detect(env)`: whether the client is installed (its CLI is on `PATH`, or
  its config folder exists)
- `plan(spec, scope)`: a list of `SetupAction`s
- `readStatus(env)`

Each `SetupAction` is one of two kinds:

- `RunCommand {file, args}`: run through an injected `CommandRunner` with
  `execFile`, never a shell.
- `MergeJsonEntry {path, keyPath, name, entry}`: applied by an injected
  `ConfigFileStore`.

Increment 1 adapters:

| id | Mechanism | Scopes |
|---|---|---|
| `claude-code` | Status read from `~/.claude.json` or `.mcp.json` (never `claude mcp get`, which starts the server). `RunCommand claude mcp add --scope <s> agent-cost-analyzer -- <spec>`; a changed entry is replaced by `claude mcp remove` then `add`, after confirmation; uninstall with `claude mcp remove` | user (default), project, local |
| `claude-desktop` | `MergeJsonEntry` into `claude_desktop_config.json` under `mcpServers` | user |
| `cursor` | `MergeJsonEntry` into `~/.cursor/mcp.json` or `.cursor/mcp.json` under `mcpServers` | user, project |
| `vscode` | `MergeJsonEntry` into the user `mcp.json` under `servers`; uninstall removes the key (§5.4). Not `code --add-mcp`: on Windows its JSON argument would have to pass through `cmd.exe`. A file with comments is refused and the user is told to use "MCP: Open User Configuration". Skipped, with status "provided by the AI Credits Analyzer extension", when `~/.vscode/extensions` holds a `raulkivi.ai-credits-analyzer-*` folder (D6; found without running `code`). | user |
| `codex` | Checks `codex mcp list` before `add`. `RunCommand codex mcp add agent-cost-analyzer -- <spec>`. No remove command and no TOML editing (§2): uninstall prints the `[mcp_servers.agent-cost-analyzer]` table to delete from `~/.codex/config.toml`. | user |
| `gemini` | Checks `gemini mcp list` before `add`. `RunCommand gemini mcp add -s <s> agent-cost-analyzer <spec>` (always passes `-s`, since the default is project); uninstall with `gemini mcp remove -s <s>` | user, project |

A new client means a new adapter and its tests. The command code does not
change.

### 5.4 Writing a JSON config safely

`ConfigFileStore.merge`:

- **The file does not exist:** create it, along with its parent folder,
  holding only this entry.
- **The file is not valid JSON:** stop and change nothing. The message
  names the file and gives the `mcp config` snippet to paste by hand.
- **An entry with the same name and the same content exists:** do nothing
  and report "already registered".
- **An entry with the same name but different content exists:** stop,
  unless the user confirms or passes `--yes`. The message shows both
  versions.
- **Before any change:** copy the file to
  `<file>.agent-cost-analyzer.bak` (overwriting an earlier backup). Write
  through a temporary file in the same folder, then rename it over the
  original. Keep the file's mode.
- **What is preserved:** every other key and server, in its original order.
  Indentation is detected from the file. Comments are not supported (§2).
- **Uninstall:** removes only the `agent-cost-analyzer` key. When that
  leaves `mcpServers` empty, the empty object stays.

### 5.5 Start-up hint

`agent-cost-analyzer` (serve) prints one more line after the start line:
`MCP: npx agent-cost-analyzer mcp install`. The hint is not printed when
`--no-open` is set or stdout is not a TTY, so scripts that read the first
line keep working. The setup prompt in `standalone-app.md` reads the first
line.

### 5.6 Web panel: "Connect an agent" (Increment 2)

- **API:** `GET /api/mcp/setup` returns the launch spec and one entry per
  client: the snippet, the command, and an install link where the client has
  one (Cursor; VS Code only if MC8 confirms its URL, §9). It is read-only,
  computed from the version and the server's OS, and goes through the
  existing Host guard.
- **UI:** a header button opens a dialog with one tab per client: copy
  buttons, the install link where one exists, and the `mcp install` command.
  It is standalone app only, so the VS Code panel never shows it.
- **No route writes a client config.** A loopback route that writes files
  would be a target for DNS rebinding or a page in another tab. The
  terminal command is the only writer.
- **Before code:** a mock-up board, approved by the owner (MC9).

### 5.7 Distribution channels (Increment 3)

- **MCP Registry.**
  - Add `"mcpName": "io.github.raulkivi/agent-cost-analyzer"` to
    `packages/cli/package.json`.
  - Add `packages/cli/server.json`, versioned with the package.
    `release-check.mts` checks that the versions match.
  - In `release-app.yml`, after the npm publish: `mcp-publisher login
    github-oidc` and `publish`, with the publisher binary pinned and verified
    by its checksum or cosign.
  - `server.json` passes the subcommand as
    `packageArguments: [{"type":"positional","value":"mcp"}]`, against the
    2025-12-11 schema.
  - The registry checks `mcpName` in the published npm version, so
    `mcpName` ships in Increment 1's release (MC19), before the first
    registry publish.
- **`.mcpb` bundle.**
  - Built from the CLI's `dist/` (already a zero-dependency bundle) with a
    `manifest.json`: `manifest_version: "0.3"`, `server.type: "node"`, entry
    `dist/cli.js`, `mcp_config.args: ["${__dirname}/dist/cli.js", "mcp"]`,
    `compatibility.runtimes.node: ">=22.18"`.
  - Packed with `@anthropic-ai/mcpb` 2.1.2, a pinned dev dependency.
  - Attached to the `app-v*` GitHub Release. CI validates the manifest and
    starts the bundled server, which must answer `tools/list`.
- **Claude Code plugin.**
  - The plugin lives in `plugins/agent-cost-analyzer/`: `plugin.json`, plus
    a `.mcp.json` with the npx launch spec.
  - `.claude-plugin/marketplace.json` at the repository root lists it.
  - CI installs a pinned Claude Code CLI and runs `claude plugin validate`
    on the plugin and on the marketplace; neither needs a login.
    `marketplace.json` carries `owner.name`.

### 5.8 Module placement

| Module | Package | Why there |
|---|---|---|
| `McpLaunchSpec`, client snippet builders (pure) | `packages/server/src/mcp/client-setup/` | Both the CLI (bundled through a relative import, as `stdio-args.ts` is) and `GET /api/mcp/setup` use them |
| Adapters, `ConfigFileStore`, `CommandRunner`, client detection, `install`/`uninstall`/`status` commands | `packages/cli/src/mcp-setup/` | Only the terminal writes |
| Panel | `packages/web/src/components/mcp-setup/` | Standalone app only |
| Bundle and plugin build | `packages/cli/scripts/`, `plugins/`, `.claude-plugin/` | Release assets |

### 5.9 Docs that change

- **Scope rule** (D1): [vision.md](../vision.md) §6, [architecture.md](../architecture.md)
  §2 and §4.1, and [threat-model.md](../threat-model.md): the bin row's "no
  write outside the settings folder" gains the exception "except
  `mcp install`/`uninstall`, at the paths it prints first".
- **New threat-model row:** `mcp install` (§6).
- **User Guide MCP section:** `mcp install` comes first, and the
  hand-written commands become the fallback.
- **Also:** `standalone-app.md`, the root README's quick start (one line),
  and the `[Unreleased]` section of `CHANGELOG.md`.

## 6. Threat model

| Threat | Mitigation |
|---|---|
| Clobbering a user's config (other servers lost, invalid JSON written) | Merge only the named key. Refuse files that are not valid JSON. Backup, atomic rename, mode kept. Tests over fixtures with other servers and odd formatting. |
| Command injection through the client CLIs | `execFile` with an argument array and no shell. Arguments come from `McpLaunchSpec` only; no user text reaches them except the enum `--client` and `--scope` values. On Windows, npm's `.cmd` launchers (claude, codex, gemini) cannot be started without `cmd.exe`, so the runner uses `cmd.exe /d /s /c` only when every argument matches `[A-Za-z0-9@._:/=+,-]+`, and refuses otherwise (MC5). |
| Writing somewhere the user did not expect | The plan names every path and command before applying them. `--dry-run`; confirmation unless `--yes`. Paths come from documented per-OS locations and `os.homedir()`/`APPDATA`, never from config contents. |
| Replacing an entry the user customized | An entry that differs is not replaced without confirmation; the message shows both. |
| A web route used to write configs (DNS rebinding, cross-site) | No writing route exists. `GET /api/mcp/setup` is read-only and behind the Host guard. |
| Registry or bundle impersonation | `io.github.raulkivi` namespace through GitHub OIDC. The `.mcpb` bundle is built in CI from the same commit as the npm publish and attached to the owner-tagged release. |
| A pinned launch spec going stale | `status` shows "pinned <version>" next to the running version. |

## 7. Exit criterion and checks

Phase 18's exit criterion: on Linux, from the packed tarball, with a
temporary home:

1. `mcp install --client <id> --yes` writes what each client expects:
   - JSON-file clients (`claude-desktop`, `cursor`, `vscode`): the entry
     matches the §3.1 shape. Launching the written command and arguments with
     the MCP SDK's stdio client lists the server's tools.
   - CLI clients (`claude-code`, `codex`, `gemini`): a recording
     stub on `PATH` receives exactly the documented argument array.
2. `mcp uninstall` returns a pre-existing config file to its original bytes.
   A file the install created ends with `mcpServers` empty.
3. `status` reports each state correctly.

macOS and Windows are not tested (D13). Their config paths and the Windows
command runner are covered only by unit tests that inject the platform.
The existing `npm-package` CI job still runs the serve smoke on all three
runners; Phase 18 adds nothing to its macOS and Windows legs.
4. The serve smoke's home snapshot is unchanged: serving still writes
   nothing outside the settings folder.
5. Increment 2: a Playwright spec opens the panel, copies each snippet and
   checks the VS Code link.
6. Increment 3: `server.json` validates against the registry schema, the
   `.mcpb` bundle's server answers `tools/list`, and the plugin validates.
7. On the owner's machine (MC8, automated, not a checklist):
   `npm run test:real-clients:mcp-setup` runs `install` with real
   `claude` and `code` against a temporary home or profile, then checks
   `claude mcp get agent-cost-analyzer` and `code --list-mcp` (or its
   equivalent), then uninstalls.

## 8. Owner decisions

Answered by the owner in an interview on 2026-11-18. Every answer is the
recommended option.

| # | Decision | Answer |
|---|---|---|
| D1 | May the terminal write client configs? | Yes, but only `mcp install` and `mcp uninstall`, after showing the plan, with the safeguards in §5.4. The web app and local server never write. vision.md §6 and the threat model are amended (MC9). |
| D2 | Clients in Increment 1 | All six: Claude Code, Claude Desktop, Cursor, VS Code, Codex, Gemini CLI |
| D3 | Default launch spec | Latest through npx (`npx -y --prefer-offline agent-cost-analyzer mcp`). `--pin` writes the running version. |
| D4 | Default scope | User (every project) |
| D5 | Server name | `agent-cost-analyzer` |
| D6 | VS Code with the extension installed | Skip, with a message that the extension already provides the server |
| D7 | Start-up hint | One line, only when stdout is a TTY and not with `--no-open` |
| D8 | Increment 3 channels | All three: MCP Registry, `.mcpb` bundle, Claude Code plugin |
| D9 | Plugin and marketplace location | This repository: `plugins/agent-cost-analyzer/` and `.claude-plugin/marketplace.json` |
| D10 | A failed registry publish during a release | Warn without failing the run: a separate job after the npm publish, re-run later |
| D11 | Order and releases | Increment 1 ships in its own app minor release. Increments 2 and 3 follow in either order, each releasable on its own. |
| D12 | Plan approval | Approved; start with MC0 |
| D13 | Operating systems tested (owner, 2026-11-18) | Linux only: macOS and Windows cannot be tested. Their code paths stay, unit-tested with an injected platform; MC7, MC8 and the exit criterion run on Linux. |
| D14 | VS Code Insiders (owner, 2026-11-18; found by MC8: the owner's machine has only Insiders) | Support it before Increment 1's release (MC20) |
| D15 | Review findings R5 and R6 (owner, 2026-11-18) | Fix before Increment 1's release (MC21) |

## 9. Risks

- **Clients change their formats.** VS Code has already relabeled `servers`
  as deprecated. Mitigation: one adapter per client, MC0's checks, the
  real-client check (MC8), and `mcp config` as the fallback.
- **VS Code's install URL is undocumented.** The panel's VS Code tab shows
  the `code --add-mcp` command; the `vscode:mcp/install` link is added only
  if MC8 checks it in a real VS Code.
- **Clients not checked on a real install** (VS Code, Codex, Gemini): their
  adapters follow the docs; MC8 checks VS Code, and `mcp config` stays the
  fallback.
- **macOS and Windows are untested** (D13). The macOS and Windows config
  paths, `cmd /c` for Claude Code and the Windows command runner rest on the
  clients' docs and unit tests. A user report is the first real check.
- **Claude Desktop has no official Linux build.** The adapter writes the
  documented Linux path, and `detect` finds the folder only when it exists.
- **A client writes its config while `install` runs** (MC2). The store has
  no lock: a change the client makes between the read and the rename is
  lost. The backup holds the file as it was read. Windows may refuse the
  rename while a client holds the file open; the store then fails and
  leaves the original unchanged.
- **Hand-formatted JSON is normalized** (MC2): a file the store rewrites
  takes `JSON.stringify` style with its detected indent; `1.0` becomes `1`
  and duplicate keys collapse to the last one.
- **The registry is still in preview.** Increment 3 only. A failed registry
  publish warns without failing the release run (D10).

## 10. Tasks

TDD in every code task (architecture.md §11.4). No local model in this repo.
"Owner" marks steps that need the owner.

| ID | Task | Inc. | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| MC0 | Spike: on the owner's machine confirm the §3.1 unconfirmed facts (Cursor deep link, VS Code user `mcp.json` path and removal, which clients need `cmd /c`, registry `packageArguments`, `.mcpb` manifest version, `claude plugin validate` in CI). Record the results in §3.1. **Done 2026-11-18** (§3.2). | 1 | medium | Sonnet | Plan approved |
| MC1 | `McpLaunchSpec` and per-client snippet builders (pure), with table-driven tests per OS and flag. **Done 2026-11-18** (PR #431: `launch-spec.ts`, `client-setup.ts`, `toml.ts`) | 1 | low | Sonnet | MC0 |
| MC2 | `ConfigFileStore`: merge and remove, backup, atomic write, invalid-JSON refusal, indentation kept; tests over temporary folders. **Done 2026-11-18** (PR #432; residual risks in §9) | 1 | medium | Opus | — |
| MC3 | `McpClientTarget` interface and the `claude-code`, `claude-desktop`, `cursor` adapters with detection. **Done 2026-11-18** (PR #434) | 1 | medium | Sonnet | MC1, MC2 |
| MC4 | `vscode`, `codex` and `gemini` adapters; skip VS Code when the extension is present (D6). Check whether `gemini mcp add` needs `--` before the launch command so its parser does not take `-y` and `--prefer-offline` (MC1 builds it without). **Done 2026-11-18** (PR #436; no `--` needed: gemini-cli's `mcp add` sets yargs `unknown-options-as-args`) | 1 | medium | Sonnet | MC3 |
| MC5 | CLI: argument parsing for `config`, `install`, `uninstall` and `status`; plan printing, prompt and `--dry-run`/`--yes`; exit codes; `usage.ts`. **Done 2026-11-18** (PR #437) | 1 | medium | Sonnet | MC3 |
| MC6 | Start-up hint line (D7). **Done 2026-11-18** (PR #435) | 1 | low | Haiku | — |
| MC7 | Tarball smoke on Linux (D13): install, status and uninstall per client in a temporary home; JSON clients launched with the SDK stdio client; stub CLIs record argv; serve home snapshot unchanged. **Done 2026-11-18** (PR #439: `npm run smoke:mcp-setup`, on the `npm-package` job's Linux legs; it found that `install` printed a client's backup and notes under the previous client's "done" line, fixed in `change-command.ts`) | 1 | high | Opus | MC4, MC5 |
| MC8 | `npm run test:real-clients:mcp-setup` on the owner's machine with real `claude` and `code`. **Done 2026-11-18** (PR #440). The owner signed off its output 2026-11-18: Claude Code user, local and `--pin` connected; project scope pending Claude Code's folder approval, as expected; VS Code's file layout matched with `code-insiders`; Gemini, Codex and Claude Desktop skipped (not installed, or a GUI). | 1 | medium | Sonnet + owner run | MC7 |
| MC9 | Docs: User Guide, standalone-app.md, README, CHANGELOG; vision, architecture and threat-model amendments (D1); review of Increment 1. **Done 2026-11-18** (PR #441). Review in §11. | 1 | medium | Opus | MC7 |
| MC10 | Mock-up board for the "Connect an agent" panel; owner approves | 2 | low | Sonnet + owner | MC9 |
| MC11 | `GET /api/mcp/setup` (read-only) with route and Host-guard tests | 2 | low | Sonnet | MC1 |
| MC12 | The panel and its header button, with component tests | 2 | medium | Sonnet | MC10, MC11 |
| MC13 | Playwright spec: panel, copy buttons, install links, light and dark mode, axe | 2 | low | Sonnet | MC12 |
| MC14 | `mcpName`, `server.json`, the version check in `release-check.mts`, and the registry publish job in `release-app.yml` (OIDC, pinned publisher; a failure warns without failing the run, D10) | 3 | medium | Sonnet | MC0 |
| MC15 | `.mcpb` build script, manifest, CI validation and `tools/list` check, release asset | 3 | medium | Sonnet | MC0 |
| MC16 | Claude Code plugin and repository marketplace, with CI validation | 3 | low | Haiku | MC0 |
| MC17 | Increment 3 docs (User Guide install options) and a threat-model row for the release assets | 3 | low | Sonnet | MC14-MC16 |
| MC18 | Owner: the first release with registry, bundle and plugin; check that each one installs | 3 | low | Owner | MC17 |
| MC19 | `"mcpName": "io.github.raulkivi/agent-cost-analyzer"` in `packages/cli/package.json`, with a manifest test, so Increment 1's release carries it (§3.2). **Done 2026-11-18** (PR #430) | 1 | low | Haiku | — |
| MC20 | VS Code Insiders as its own client `vscode-insiders` (D14): detect `code-insiders` or its `Code - Insiders/User` folder, write `Code - Insiders/User/mcp.json` under `servers`, skip when `~/.vscode-insiders/extensions` holds the AI Credits Analyzer extension; MC7 smoke and MC8 check extended | 1 | low | Sonnet | MC9 |
| MC21 | Review findings R5 and R6 (D15): a registration's status carries the existing entry, the plan prints old and new in full, a remove-then-add whose add fails says the server is now unregistered and prints the old entry to restore; a symlinked project-scope config is refused | 1 | medium | Opus | MC9 |

Order: MC0 → MC1/MC2/MC19 (in parallel) → MC3 → MC4/MC5/MC6 → MC7 → MC8 →
MC9 closes Increment 1, which ships in its own app minor release (D11).
Increments 2 and 3 are independent of each other, and each can be released on its own.

## 11. Increment 1 review (MC9, 2026-11-18)

Read on `main` at `9a8eee95`: `packages/server/src/mcp/client-setup/`,
`packages/cli/src/mcp-setup/`, the CLI entry files (`args`, `usage`, `run`,
`cli`, `serve-command`, `serve-wiring`), `packages/cli/smoke/setup-*.mts`
and their tests, against §5.1-§5.5, §6 and D1-D13.

Nothing found breaks the core guarantees. No code path uses a shell: the
client CLIs run through `execFile` with an argument array, and every
argument is a fixed string, the semver-checked version or an enum flag
value. Writes go only to the printed config paths, their backups and
same-folder temporary files (`wx`, removed on failure). Modes are kept,
non-TTY runs need `--yes` and `--client`, and exit codes follow §5.1. One
real safety defect was found (R1, a link at the backup name) and fixed,
with two small exit-code and wording fixes. The rest are recorded.

| ID | File | Finding | Severity | Outcome |
|---|---|---|---|---|
| R1 | `config-file-store.ts` | The backup `copyFile` followed a link at `<file>.agent-cost-analyzer.bak`. In a project-scope install inside a cloned repository, a link committed beside `.cursor/mcp.json` received that file's bytes (attacker-written JSON) at any path the user can write, such as a shell startup file, through a relative `../..` link. | Medium | Fixed in this PR: the old backup is unlinked, then copied with `COPYFILE_EXCL`, which never follows a link. Test: "%s replaces a link at the backup path instead of writing through it". |
| R2 | `change-command.ts` | A config refused as unreadable (invalid JSON, comments, a key path that is not objects) printed the snippet and "Nothing to change." but exited 0, so a script with `--client … --yes` read success while nothing was registered. Uninstall did the same. | Low | Fixed in this PR: exit 1, as for a planning error. Test: "exits 1 when a requested client's config is unreadable". |
| R3 | `resolve-clients.ts` | `mcp uninstall` without a terminal and without `--client` said "mcp install without a terminal needs --client …". | Low | Fixed in this PR: the message names the subcommand. Test: "names uninstall in the usage error of an uninstall". |
| R4 | `serve-command.ts` | The doc comment still said stdout gets only the start line; MC6 added the hint as a second line. | Low | Fixed in this PR (comment only). |
| R5 | `describe.ts`, `print-plan.ts`, `cli-command-plans.ts` | §5.4 and §6 say a differing entry's message "shows both versions". The plan shows the launch kinds only ("differs: latest → pinned 1.0.0"; a command of the user's own reads "differs: differs → latest"). Claude Code and Gemini replace through their own `remove` then `add`, with no backup of ours, so the old command is not recoverable, and an `add` that fails after the `remove` leaves the client unregistered without saying so. | Medium | Recorded. Showing the existing command needs `RegistrationStatus` to carry it, which touches every adapter and about 20 test assertions. Owner decision: a follow-up task before Increment 2, or accept with the confirmation prompt as the safeguard. |
| R6 | `atomic-write.ts`, `config-file-store.ts` | Project scope follows links for the config itself. A `.cursor/mcp.json` committed as a link makes the merge land at the link's target: an existing JSON object file gains our entry, and a dangling link creates its target and parent folders. The content is ours, not an attacker's. The plan prints the link path, not the target. `mcp status --scope project` reads a linked `.mcp.json` or `.gemini/settings.json` with no size limit, so a link to `/dev/zero` hangs it. | Low | Recorded. Options: refuse links for project scope, or print the resolved target in the plan. Threat model residual (e). |
| R7 | `resolve-clients.ts` | §5.1: `install` without `--client` "asks which ones to register". It plans for every detected client and asks one `[y/N]`. The plan names each client, and `--client` narrows it. | Low | No change; the User Guide describes the actual behavior. |
| R8 | `codex-target.ts`, `gemini-target.ts` | §5.3: Codex and Gemini "check `codex mcp list` / `gemini mcp list` before `add`". The adapters read `config.toml` and `settings.json` instead, so planning runs no client process. | Info | No change: reading the file is safer than the plan's wording. |
| R9 | `status-command.ts` | §6 ("A pinned launch spec going stale"): `status` shows "pinned <version>" but not the running version beside it. A header line would change the output the MC7 smoke parses. | Low | Recorded for Increment 2: the panel can show both versions. |
| R10 | `codex-target.ts`, `gemini-target.ts`, `client-env.ts` | Codex and Gemini count as detected by their folder alone. Without the CLI on `PATH`, `install` plans `mcp add` and fails when it applies ("codex was not found on PATH", exit 1). An unreadable `~/.codex/config.toml` (permissions) reads as "not registered". A Gemini `settings.json` with comments is refused as unreadable, though `gemini mcp add` would handle it. | Low | Recorded; `mcp config` is the fallback. |
| R11 | `vscode-target.ts` | The extension check lists `~/.vscode/extensions` for `raulkivi.ai-credits-analyzer-*`. It does not cover a folder VS Code keeps for a while after an uninstall, Insiders, VSCodium, `.vscode-server` or `--extensions-dir`. While the extension is installed, `uninstall` also skips an entry written to `mcp.json` before. | Low | Recorded; MC8 checks a real VS Code. |
| R12 | `windows-command.ts` | `cmd.exe /d /s /c` without `/v:off`: a shim path that holds `!` would expand if delayed expansion is turned on in the registry. Arguments are limited to the safe set; the path is quoted, and `"` and `%` are refused. | Low | Recorded as a D13 residual (untested on Windows); threat model residual (a). |
| R13 | several | Dead or duplicated code. `ClientEntry.target` is optional and "not supported yet" is unreachable now that all six adapters exist; it is kept as the extension seam, and a test covers it. `CmdInvocation.verbatim` is never read. `ApplyResult` and `Step` repeat `CommandResult`. The scope is checked three times (parser, `clientSetup`, `requireScope`). `describe.ts` calls `provided-by-extension` and `registered-unverified` kinds "a newer adapter may add", though both are in the union. | Info | No change: harmless, and the scope checks are deliberate defense in depth. |

Docs updated in the same PR (§5.9): the User Guide's MCP section, standalone-app.md, the root
README, vision.md §6, architecture.md §2 (constraint 7) and §4.1, and
threat-model.md (the bin row, a new `mcp install`/`uninstall` row, the
browser-opener and §8 CI rows). The CHANGELOG `[Unreleased]` entry already
matches the code.
