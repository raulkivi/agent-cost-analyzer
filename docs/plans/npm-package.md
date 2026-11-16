# npm package for the standalone app (1.0 criterion C8)

**Last changed:** 2026-11-16 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Status: **Done 2026-11-15.** App 0.16.0 is the first version on npm (`npx agent-cost-analyzer`), published by `release-app.yml` through npm trusted publishing with SLSA v1 provenance (Sigstore log index 3911991934; release run 43768131439). Exit criterion (§8) met: the `npm-package` job passes on Linux, macOS and Windows and `npm-package-result` is a required check; the publish came from CI with no npm token anywhere; `npx agent-cost-analyzer@0.16.0` started the app from a clean folder. The placeholders `0.0.0` and `0.0.0-stage` are deprecated.
[1.0.0 release](../implementation-plan.md#100-release). It splits V16
(build), V17 (trusted publishing) and V18 (docs) into the tasks in §11.

Owner decisions already made (2026-11-14): the package name is
`agent-cost-analyzer` (free on npm that day), users run it with
`npx agent-cost-analyzer`, it is published from the app's release
workflow through npm trusted publishing (OIDC), and both products go to
1.0.0 together.

## 1. Why

The standalone app **Agent Cost Analyzer** runs only from a clone today:
`git clone`, `npm install` (the whole dev tree: Playwright, wdio, Vite,
esbuild), then `npm start`, which runs the Vite dev server and `tsx watch`.
That is a contributor's setup, not a user's. 1.0 criterion C8 asks for one
command: `npx agent-cost-analyzer`.

## 2. Goals and non-goals

Goals:

- `npx agent-cost-analyzer` starts the app on a loopback port and opens it
  in the browser.
- `npx agent-cost-analyzer mcp` serves the read-only MCP server over stdio,
  with the MCP App views, so MCP clients need no clone.
- The tarball holds a bundled server, the built web app, the built MCP App
  views and the runtime data files. It has no dependencies and no install
  scripts.
- A CI job packs the package, installs the tarball, runs it and loads the
  app on Linux, macOS and Windows.
- Releases publish from `release-app.yml` through npm trusted publishing,
  with a provenance attestation and no npm token in the repository.

Non-goals:

- **No update check, telemetry or network call by the app** (architecture
  constraint 1). `npx` itself talks to the registry; the app never does.
- **No `--host` option.** The server binds loopback only, as today
  (architecture §11.2, threat-model §5.1).
- No `pi-system-prompt-logger` in the package. Installing it into pi stays
  on the clone path (`npm run configure`).
- No change to the dev path. `npm start` and `npm run dev` keep the Vite
  dev server for contributors.
- No npm package for the VS Code extension.
- No Docker image, Homebrew formula or standalone binary.

## 3. What exists

Read on `main` at `766aaa90`.

| Area | Today | Source |
|---|---|---|
| Root package | `name: "agent-cost-analyzer"`, `private: true`, `version` 0.14.0 is the app's version (`release-app.yml` checks the `app-v*` tag against it), `type: module`, `engines.node >=22.18`, `repository.url` `git+https://github.com/raulkivi/agent-cost-analyzer.git`, MIT | `package.json` |
| How the app starts | `npm start` runs `scripts/dev-open.sh`: `npm run dev` (server under `tsx watch`, web on the Vite dev server at 127.0.0.1:5173 proxying `/api` to 127.0.0.1:3001), then `xdg-open` or `open` | `scripts/dev-open.sh`, `packages/web/vite.config.ts` |
| Server entry | Fixed port 3001, host `127.0.0.1`, `assertLoopbackBindHost`, `allowedHostPorts: [3001, 5173]`; it serves no static files | `packages/server/src/server.ts` |
| Same-origin precedent | The web e2e suite already serves the API and `packages/web/dist` from one Express app on an ephemeral loopback port (`app.use(express.static(dist))`) | `packages/web/e2e/support/serve.mts` |
| MCP stdio entry | `packages/server/src/mcp/stdio.ts` under `tsx`, launched by `scripts/mcp-server.sh`, which adds `--app-views-html packages/mcp-apps/dist/views.html` when built. Flags: `--project-billing-details`, `--app-views-html` | `scripts/mcp-server.sh`, `mcp/stdio-args.ts` |
| Runtime data | Learn scripts, vendor profiles and the price book, found through `import.meta.url` relative paths (`../../../fixtures/...`) | `learn-scripts/loader.ts`, `vendor-profiles/loader.ts`, `pricing/bundled-price-book-source.ts` |
| Version | `readAppVersion()` reads `packages/server/package.json`; the path is injectable for a bundle (G4) | `composition/app-version.ts` |
| Settings folder | `~/.config/agent-cost-analyzer` (Linux, `XDG_CONFIG_HOME`), `~/Library/Application Support/agent-cost-analyzer` (macOS), `%APPDATA%\agent-cost-analyzer` (Windows). The app's only writes: active provider, retention threshold, `projects.json`, `statements/` | `platform/app-settings-dir/resolve-app-settings-dir.ts`, threat-model §4 |
| SQLite | `node:sqlite` (`DatabaseSync`, read-only), built into Node. It reads VS Code's session store, Agent Host databases and `agent-traces.db`. **No native addon** | architecture §9 |
| Runtime dependencies | Server: `express`, `gpt-tokenizer`, `jsonc-parser`, three `@modelcontextprotocol/*` packages pinned at 2.4.0 and `ext-apps` 2.0.4; domain: `zod`. All pure JavaScript. The lockfile's packages with install scripts (`esbuild`, `fsevents`, drivers) are all dev-only | `packages/*/package.json`, `package-lock.json` |
| Bundling precedent | The extension bundles the server code with esbuild into `dist/extension.js` (3.6 MB minified) and `dist/mcp-stdio.js` (3.9 MB), CommonJS, `node:` builtins external, data copied JSON-only to `media/`, paths and version injected (G4). Its `.vsix` is about 3.2 MB | `packages/vscode-extension/scripts/esbuild-options.mts`, `build.mts` |
| Build sizes | `packages/web/dist` 1.1 MB, `packages/mcp-apps/dist/views.html` 0.77 MB, runtime JSON 0.4 MB | measured in the owner's checkout |
| Release | `release-app.yml` on `app-v*`: one job, `contents: write`, lint, typecheck, build, test, the web and MCP Apps Playwright suites, then a GitHub Release. No environment, no artifact, no publish | `.github/workflows/release-app.yml` |
| OIDC precedent | `release-extension.yml`: a build job, then a `publish` job in the `release` environment with `id-token: write` (Entra ID, Open VSX) | `.github/workflows/release-extension.yml` |
| `release` environment | Requires the owner's review; deploys only from `ext-v*` tags | threat-model §5.8 |
| Tags | No tag ruleset yet (1.0 criterion C12) | threat-model §5.8 |
| CI | Every job runs on `ubuntu-latest`; nothing runs on macOS or Windows | `.github/workflows/ci.yml` |
| Licence notices | `LICENSE` (MIT) and `THIRD-PARTY-NOTICES.md`, which lists only the two bundled fonts | root |

## 4. Design

### 4.1 Which package publishes

A new workspace, `packages/cli`, publishes as `agent-cost-analyzer` (D1).
It holds the command-line entry, argument parsing, port choice, the
browser opener, the build script and the pack tests. Its `package.json`
is exactly what users install. The monorepo root stays private and keeps
the app's version; a test keeps the two versions equal.

The root is renamed (for example `agent-cost-analyzer-monorepo`), so the
workspace name is unique and an `npm publish` at the root can never
claim the public name.

### 4.2 What goes in the tarball

```
agent-cost-analyzer-<version>.tgz
  package/
    package.json             name, version, bin, files, engines, type, license, repository
    README.md                npx usage, links to the GitHub docs (absolute URLs)
    LICENSE                  MIT, copied from the root
    THIRD-PARTY-NOTICES.md   generated: fonts + every bundled npm package (§4.9)
    bin/agent-cost-analyzer.js   unbundled shim: Node version gate, then import("../dist/cli.js")
    dist/
      cli.js                 entry: parses argv, runs `serve` or `mcp`
      chunk-*.js             shared code (esbuild code splitting)
      web/                   packages/web/dist (index.html, assets/, fonts)
      mcp-apps/views.html    packages/mcp-apps/dist/views.html
      data/learn-scripts/    JSON only
      data/vendor-profiles/  JSON only
      data/price-book/       JSON only
```

- **`files` allow-list:** `["bin/", "dist/", "THIRD-PARTY-NOTICES.md"]`;
  npm always adds `package.json`, `README.md` and `LICENSE`. No source maps,
  no tests, no test fixtures (`fixtures/jsonl`, `claude-code`, `pi-agent`,
  `mitmproxy`, `agent-host` stay out), no esbuild metafile. A test compares
  `npm pack --dry-run --json` with an expected file list.
- **No dependencies.** esbuild bundles `express`, `zod`, the MCP SDK,
  `gpt-tokenizer` and `jsonc-parser`. `dependencies` is empty, so `npx`
  downloads one tarball and resolves no transitive tree.
- **No lifecycle scripts.** The published `package.json` has no `scripts`
  field. A test fails on `preinstall`, `install`, `postinstall`, `prepare`
  or any other lifecycle key.
- **ESM.** `"type": "module"`, `format: "esm"`, `platform: "node"`,
  `target: "node22.18"`, `splitting: true` so `serve` and `mcp` share one
  copy of the server code. A banner defines `require` through
  `createRequire(import.meta.url)`, because `express` and other CommonJS
  dependencies call `require` at runtime. `node:` builtins stay external,
  so `node:sqlite` is the user's own Node.
- **Paths.** The bundled code never relies on `import.meta.url` relative
  paths into `fixtures/`. The CLI passes a package layout (data folders,
  views file, web folder, the package's own `package.json` for the
  version) into both composition roots, as the extension does (G4). The
  dev defaults stay as they are.
- **Minification:** none by default (D9), so users can read what they run.
  Legal comments are kept.
- **Size budget:** packed at most 4 MB, unpacked at most 12 MB. Estimate:
  about 4-5 MB of JavaScript (the extension's two bundles share most of
  their 7.5 MB, and `gpt-tokenizer`'s encoding dominates), 1.1 MB web,
  0.8 MB views, 0.4 MB data. The pack test fails over budget. V16
  measures the real figure and the owner may tighten the budget.
- **Node engine:** `"engines": { "node": ">=22.18" }`. npm only warns on a
  mismatch, so the `bin` shim checks `process.versions.node` before it
  loads anything and exits 1 with "Agent Cost Analyzer needs Node.js 22.18
  or newer; this is <version>". The shim is plain ES2017 so it parses on
  old Node.
- **SQLite warning.** Node prints an `ExperimentalWarning` for
  `node:sqlite`. The shim filters that one warning, so the first line a
  user sees is the app's own.
- **Native code:** none. `node:sqlite` is part of Node, and every bundled
  dependency is JavaScript. So there are no prebuilt binaries per OS or
  CPU. The pack test fails if the tarball holds a `.node` file or a
  `binding.gyp`.

### 4.3 Command line

One `bin` entry, `agent-cost-analyzer`, with a subcommand (D5). With one
bin, npm runs it for `npx agent-cost-analyzer`.

| Command | Does |
|---|---|
| `agent-cost-analyzer` | Starts the app and opens the browser |
| `agent-cost-analyzer --port <n>` | Uses that port only; `0` takes any free port. Fails with a message if the port is busy |
| `agent-cost-analyzer --no-open` | Starts without opening a browser |
| `agent-cost-analyzer mcp [--project-billing-details] [--app-views-html <path>]` | The MCP stdio server, with the packaged views by default. The flags are today's (`stdio-args.ts`) |
| `--help`, `-h` | Usage on stdout, exit 0 |
| `--version`, `-v` | The package version on stdout, exit 0 |
| Anything else | The error and usage on stderr, exit 2 |

Arguments are parsed with `node:util` `parseArgs` in a pure module with
unit tests, as `stdio-args.ts` is today. Nothing reaches a shell.

### 4.4 First run

1. The shim checks Node, then loads `dist/cli.js`.
2. The server composes as `server.ts` does today: settings folder,
   legacy-folder move, configuration check (warnings on stderr).
3. Port (D4): the default is one fixed port, so the browser origin stays
   the same between runs (the theme choice and other browser storage are
   per origin). If that port already answers `GET /api/health` as this app,
   the CLI opens that instance and exits. If something else holds it, the
   CLI tries the next ten ports and says which one it took. `--port` skips
   both fallbacks.
4. `createApp({ allowedHostPorts: [port] })` serves the API, then
   `express.static(dist/web)` for the web app on the same origin, so no
   proxy is needed. Responses add `X-Content-Type-Options: nosniff` and a
   Content Security Policy that allows only `'self'` (fonts are bundled,
   constraint 1). Static serving is read-only: no directory listing, no
   dotfiles.
5. It prints one line: `Agent Cost Analyzer <version> on http://127.0.0.1:<port> (Ctrl+C to stop)`.
6. It opens the browser (§4.5) unless `--no-open`.
7. Ctrl+C or SIGTERM closes the server and exits 0.

Guarantees, unchanged from the dev path and stated in the README:

- Loopback only: the bind host is `127.0.0.1` and `assertLoopbackBindHost`
  stays; the Host-header guard allows only the port actually bound.
- Read-only towards every log and every tool's settings. The app writes
  only its own settings folder. The smoke job checks this (§5).
- No telemetry and no network call by the app.

### 4.5 Opening the browser

A small module with one opener per OS, run with `spawn` (no shell,
`detached`, `stdio: "ignore"`, `unref`): `open <url>` on macOS,
`xdg-open <url>` on Linux, and on Windows
`rundll32 url.dll,FileProtocolHandler <url>` (no `cmd /c start`, which
would parse the argument as shell text). The URL is built only from
`127.0.0.1` and the numeric port, never from input. It is skipped with
`--no-open`, when `CI` is set, and on Linux without `DISPLAY` or
`WAYLAND_DISPLAY`. If the opener fails, the printed URL is enough. No
dependency (D8).

### 4.6 MCP clients

```sh
claude mcp add agent-cost-analyzer -- npx -y --prefer-offline agent-cost-analyzer mcp
```

- `-y` skips npx's install prompt. npm also assumes `--yes` when stdin is
  not a TTY, which is the case under an MCP client
  ([npm exec](https://docs.npmjs.com/cli/v11/commands/npm-exec)).
- stdout must carry JSON-RPC only. npm's own install messages go to
  stderr; the smoke job asserts that every stdout line parses as JSON-RPC.
- On Windows, clients that do not resolve `.cmd` files need
  `cmd /c npx -y --prefer-offline agent-cost-analyzer mcp`. The User Guide
  gives both forms.
- Offline use: the docs also give `npm install -g agent-cost-analyzer` and
  then `agent-cost-analyzer mcp`, which runs without the registry and stays
  the pinned option.
- **Amended 2026-11-15 (owner, after NP7; amends D10):** the command for MCP
  clients is `npx -y --prefer-offline agent-cost-analyzer mcp`. NP7 found
  that with the registry unreachable, plain `npx` waits about 71 s of
  retries before it runs the cached copy; `--prefer-offline` starts at once.
  The first command above, `npx -y agent-cost-analyzer mcp`, is the
  original design.

### 4.7 Versioning and `npx` caching

- The npm version is the app's version: the root `package.json`, the
  `app-v<version>` tag, the root `CHANGELOG.md` section and the
  `packages/cli` version are the same. `release-check.mts` also checks the
  `packages/cli` version, and a unit test checks it on every PR.
- `npx` installs into a folder in the npm cache. npm documents the cache
  and `--prefer-online` but not when an unversioned spec is re-resolved
  ([npm exec](https://docs.npmjs.com/cli/v11/commands/npm-exec)). The docs
  therefore show `npx agent-cost-analyzer@latest` for "run the newest", and
  `agent-cost-analyzer --version` to check what runs. A project that lists
  `agent-cost-analyzer` as a dependency runs that copy instead.
- Releases before 1.0.0 publish too (D7). Each goes to the `latest` tag.

### 4.8 CI: pack and run

A new job, `npm-package`, in `ci.yml`, skipped for docs-only PRs like the
other heavy jobs, required by ruleset 27004539 (D6). Matrix: Ubuntu,
macOS and Windows on Node 22.18.0 (the minimum, exact), plus Ubuntu on
Node 24.

One script, `scripts/npm-package-smoke.mts`, used by CI and by the release
workflow, does:

1. `npm run build`, then `npm pack --workspace=packages/cli` into a temp
   folder.
2. Checks the tarball: file list equals the expected list; packed and
   unpacked size within budget; no lifecycle scripts; empty
   `dependencies`; `bin` points at a file with a `#!/usr/bin/env node`
   line and LF endings; no `.node` or `binding.gyp`; `engines.node` is
   `>=22.18`; `repository.url` matches the repository exactly (npm
   provenance requires it).
3. In a fresh temp folder with its own npm cache and `HOME` (and
   `APPDATA`, `XDG_CONFIG_HOME`) pointed at a seeded fixture home:
   `npm install --ignore-scripts --no-audit --no-fund <tarball>`, then
   `npx --yes --package=<tarball> agent-cost-analyzer --version` (the npx
   path itself) and `--help`.
4. Starts `agent-cost-analyzer --no-open --port 0`, reads the URL from its
   line, and checks: `GET /api/health` is 200 with the package version;
   `GET /` serves `index.html`; one asset loads with the right type;
   `Host: evil.example` gets 403; the CSP header is present.
5. A Playwright spec loads the URL: Learn mode renders a scenario, there
   are no console errors, and no request leaves `127.0.0.1`.
6. Starts `agent-cost-analyzer mcp` and, through the MCP client SDK from
   the repo's dev tree: `initialize` returns the package version,
   `tools/list` holds the expected tool names, the views resource is
   listed, and every stdout line is JSON-RPC.
7. SIGINT (on Windows, the process tree kill) stops the server; the fixture
   home is diffed before and after, and only the app's settings folder may
   have changed.

### 4.9 Licence, SPDX and notices

- `LICENSE` (MIT) ships unchanged.
- Each source file under `packages/cli` gets the two-line SPDX header
  (`npm run headers:fix`). esbuild keeps only `@license` and `/*!`
  comments, not the sources' SPDX lines, so the build's banner puts the
  SPDX lines at the top of every output file (found in NP6).
- `THIRD-PARTY-NOTICES.md` in the package is generated at build time from
  the esbuild metafile: each bundled npm package's name, version, licence
  and licence text, plus the fonts section of the root file. A test fails
  if a bundled package is missing from it or its licence is not on an
  allow-list (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD,
  OFL-1.1). The extension's bundles have the same gap today; that is a
  follow-up, not part of this plan.

### 4.10 Publishing

`release-app.yml` becomes two jobs, like `release-extension.yml`:

- **build** (`contents: read`): today's checks, then `npm pack` once, the
  smoke script on that tarball, and an artifact with the tarball and its
  SHA-256, uploaded right after the smoke and before any step that
  installs another npm. The pinned-npm `npm publish --dry-run` runs after
  the upload, and no release workflow restores an npm cache, so a poisoned
  cache or a later step can't rewrite the tarball or `SHA256SUMS`;
  artifacts are immutable once uploaded, and the publish job's SHA-256 check
  proves the transfer. A manual `workflow_dispatch` run is a dry run: the build job
  runs in full and the publish job is skipped.
- **publish** (`needs: build`, `environment: release`, permissions
  `contents: write` and `id-token: write`): downloads the artifact,
  verifies the SHA-256, sets up an exact Node release whose bundled npm
  is 11.5.1 or later (trusted publishing needs npm 11.5.1+; 24.22.3 bundles
  11.19.1) with `registry-url: https://registry.npmjs.org`, checks that
  the package's only maintainer is the owner
  (`npm view agent-cost-analyzer maintainers`; skipped before the first
  publish), runs `npm publish <tarball> --access public`, then creates the
  GitHub Release with the tarball attached. The tarball published is the
  one the smoke job tested.

Trusted publishing generates the provenance attestation automatically
for a public package from a public GitHub repository
([trusted publishers](https://docs.npmjs.com/trusted-publishers)). No
`NODE_AUTH_TOKEN` or npm secret exists anywhere.

**First publish (research result).** npm trusted publishing **cannot**
make a package's first publish. `npm trust` lists as a prerequisite: "The
package you're configuring must already exist on the npm registry"
([npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust)). The
web form sits in the package's own settings page
([trusted publishers](https://docs.npmjs.com/trusted-publishers)). npm has
no equivalent of PyPI's pending publisher. So the first version needs
another path (D2). Two more facts from the same page shape the order of
steps:

- A new trusted-publisher configuration must succeed at a publish within
  2 days, or it expires and must be deleted and created again.
- The page recommends, once trusted publishing works, the package setting
  "Require two-factor authentication and disallow tokens", which does not
  affect OIDC publishing.

Owner steps, in order:

1. Now: publish the placeholder (D2) from the owner's machine with 2FA.
   This reserves the name.
2. When V16 and the publish job are merged: in npmjs.com, add the trusted
   publisher (user `raulkivi`, repository `agent-cost-analyzer`, workflow
   `release-app.yml`, environment `release`, publish only); add `app-v*`
   to the `release` environment's deployment rule.
3. Within 2 days: tag the next 0.x app release (D7) and approve the
   `release` environment. Check `npm view agent-cost-analyzer@<version>
   dist.attestations`.
4. Then: set "Require two-factor authentication and disallow tokens",
   revoke any npm token the owner holds, and deprecate the placeholder.

**Tag ruleset (C12).** The trusted publisher trusts any run of
`release-app.yml` in the `release` environment. Three gates limit that
run: the environment's tag rule (`app-v*` after step 2), the owner's
review of each deployment, and C12's tag ruleset (only the owner creates
or moves `app-v*` tags). The ruleset (V7) should exist before the first
trusted publish.

## 5. Security and threat-model rows

Rows to add to [threat-model.md](../threat-model.md) (task NP12). Text
here is the finding to verify, not yet verified.

| Section | Surface | Threat | Planned finding |
|---|---|---|---|
| §8 | `release-app.yml` → npm (`app-v*` tag) | A malicious tag or build publishing to every `npx` user; a stolen npm token | **Mitigated.** OIDC trusted publisher bound to this repository, `release-app.yml` and the `release` environment (owner review, `app-v*` only); the C12 tag ruleset; no npm token in the repository, its environments or the owner's machine after step 4; "disallow tokens" on the package; provenance attestation; the published tarball is the tested one (SHA-256 check). |
| §8 | npm account and package takeover | The owner's npm account or a new maintainer publishing a malicious version | **Mitigated in part.** 2FA with a security key on the account; the package allows no tokens; the publish job refuses to run if the maintainer list is not the owner alone. Residual: an account takeover with 2FA defeated; npm's own controls apply. |
| §8 | Typosquats and look-alikes | A user running a malicious look-alike | **Mitigated in part.** npm refuses new names that differ from an existing one only by punctuation ([moniker rules](https://blog.npmjs.org/post/168978377570/new-package-moniker-rules)); `agent-cost-analyser` is a working alias of the real package (D3, amended 2026-11-15); the README and User Guide give the exact name and link the npm page, whose provenance links back to this repository. | <!-- codespell:ignore analyser -->
| §8 | Install-time code | Code that runs on `npm install` or `npx` before the user starts the app | **Mitigated.** No lifecycle scripts and no dependencies, so nothing runs at install and no transitive package is fetched; the smoke job installs with `--ignore-scripts` and asserts the manifest. |
| §8 | Bundled dependencies | A vulnerable bundled dependency that users' `npm audit` cannot see | **Mitigated in part.** The release build fails on `npm audit --omit=dev` findings of high severity; Dependabot covers the source tree; a fix ships as a new patch release. Residual: users rely on this project to republish. |
| §4 | `agent-cost-analyzer` bin: local server | Exposure beyond loopback; DNS rebinding with a port that is no longer fixed | **Mitigated.** No `--host`; `assertLoopbackBindHost`; the Host guard allows only the bound port; the API row for DNS rebinding is updated from "3001 or 5173" to "the bound port". Same single-user trust model (§3). |
| §4 | Static file serving (`express.static` of the packaged `dist/web`) | Path traversal; content sniffing; a remote resource | **Mitigated.** Served only from the package folder, no listing, dotfiles ignored; `nosniff`; a `'self'`-only CSP; the Playwright spec asserts no request leaves loopback. |
| §4 | Browser opener | Command injection through the URL | **Mitigated.** `spawn` without a shell, a fixed program per OS, a URL built from `127.0.0.1` and a number. The "no `child_process`" sentence in the last §4 row is updated to name this one call. |
| §4 | `agent-cost-analyzer mcp` | As the existing MCP row | **Unchanged.** Same flags and services; the views path defaults to the packaged file. |

## 6. Owner decisions

Decided 2026-11-14: the owner accepted each recommendation.

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | Which package publishes? | (a) a new workspace `packages/cli`; root renamed and kept private; (b) the monorepo root, made public with a `files` list | **(a).** The published manifest is exactly what users get: no workspaces, dev dependencies, overrides or dev scripts in it, and the root can never be published by mistake. Single responsibility: the CLI concerns live in one package. |
| D2 | First publish, which OIDC cannot do (§4.10) | (a) the owner publishes a placeholder `0.0.0` (README and `package.json` only, no `bin`, no scripts) from their machine with 2FA, now; every real version comes from CI with provenance; (b) the owner publishes the first real version from their machine; (c) a one-time granular token in the `release` environment for the first CI publish, deleted after | **(a), now.** It reserves the name before 1.0 (free on 2026-11-14, not guaranteed later) and finds out early if npm rejects the name as too similar. Every real version then has provenance. (b) ships unattested code built on a personal machine. (c) adds the kind of secret the repository is removing (`OVSX_PAT`, C13). The placeholder is deprecated after the first real publish. |
| D3 | Reserve look-alike names? | (a) none; (b) `agent-cost-analyser` only; (c) several spellings | **(b).** Punctuation variants are already blocked by npm. The British spelling is the likely slip (this project's own old folder name was `gh-cp-chat-analyser`). Publish it as a deprecated placeholder that names the real package, with no code. More stubs are more packages to guard and look like squatting. **Amended 2026-11-15 (owner):** the look-alike is a working **alias**, not a placeholder: `agent-cost-analyser` (`packages/cli-alias`) has one dependency, `agent-cost-analyzer` by the range `>=0.16.0 <2`, and a one-line bin that imports the real launcher, so `npx agent-cost-analyser` runs the real app instead of dead-ending in a deprecation notice. The range means the alias is republished only when its own version changes, not on every app release. It is published by the same release workflow, after the main package, through its own trusted publisher, behind the same maintainer check, and only while its version is absent from npm. The alias adds no code of its own and no install script; its residual risk is that it trusts future in-range versions of our own package (threat model §8). | <!-- codespell:ignore analyser -->
| D4 | Port | (a) a fixed default port, reuse a running instance, else the next ten ports; `--port` exact; (b) always a free port (`0`); (c) fixed, fail when busy | **(a)** with default **5199** (V16 checks it against the IANA registry and common dev tools first). A stable origin keeps the browser's stored theme; a second start opens the running instance instead of failing; it never takes 3001 or 5173, so the dev path still runs beside it. |
| D5 | MCP entry | (a) `agent-cost-analyzer mcp` on one bin; (b) a second bin `agent-cost-analyzer-mcp` | **(a).** With one bin, `npx agent-cost-analyzer mcp` works as is; a second bin needs `npx -p agent-cost-analyzer agent-cost-analyzer-mcp`. |
| D6 | Target OSes and CI | (a) Linux, macOS, Windows, run on every non-docs PR and required; (b) Linux required, macOS and Windows on release only | **(a).** Nothing runs on macOS or Windows today, so the first runs will find path and process bugs; finding them on the PR that causes them is cheaper. Public-repository runners cost nothing. |
| D7 | Publish 0.x before 1.0.0? | (a) yes, from the first app release after the publish job lands; (b) 1.0.0 is the first real version | **(a).** The 1.0.0 publish is then not the first trusted publish, as V10 does for Open VSX, and early users can try `npx` before 1.0. |
| D8 | Browser opener | (a) a small module, no dependency; (b) the `open` package | **(a).** Three fixed commands, about 30 lines, testable through an injected spawner; one fewer bundled dependency (architecture §11.6). |
| D9 | Minify the bundle? | (a) no; (b) yes, as the extension does | **(a),** as long as the size budget holds. Users can read what `npx` runs, and the provenance attestation links the source. Switch to (b) only if over budget. |
| D10 | MCP client instructions | (a) `npx -y agent-cost-analyzer mcp` first, `npm install -g` for offline or a fixed version; (b) global install only; (c) pin an exact version in the `npx` command | **(a).** One command for most users; the global install covers offline use (architecture constraint 1) and pinning. **Amended 2026-11-15 (owner):** the command is `npx -y --prefer-offline agent-cost-analyzer mcp`, because NP7 measured about 71 s of registry retries before plain `npx` ran the cached copy with the registry unreachable; on Windows clients that do not resolve `.cmd`, `cmd /c npx -y --prefer-offline agent-cost-analyzer mcp`; `npm install -g` then `agent-cost-analyzer mcp` stays the fully offline and pinned option. |

## 7. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| The name is taken or refused as too similar before the first publish | No `npx agent-cost-analyzer` | D2 (a) now; fallback `@raulkivi/agent-cost-analyzer`, which changes the owner decision and the docs |
| The trusted-publisher configuration expires (2 days unused) | The first CI publish fails | Configure it only when the release is ready (§4.10 step 2); delete and recreate if missed |
| CommonJS dependencies in an ESM bundle (`Dynamic require of "x" is not supported`) | The bin crashes at start | `createRequire` banner; a bundle-load test runs `serve` and `mcp` from `dist/` |
| `import.meta.url` paths break inside the bundle | Learn mode, prices or views missing | The package-layout injection (§4.2); the smoke job loads Learn mode and the views resource |
| First macOS and Windows runs find bugs in server code (paths, signals, line endings) | The CI job cannot go green; 1.0 slips | Task NP8, test-first; the bugs exist today for those users anyway |
| `node:sqlite` changes between Node 22 and 24 | Analyze mode fails on one Node | Matrix on 22.18.0 and 24 |
| Bundled dependencies are invisible to users' `npm audit` | A known advisory ships unnoticed | The release gate's audit; Dependabot; patch releases (§5) |
| Stale `npx` cache | Users run an old version | `@latest` in the docs; `--version`; the version on `/api/health` |
| Licence notices for bundled packages missing | Licence breach | Generated notices with an allow-list test (§4.9) |
| The runner's npm is older than 11.5.1 | OIDC publish fails | Both jobs set up an exact Node release that bundles npm 11.5.1+ (amended 2026-11-16: was an `npm install -g` of an exact npm, which Scorecard flags as not pinned by hash) |
| Package size grows (tokenizer data, views) | Slow first `npx` | The size budget test |

## 8. Exit criterion

1. The `npm-package` CI job (pack, install from the tarball with scripts
   off, `npx --package=<tarball>`, start, HTTP checks, the Playwright load
   spec, MCP stdio `initialize` and `tools/list`, the write-scope check)
   passes on Linux, macOS and Windows and is a required check.
2. An `app-v*` release publishes `agent-cost-analyzer` from
   `release-app.yml` through npm trusted publishing, with a provenance
   attestation, and no npm token exists in the repository, its
   environments or as a package publishing method. Under D7 a 0.x release
   is the first; the 1.0.0 publish comes the same way. The only publish
   outside CI is the owner's placeholder (D2).
3. `npx agent-cost-analyzer@<that version>` starts the app on a clean
   machine.

## 9. Docs to update (task NP13)

| Doc | Change |
|---|---|
| `README.md` | "Get started: Agent Cost Analyzer": `npx agent-cost-analyzer` first (Node 22.18+), the port and `--no-open`, the settings folder; the clone path moves to "From source (contributors)". "Ask your AI chat": the `npx` MCP command |
| `packages/cli/README.md` (new) | The npm page: what it is, `npx` usage, flags, MCP command, privacy in three lines, links to the GitHub docs |
| `docs/standalone-app.md` | Setup and the AI-agent setup prompt use `npx`; the clone path for contributors and the pi logger |
| `docs/UserGuide.md` | "Getting started" with `npx`; "Querying the audit from Claude Code (MCP)" with `npx -y agent-cost-analyzer mcp`, the Windows form and the global install |
| `CHANGELOG.md` | `[Unreleased]` "Added": the npm package and its commands |
| `SECURITY.md` | npm as a distribution channel; provenance; how to verify (`npm audit signatures`) |
| `docs/threat-model.md` | §5 rows; §1 summary (the packaged app serves its own web build); §5.8 the `release` environment's tag rule |
| `docs/architecture.md` | §3 and §4.1 (packaged entry, same-origin static serving), §9 (esbuild for the package), §10 (`packages/cli`), §11.2 (Host guard on the bound port) |
| `docs/plans/vscode-extension.md` §7.2 | The app release now publishes to npm; the owner's approval step |
| `docs/implementation-plan.md`, Gantt | C8 status and V16-V18 progress as tasks land (the main session links this plan) |

## 10. UI checks

One Playwright spec in the smoke job (§4.8 step 5), on all three OSes.
The existing `web-e2e` suite already covers the app's screens; this spec
proves only that the packaged build loads from the tarball. No manual
checklist row (release-ui-gate.md owner rule).

## 11. Tasks

TDD in every code task: the failing test is written and seen red first
(architecture §11.4). No local model in this repo. "Owner step" marks
work that needs the owner's accounts. NP1-NP9 are V16, NP10-NP11 are V17,
NP12-NP13 are V18.

| ID | Task | Exit | Complexity | Model | Depends on |
|---|---|---|---|---|---|
| NP0 (done 2026-11-15) | Publish the placeholder `agent-cost-analyzer@0.0.0` (D2) and, under D3, `agent-cost-analyser@0.0.0`, from the owner's machine with 2FA; account 2FA on a security key | `npm view` shows both, owner the only maintainer | low | Owner step | D2, D3 decided |
| NP1 (done 2026-11-15) | `packages/cli` workspace: `package.json` (name, `bin`, `files`, `engines`, `type`, `license`, `repository`, no scripts, no dependencies), root renamed (D1), `release-check.mts` and a unit test keep the versions equal; SPDX headers | Tests green; `npm install` and the existing suites unchanged | low | Sonnet | Plan approved |
| NP2 (done 2026-11-15) | Argument parsing (`parseArgs`, pure) and the `bin` shim's Node gate and warning filter | Tests for every row of §4.3 and for Node 21 and 22.17 refusals | medium | Sonnet | NP1 |
| NP3 | Package-layout injection into the standalone and MCP composition roots (data folders, views, web folder, version path); dev defaults unchanged. **Done 2026-11-15:** `PackageLayout` and `npmPackageLayout(packageRoot)` (`composition/package-layout.ts`); `composeStandaloneApp({ layout, allowedHostPorts })` (`standalone-app.ts`) returns `{ app, version }` without listening; `serveStandaloneMcpStdio({ layout, projectBillingDetails, appViewsHtml })` and `createStandaloneMcpServerFactory` (`mcp/standalone-mcp-server.ts`) | Tests: a layout in a temp folder is read; no `import.meta.url` path used when a layout is given | medium | Opus | NP1 |
| NP4 (done 2026-11-15) | `serve`: port choice (D4) incl. reusing a running instance, `createApp` with the bound port, static web, `nosniff` and CSP, start line, signals | supertest and real-listen tests: busy port, `--port` busy, reuse, 403 on another Host, static traversal refused | medium | Sonnet | NP2, NP3 |
| NP5 (done 2026-11-15) | Browser opener (D8) with an injected spawner | Tests per OS: program, argv, no shell, skip rules | low | Sonnet | NP2 |
| NP6 (done 2026-11-15) | Build script: esbuild ESM with splitting and the `require` banner, copies (web, views, JSON-only data), generated `THIRD-PARTY-NOTICES.md` with the license allow-list test, bundle-load test, size budget | `npm run build` produces `packages/cli/dist`; the bundle runs `--version`, `serve` and `mcp`; notices and budget tests green | high | Opus | NP3, NP4, NP5 |
| NP6b (done 2026-11-15, PR #315) | Notices for the Vite-built web app and MCP App views: both builds emit the npm packages they bundle (name, version, license, license text), the generator adds them to the package's `THIRD-PARTY-NOTICES.md` under the same allow-list; found in NP6 (the Vite bundles carry no license comments, so React, d3 and the others shipped without notices) | The notices test fails when a package bundled into `dist/web` or `views.html` is missing or off the allow-list | medium | Sonnet | NP6 |
| NP7 (done 2026-11-15, PR #316) | `scripts/npm-package-smoke.mts` and the `npm-package` CI job (§4.8), with the Playwright spec and the MCP client check | Job green on Ubuntu (Node 22.18.0 and 24) | high | Opus | NP6 |
| NP8 (done 2026-11-15, PR #317) | macOS and Windows: fix what the job finds, test-first | Job green on all three OSes | medium | Sonnet (Opus if the fix crosses modules) | NP7 |
| NP9 (done 2026-11-15: `npm-package-result` required) | Add the `npm-package` checks to ruleset 27004539 (D6) | Required, read back through the GitHub API | low | Owner step | NP8 |
| NP10 (done 2026-11-15) | `release-app.yml`: build job packs once and runs the smoke; publish job in `release` with `id-token: write`, exact npm version, SHA-256 check, maintainer check, `npm publish <tarball> --access public`, the tarball on the GitHub Release; `npm audit --omit=dev` gate | The build job runs `npm publish --dry-run <tarball>`; a `workflow_dispatch` dry run on `main` runs the build job green; the publish job runs only on `app-v*` tags (owner 2026-11-15: dry run in this repository, no fork) | medium | Sonnet | NP7 |
| NP11 (done 2026-11-15: trusted publisher, `app-v*` on `release`, 2FA and no tokens, placeholders deprecated) | Trusted publisher on npmjs.com; `app-v*` on the `release` environment; first 0.x release within 2 days (D7); then "disallow tokens", revoke tokens, deprecate placeholders | `npm view agent-cost-analyzer@<version> dist.attestations` shows provenance; environment rule read back through the API | low | Owner step | NP10, NP0, V7 |
| NP12 (done 2026-11-15) | Threat-model rows (§5) and §1, §5.8 updates, citing the test names. Findings: §4 rows for the bin, static serving, the opener and `mcp`; §8 rows for the release, the npm account, look-alike names, install-time code, bundled dependencies and the `npm-package` job. Differences from §5's text: the maintainer check always runs (the placeholder exists); the CSP has one sha256 script hash besides `'self'`; the account uses a passkey (NP0); trusted publisher, `app-v*` on the `release` environment and "disallow tokens" are still owner steps (NP11) | Rows written; every cited test exists | low | Sonnet | NP10 |
| NP13 (done 2026-11-15) | Docs (§9). `docs/plans/vscode-extension.md` §7.2 already covered the publish (NP10) and is unchanged | Each doc updated with its header date; doc tests green | low | Sonnet | NP10 |
| NP14 (done 2026-11-15: PRs #342, #343, #345; provenance read back) | Review: code and security review of the package and the publish path, full suite, headers, `npm audit signatures` on the published version in a temp project | §8 exit criterion met; commit on `main` | medium | Opus | NP11, NP12, NP13 |
| NP15 (done 2026-11-15) | The `agent-cost-analyser` alias (D3 amended): `packages/cli-alias` (manifest test, packed-install test with no registry, `--version`, `--help`, `mcp` initialize), the smoke and CI `npm-package` job pack and run it against the main tarball on every OS, `release-app.yml` packs, checksums, dry-runs and publishes it after the main package when its version is absent, threat-model and user docs. Owner steps before the next app release: undeprecate `agent-cost-analyser`, re-deprecate only `0.0.0` and `0.0.0-stage`, add a trusted publisher on it | Tests green; the smoke runs the alias on Linux, macOS and Windows | medium | Sonnet | NP10 | <!-- codespell:ignore analyser -->

Order: NP0 now (it only needs D2 and D3). NP1-NP5 in parallel after
approval, then NP6, NP7, NP8, NP9. NP10 after NP7. NP11 when the next app
release is ready. NP12 and NP13 after NP10. NP14 last.

## 12. Sources

- npm trust, prerequisites ("The package you're configuring must already
  exist on the npm registry"; npm 11.15.0+ for the command; account 2FA):
  https://docs.npmjs.com/cli/v11/commands/npm-trust
- npm trusted publishers (npm 11.5.1+, Node 22.14+; automatic provenance
  for public packages from public repositories; GitHub-hosted runners
  only; the 2-day expiry; `repository.url` must match; "disallow tokens"):
  https://docs.npmjs.com/trusted-publishers
- npm exec (cache folder, `--yes` assumed without a TTY, bin selection):
  https://docs.npmjs.com/cli/v11/commands/npm-exec
- New package moniker rules (punctuation variants refused):
  https://blog.npmjs.org/post/168978377570/new-package-moniker-rules
