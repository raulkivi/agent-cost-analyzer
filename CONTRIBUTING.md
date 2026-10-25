# Contributing

Thanks for helping improve Agent Cost Analyzer (this repo, `agent-cost-analyzer`, also builds the AI Credits Analyzer VS Code extension). This is a personal project
maintained on a best-effort basis, so replies may take a few days.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Report security problems privately as described in [SECURITY.md](SECURITY.md),
never in a public issue.

## Read first

The docs are the source of truth. Skim these before a non-trivial change:

- [docs/vision.md](docs/vision.md): scope and non-goals
- [docs/architecture.md](docs/architecture.md): design, guiding constraints,
  and the engineering practices (TDD and SOLID, section 11)
- [docs/implementation-plan.md](docs/implementation-plan.md): phase order and
  exit criteria

If your change conflicts with them, update the relevant doc in the same PR.

## Getting started

You need Node.js 22 or newer.

```sh
git clone https://github.com/raulkivi/agent-cost-analyzer
cd agent-cost-analyzer
npm ci
npm test         # vitest for every workspace
npm run lint     # eslint across the repo
npm run typecheck # tsc --noEmit for every workspace, test files included
npm run build    # type-check and build every workspace
npm run dev      # server and web app together
```

The repo is an npm workspace: `packages/domain` (shared zod schemas),
`packages/server` (Express API and log providers), `packages/web` (Vite and
React UI), `packages/pi-system-prompt-logger` (optional Pi extension) and
`packages/vscode-extension` (the AI Credits Analyzer VS Code extension, which
reuses the other packages).

## Working on the VS Code extension

The extension is in `packages/vscode-extension`; see the
[extension guide](docs/vscode-extension-guide.md) for what it does. From the
repo root, after `npm ci`:

```sh
npm run build --workspace=packages/vscode-extension   # builds the web app in extension mode first, then bundles the extension into dist/
npm test --workspace=packages/vscode-extension        # unit tests (Vitest, no VS Code needed; CI runs them after the build)
npm run test:integration --workspace=packages/vscode-extension   # downloads and drives a real VS Code
npm run test:ui --workspace=packages/vscode-extension            # the webview in Chromium, in VS Code's themes and widths
npm run package --workspace=packages/vscode-extension # writes a .vsix next to the package
```

- **Run it with F5.** The repo ignores `.vscode/`, so there is no checked-in
  launch configuration. Open `packages/vscode-extension` as the VS Code
  folder, add a `.vscode/launch.json` locally with an `extensionHost`
  configuration whose `args` include
  `--extensionDevelopmentPath=${workspaceFolder}`, build as above, then
  press F5. A new Extension Development Host window opens with the
  extension loaded; reload that window after each build.
- **Integration tests** need a display and download VS Code on first run.
  CI runs them under `xvfb-run`; on a headless Linux machine do the same:
  `xvfb-run -a npm run test:integration --workspace=packages/vscode-extension`.
  Run `npm run build` first.
- **UI check.** `npm run test:ui` needs the build and Playwright's
  Chromium (`npx playwright install chromium` once). It fails on anything
  cut off on the right or text under WCAG AA, in Dark Modern, Light Modern
  and High Contrast at 600-1600 px. Add `-- --screenshots <dir>` to keep a
  screenshot of every combination, or `-- --only "session · dark"` to run a
  few.
- **Install a VSIX.** After `npm run package`, use *Extensions: Install from
  VSIX...* in the Command Palette and pick the file. The extension isn't
  published to a marketplace yet, so this is how to try a build.
- **Manual checks.** Some things no test can drive (the usability script, the
  MCP server in Copilot agent mode, remote windows). Release candidates are
  checked by hand against
  [docs/plans/vscode-extension-manual-checks.md](docs/plans/vscode-extension-manual-checks.md).

## Making a change

1. Open an issue first for anything larger than a small fix, so we can agree
   on the approach before you invest time.
2. Fork the repo and branch from `main`.
3. Follow test-driven development: write the failing test first, then the code
   that makes it pass. Keep to the SOLID principles described in
   `docs/architecture.md`.
4. Run `npm run lint`, `npm run typecheck`, `npm run build` and `npm test`. CI
   runs the same four.
5. Update the README or `docs/` when behavior changes, and add a line under
   `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
6. Open a pull request using the template.

Pull requests also run a Claude code review, the OpenSSF Scorecard and
[unicode-smuggling-guard](https://github.com/raulkivi/unicode-smuggling-guard),
which rejects hidden Unicode characters in code, docs and agent files. Keep to
plain visible characters.

## Privacy

The app reads local session logs and never uploads them. When you file an issue
or PR, do not paste real chat text, API keys, tokens or captures that contain
them. Redact first, or describe the shape of the data instead. Test fixtures
must be synthetic.

## License

Contributions are licensed under the [MIT License](LICENSE).
