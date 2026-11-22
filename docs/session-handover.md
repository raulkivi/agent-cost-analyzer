# Session handover

**Last changed:** 2026-11-22 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Where the work stands at the end of the 2026-11-10 to 2026-11-12 sessions, for whoever picks it up next. Status of record stays in [implementation-plan-gantt.md](implementation-plan-gantt.md) and the plans under [plans/](plans/).

## Where things stand

- `main` at #240 (`1d372f0`), no open PRs.
- **Phase 12 (MCP Apps) is done.** Increment 2 shipped in extension 0.6.0 and app 0.11.0 (2026-11-11); Increment 3 shipped in extension 0.8.0 (VS Code Marketplace, Open VSX, GitHub) and app 0.12.0 (2026-11-12), tags `ext-v0.8.0` and `app-v0.12.0` on `dacf3ed`. The real-Copilot release gate passed 33 of 33 required tests. Details: [mcp-apps.md](https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/mcp-apps.md), [mcp-apps-handover.md](https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/mcp-apps-handover.md).
- **Step 10.17, the automated pre-release UI gate, is done** ([plans/release-ui-gate.md](plans/release-ui-gate.md)): no hand checklist gates a release. VS Code and Copilot checks are wdio specs, web checks are Playwright specs. Decisions D1–D12 are recorded there.
  - A ruleset on `main` requires 9 CI checks (`extension-ui`, `web-e2e`, `mcp-apps-e2e`, `test`, `extension`, `scan`, both CodeQL Analyze jobs, `CodeQL`); repository admins may bypass.
  - Docs-only PRs skip the heavy UI and integration jobs; `test` always runs.
- **Step 10.18 is done:** Copilot Chat sessions from a window with no folder open now appear (#209).
- The root README is user-oriented; the developer documentation index is [README.md](README.md) in this folder.
- **App 1.1.0 and 1.2.0 released 2026-11-19** (tags `app-v1.1.0` on `39ccdac8`, `app-v1.2.0` on `b9d51db5`): Phase 18 MCP client setup, Increment 1 in 1.1.0 and Increments 2 and 3 in 1.2.0. The owner's MC18 install check passed 2026-11-20; only MC22, the GitHub MCP Registry listing (owner), is left ([plans/mcp-client-setup.md](plans/mcp-client-setup.md)). Later releases follow the [release guide](release.md).
- **Extension 0.10.0 and app 0.13.0 released 2026-11-12** (tags `ext-v0.10.0`, `app-v0.13.0` on `1d372f0`): the MCP SDK 2 and ext-apps 2.x migration ([mcp-sdk-2-migration.md](https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/mcp-sdk-2-migration.md)) and the keyboard-focus fix in the MCP App views. Real-Copilot gate 33 of 33.

## Releasing

See the [release guide](release.md).

## Open decisions for the owner

Decided 2026-11-14 ([1.0.0 release](implementation-plan.md#100-release)):

- **U5's "Sent" label:** U5 and U2 read "Added to chat", with the hint "Press send in the chat to run it." (a 1.0 task; [mcp-apps.md](https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/mcp-apps.md) §6.1).
- **Claude Desktop permission prompts:** risk R4 accepted, no gate row (§6.1).
- **A download for the standalone app:** the npm package `agent-cost-analyzer`, run as `npx agent-cost-analyzer` (a 1.0 criterion).
- **`ext-v*` and `app-v*` tag protection** and **Open VSX trusted publishing** (delete `OVSX_PAT`): 1.0 criteria ([threat-model.md](threat-model.md) §5.8).

Still open: code-owner review on `main` (§5.8; not a 1.0 criterion).

## Follow-ups (not scheduled)

- U12's row hover puts muted text at 4.38:1 on Dark Modern; VS Code's callout backgrounds aren't in the recorded theme sets (§6.1).
- Watch CI for the `a16-session-views` keyboard test. If it fails again, the focus fix didn't cover the cause.
- The real-Copilot suite tests VS Code's local chat harness only; sessions from the Copilot SDK harness (VS Code 1.146's default) aren't covered there.
- Phase 12 follow-ups ([mcp-apps.md](https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/mcp-apps.md) §11): views U16/U17, shorter tool text for clients that show views, Learn cards in chat, a one-click "Open" from U1.

## Next candidates

- **Phase 11**, pi provider real-capture verification ([implementation-plan.md](implementation-plan.md)): needs two real, redacted pi sessions from the owner's machine. First step: write the capture instructions.
- **Owner reviews still open:** Phase 13 (13.8 eyes-on review), Phase 14 (14.8 docs and the exit criterion on real sessions), Phase 15 (docs review and the exit criterion on real data).

## Working notes

- Merge PRs only on the owner's request; never approve the `release` environment for the owner.
- When one PR is stacked on another, retarget the child to `main` before the parent merges; deleting the parent's branch closes the child.
- Agent runs of the real-Copilot suite: `env -u WAYLAND_DISPLAY xvfb-run -a -s "-screen 0 1600x1000x24"`, a credit cap, and reset `refs/notes/release-ui` afterwards; never push notes from an agent run.
- No local model in this repository; implementation runs in Claude subagents, each in its own worktree, started from the repository root.
