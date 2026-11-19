# Release guide

**Last changed:** 2026-11-19 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

How to release the standalone app (Agent Cost Analyzer), the VS Code
extension (AI Credits Analyzer), or both. Each product has its own version,
changelog, tag and workflow, and is released on its own. A tag push starts
the publishing; only the owner can push a release tag or approve a
publish.

## Products at a glance

| | Standalone app | VS Code extension |
|---|---|---|
| Tag | `app-v<X.Y.Z>` | `ext-v<X.Y.Z>` |
| Version files | `package.json`, `packages/cli/package.json`, `packages/cli/server.json` (both `version` fields), `package-lock.json` | `packages/vscode-extension/package.json`, `package-lock.json` |
| Changelog | [CHANGELOG.md](../CHANGELOG.md) | [packages/vscode-extension/CHANGELOG.md](../packages/vscode-extension/CHANGELOG.md) |
| Workflow | `.github/workflows/release-app.yml` | `.github/workflows/release-extension.yml` |
| Publishes to | npm (`agent-cost-analyzer` and the alias `agent-cost-analyser`), a GitHub Release with the tarball and the `.mcpb` bundle, the MCP Registry <!-- codespell:ignore analyser --> | VS Code Marketplace, Open VSX, a GitHub Release with the `.vsix` |
| Owner-only gate | Real-data check | Real-data check and the real-Copilot suite |

## Version rules

- Semantic versioning, per product. The two versions don't need to match.
- **Extension channel:** an odd minor (1.1, 1.3) publishes to the
  Marketplace pre-release channel and marks the GitHub Release as a
  pre-release; an even minor (1.2, 1.4) is stable. `release-check.mts`
  decides this from the tag, so pick the version for the channel you want.
- **App:** no channel rule; every release becomes npm's `latest`.
- **Alias `agent-cost-analyser`:** has its own version and depends on <!-- codespell:ignore analyser -->
  `agent-cost-analyzer` `>=0.16.0 <2`. The workflow republishes it only
  when its own version is new on npm. An app 2.0.0 needs an alias bump
  that widens the range.
- The private workspace packages (`domain`, `server`, `web`, `mcp-apps`)
  are never bumped.

## Who does what

| Step | Who |
|---|---|
| Bump PR, dry run, release-record PR | Anyone, including an AI agent |
| Real-data check on real logs | Owner: it reads the owner's logs, and the owner signs off the output |
| Real-Copilot suite (extension) | Owner: needs a signed-in Copilot test profile and spends AI Credits |
| Push a tag, approve the `release` environment | Owner only (tag ruleset, environment reviewers) |

An agent may run the real-Copilot suite to test a change, under
`env -u WAYLAND_DISPLAY xvfb-run -a -s "-screen 0 1600x1000x24"` with a
credit cap. Afterwards it resets `refs/notes/release-ui` and never pushes
the note: release evidence comes from the owner's run.

## 1. Bump PR

1. Decide what ships: everything under `[Unreleased]` in that product's
   changelog.
2. Retitle `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and start an
   empty `## [Unreleased]` above it. The workflow cuts the GitHub Release
   notes from this section (`release-notes.mts`), so keep the heading's
   exact form.
3. Set the version in every version file in the table. In
   `package-lock.json`, change only the matching `version` lines (the root
   and `packages/cli` entries for the app, `packages/vscode-extension` for
   the extension). A local `npm install` also flips unrelated `peer`
   flags: restore those lines from `main`, and never run `npm dedupe`.
4. Extension only: `engines.vscode` must be `^<current stable VS Code
   major.minor>.0`, and the root README's "VS Code X.Y or later" must
   agree. The workflow checks this against VS Code's update API at tag
   time and fails otherwise.
5. Record the release in the same PR: the phase plan's status line and
   [implementation-plan-gantt.md](implementation-plan-gantt.md).
6. Merge. The merge commit on `main` is the release commit: the checks in
   step 2 run on it and the tag goes on it. If other PRs merge after it,
   still tag the release commit, not `main`'s head; their changes belong
   to the next release's `[Unreleased]`.

## 2. Checks before tagging

Run these on the release commit, with a clean tree:

```sh
git fetch origin && git switch --detach <release-commit>
npm ci && npm run build
```

- **App dry run.** The workflow's manual run executes the whole build job
  (lint, typecheck, unit tests, web and MCP Apps Playwright suites,
  `npm audit`, pack, `.mcpb` build, both smoke tests, publish dry run) and
  skips publishing. It runs on a branch head, so point a branch at the
  release commit first:

  ```sh
  git push origin <release-commit>:refs/heads/release/app-vX.Y.Z
  gh workflow run release-app.yml --ref release/app-vX.Y.Z
  ```

  Delete the branch afterwards.
- **Real-data check (owner).** `npm run test:real-data` runs the
  real-log suites (subagent credits, savings, pi, replay, cost by project,
  allowance, tool audit, Claude Code subagents) against the owner's logs.
  1.0.0 required it; run it for any release that changes a log reader,
  pricing, savings, the allowance or the audit. Don't paste its figures
  into public PRs or docs.
- **Real-Copilot suite (owner, extension only).** The workflow refuses a
  tag whose commit has no passing run recorded under
  `refs/notes/release-ui`
  ([plans/release-ui-gate.md](plans/release-ui-gate.md), D1):

  ```sh
  COPILOT_E2E=1 COPILOT_E2E_USER_DATA_DIR=~/.cache/aica-copilot-e2e/user-data \
    xvfb-run -a npm run test:ui:vscode:copilot --workspace=packages/vscode-extension
  npm run release:evidence --workspace=packages/vscode-extension
  git push origin refs/notes/release-ui
  ```

  - It takes about half an hour and must end with `PASS`. Any skipped
    required test fails the gate (D9).
  - `COPILOT_E2E_MAX_AI_CREDITS` caps the spend (default 3, D12).
  - The test profile is described in
    [plans/vscode-ui-automation.md](plans/vscode-ui-automation.md) §7.
  - After a VS Code update, first run it with
    `COPILOT_E2E_MAX_AI_CREDITS=0`, which sends no chat, to confirm the
    chat model before a paid run. VS Code 1.146 changed the default chat
    harness (risk R5).
  - The note is tied to the commit, so a run on any other commit doesn't
    count.
- **Time of day.** Don't start CI or the release workflow between 00:00
  and 01:15 UTC: tests with "today" fixtures fail then. Rerun later rather
  than patching them.

## 3. Tag and publish (owner)

```sh
git tag app-vX.Y.Z <release-commit>    # or ext-vX.Y.Z
git push origin app-vX.Y.Z
```

Then approve the `release` environment in the workflow run. To release
both products, push both tags; the workflows run separately.

**App (`release-app.yml`):**

- **build:**
  - Checks that the tag names the version in all three app version
    files.
  - Runs the same checks as the dry run.
  - Packs once and records SHA-256 checksums.
- **publish** (environment `release`):
  - Verifies the checksums, so it publishes exactly the tarball that was
    tested.
  - Checks that the owner is the npm package's only maintainer.
  - Publishes to npm through trusted publishing; no token exists.
  - Publishes the alias if its version is new.
  - Creates the GitHub Release with the tarball and the `.mcpb` bundle.
- **mcp-registry:** lists the version in the MCP Registry through GitHub
  OIDC. A failure only warns; rerun this job later.

**Extension (`release-extension.yml`):**

- **build:**
  - Fetches and checks the real-Copilot evidence note.
  - Checks the tag against the version and `engines.vscode`.
  - Runs lint, typecheck, build, unit, integration, UI and wdio suites,
    and the MCP Apps Playwright suite.
  - Packages the `.vsix`, with `--pre-release` on an odd minor.
- **publish** (environment `release`):
  - Publishes to the Marketplace through an Azure federated credential.
  - Publishes to Open VSX through trusted publishing.
  - Creates the GitHub Release with the `.vsix`.

## 4. After publishing

- App:
  - `npx agent-cost-analyzer@X.Y.Z --version` prints the version.
  - `npm view agent-cost-analyzer@X.Y.Z dist.attestations` shows the
    provenance.
  - The GitHub Release has the tarball and
    `agent-cost-analyzer-X.Y.Z.mcpb`.
  - The [MCP Registry](https://registry.modelcontextprotocol.io) lists
    `io.github.raulkivi/agent-cost-analyzer` at X.Y.Z.
- Extension: the Marketplace and Open VSX list X.Y.Z on the expected
  channel.
- A release-record PR marks the release done in the Gantt and the phase
  plan, if the bump PR could not.

## When something fails

- **Flaky job:** rerun the failed job from the workflow run.
- **Before publish** (build job red): fix on `main` through a PR. If the
  fix changes what ships, it needs a new release commit. Delete the
  unpublished tag (`git push origin :refs/tags/app-vX.Y.Z`; owner only)
  and tag the new release commit.
- **After npm or the Marketplace accepted the version:** that version
  number is spent. Release the fix as the next patch version.
- **MCP Registry job warned:** rerun the `mcp-registry` job from the
  workflow run.
