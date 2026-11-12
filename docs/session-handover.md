# Session handover

**Last changed:** 2026-11-12 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Where the work stands at the end of the 2026-11-10 to 2026-11-12 sessions, for whoever picks it up next. Status of record stays in [implementation-plan-gantt.md](implementation-plan-gantt.md) and the plans under [plans/](plans/).

## Where things stand

- `main` at #240 (`1d372f0`), no open PRs.
- **Phase 12 (MCP Apps) is done.** Increment 2 shipped in extension 0.6.0 and app 0.11.0 (2026-11-11); Increment 3 shipped in extension 0.8.0 (VS Code Marketplace, Open VSX, GitHub) and app 0.12.0 (2026-11-12), tags `ext-v0.8.0` and `app-v0.12.0` on `dacf3ed`. The real-Copilot release gate passed 33 of 33 required tests (1.54 AI Credits). Details: [plans/mcp-apps.md](plans/mcp-apps.md), [plans/mcp-apps-handover.md](plans/mcp-apps-handover.md).
- **Step 10.17, the automated pre-release UI gate, is done** ([plans/release-ui-gate.md](plans/release-ui-gate.md)): no hand checklist gates a release. VS Code and Copilot checks are wdio specs, web checks are Playwright specs. Decisions D1–D12 are recorded there.
  - A ruleset on `main` requires 9 CI checks (`extension-ui`, `web-e2e`, `mcp-apps-e2e`, `test`, `extension`, `scan`, both CodeQL Analyze jobs, `CodeQL`); repository admins may bypass.
  - Docs-only PRs skip the heavy UI and integration jobs; `test` always runs.
- **Step 10.18 is done:** Copilot Chat sessions from a window with no folder open now appear (#209).
- The root README is user-oriented; the developer documentation index is [README.md](README.md) in this folder.
- **Extension 0.10.0 and app 0.13.0 released 2026-11-12** (tags `ext-v0.10.0`, `app-v0.13.0` on `1d372f0`): the MCP SDK 2 and ext-apps 2.x migration ([plans/mcp-sdk-2-migration.md](plans/mcp-sdk-2-migration.md)) and the keyboard-focus fix in the MCP App views. Real-Copilot gate 33 of 33, 1.55 AI Credits.

## Releasing the extension

1. A version-bump PR (even minor for a stable release), merged.
2. On the merged commit, with a clean tree: `npm run build`.
3. The real-Copilot suite on the owner's machine (signed-in test profile, see [plans/vscode-ui-automation.md](plans/vscode-ui-automation.md) §7): 33 required tests, about 26 minutes, about 1.6 AI Credits, capped at 3 by `COPILOT_E2E_MAX_AI_CREDITS`. It must end with `PASS`.
4. `npm run release:evidence --workspace=packages/vscode-extension`, then `git push origin refs/notes/release-ui`.
5. Tag the same commit `ext-v<version>` (and `app-v<version>` for the app), push the tags, and approve the `release` environment.

Before tagging, check that `engines.vscode` still matches the current stable VS Code (D9). A new VS Code version can break the real-Copilot suite (risk R5): VS Code 1.146 changed the default chat harness, which the suite now pins. After a VS Code bump, confirm the chat model with a run that sends no chat before a paid run.

## Open decisions for the owner

- **U5's "Sent" label.** In VS Code 1.146, pressing Analyse puts `Analyse session <id>` into the chat input without sending it, and the view can't tell that apart from a send ([plans/mcp-apps.md](plans/mcp-apps.md) §6.1).
- **Claude Desktop permission prompts** for calls a view makes. A fake host can only show that a drill-down is one plain `tools/call` (§6.1).
- **A download for the standalone app.** Today users clone the repository and run `npm start`.
- **Repository protections**, open since 2026-11-06 ([threat-model.md](threat-model.md) §5.8): code-owner review on `main`, `ext-v*` tag protection, `release` environment reviewers, CODEOWNERS for `fixtures/` and `services/pricing/`.
- **Open VSX trusted publishing:** register the trusted publisher, switch the release workflow to `--trusted-publishing`, and delete the `OVSX_PAT` secret.

## Follow-ups (not scheduled)

- U12's row hover puts muted text at 4.38:1 on Dark Modern; VS Code's callout backgrounds aren't in the recorded theme sets (§6.1).
- Watch CI for the `a16-session-views` keyboard test. If it fails again, the focus fix didn't cover the cause.
- The real-Copilot suite tests VS Code's local chat harness only; sessions from the Copilot SDK harness (VS Code 1.146's default) aren't covered there.
- Phase 12 follow-ups ([plans/mcp-apps.md](plans/mcp-apps.md) §11): views U16/U17, shorter tool text for clients that show views, Learn cards in chat, a one-click "Open" from U1.

## Next candidates

- **Phase 11**, pi provider real-capture verification ([implementation-plan.md](implementation-plan.md)): needs two real, redacted pi sessions from the owner's machine. First step: write the capture instructions.
- **Owner reviews still open:** Phase 13 (13.8 eyes-on review), Phase 14 (14.8 docs and the exit criterion on real sessions), Phase 15 (docs review and the exit criterion on real data).

## Working notes

- Merge PRs only on the owner's request; never approve the `release` environment for the owner.
- When one PR is stacked on another, retarget the child to `main` before the parent merges; deleting the parent's branch closes the child.
- Agent runs of the real-Copilot suite: `env -u WAYLAND_DISPLAY xvfb-run -a -s "-screen 0 1600x1000x24"`, a credit cap, and reset `refs/notes/release-ui` afterwards; never push notes from an agent run.
- No local model in this repository; implementation runs in Claude subagents, each in its own worktree, started from the repository root.
