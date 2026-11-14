# pi coding-agent LogProvider — working notes

**Last changed:** 2026-11-14 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Internal engineering summary of the `PiAgentLogProvider`, kept alongside the
authoritative description in
[architecture.md §6.2.5](../architecture.md#625-pi-agent-provider-flow).
This doc exists to speed up the *next* round of work on this provider —
what it does, where the code lives, what changed most recently, and what's
still open.

## What it is

A third `LogProvider` (alongside VS Code and mitmproxy) that reads the
[pi coding agent](https://pi.dev)'s own JSONL session format directly —
`~/.pi/agent/sessions/--<cwd-with-slashes-as-dashes>--/<timestamp>_<uuid>.jsonl`
— with no OS-level store dependency and no vendor wire-protocol decoding,
since pi already normalizes token usage per message.

pi sessions are a **branchable tree** (fork/rewind create sibling entries
sharing an ancestor), not a linear history. Because `Session.turns` must
stay a flat array, the provider produces one `Session` per leaf branch —
the same "one file → N sessions" precedent as the mitmproxy provider's
idle-gap split.

## Code map

| File | Role |
|---|---|
| [pi-agent-log-provider.ts](../../packages/server/src/data-sources/pi-agent/pi-agent-log-provider.ts) | The `LogProvider` implementation — `listSessions`, `readSession`, `readTurnDetail`, `checkAvailability` |
| [pi-jsonl-reader.ts](../../packages/server/src/data-sources/pi-agent/pi-jsonl-reader.ts) | Parses raw JSONL lines into `PiSessionHeader` / `PiRawEntry` |
| [session-tree.ts](../../packages/server/src/data-sources/pi-agent/session-tree.ts) | `findLeafEntryIds` / `walkBranch` — tree reconstruction from `parentId` links |
| [session-id.ts](../../packages/server/src/data-sources/pi-agent/session-id.ts) | `computePiFileHash` / `computeBranchSessionId` — session IDs use a `__branch__` separator (pi's leaf ids are already uuids) |
| [turn-grouper.ts](../../packages/server/src/data-sources/pi-agent/turn-grouper.ts) | `groupBranchEntriesByUserMessage` — groups a branch into turns, mirroring the VS Code provider's grouping |
| [usage-extractor.ts](../../packages/server/src/data-sources/pi-agent/usage-extractor.ts) | Sums every usage carrier in a turn (assistant, toolResult, `usage` entries, compaction, branch_summary) into `uncachedInput`/`output`/`cacheRead`/`cacheWrite`/`reasoning`; also extracts tool calls |
| [pi-message.ts](../../packages/server/src/data-sources/pi-agent/pi-message.ts) | Type guards/accessors for pi's message shapes (`PiAssistantMessage`, `PiToolResultMessage`, `PiToolCallBlock`) |
| [turn-inspector-builder.ts](../../packages/server/src/data-sources/pi-agent/turn-inspector-builder.ts) | Builds `TurnInspectorDetail` from a turn's raw entries (Analyze-mode drill-down) |
| [resolve-pi-agent-sessions-dir.ts](../../packages/server/src/platform/pi-agent-paths/resolve-pi-agent-sessions-dir.ts) | Locates `~/.pi/agent/sessions/` and lists session files for the current cwd |
| [resolve-pi-system-prompt-log-path.ts](../../packages/server/src/platform/pi-agent-paths/resolve-pi-system-prompt-log-path.ts) | Resolves the optional `pi-system-prompt-logger` sidecar log path (`PI_SYSTEM_PROMPT_LOG_PATH` env override, else `~/.pi/agent/logs/system-prompts.jsonl`) |
| [system-prompt-sidecar-reader.ts](../../packages/server/src/data-sources/pi-agent/system-prompt-sidecar-reader.ts) | Reads the sidecar JSONL into a `Map` keyed by resolved `sessionFile` path, keeping every record of a file in `capturedAt` order; `system-prompt-sidecar-matcher.ts` picks one per branch (PR #279) |
| [system-message-replay.ts](../../packages/server/src/data-sources/pi-agent/system-message-replay.ts) | `replaySystemMessages` — replays a branch's `role: "system"` messages (and compaction checkpoints) into the current prompt text, sections and tools, like pi-ai's `getCurrentSystemMessage` |
| [system-prompt-components.ts](../../packages/server/src/data-sources/pi-agent/system-prompt-components.ts) | `buildPiSystemPromptComponentsFromState` (in-file system prompt) and `buildPiSystemPromptComponents` (sidecar fallback) → `SystemPromptComponent[]`, mirroring `buildSystemPromptBreakdown`'s VS Code shape |
| `packages/server/fixtures/pi-agent/*.jsonl` | Test fixtures: `schema-v3-session` (follows the published schema in the vendored package: system messages, `arguments`, `thinking`, toolResult usage, a `cache_warm` usage entry, a compaction with usage and `systemMessage`), plus the older hand-authored `normal-session`, `forked-session`, `malformed-lines-session`, `no-usage-session`. No static sidecar-log fixture exists — its `sessionFile` would be checkout-path-dependent, so tests synthesize one into a tmpdir instead |

Each `.ts` above has a matching `.test.ts` (TDD-first, per `architecture.md`
§11.4); `pi-agent-log-provider.test.ts` also runs the shared
`describeLogProviderContract` conformance suite.

## System prompt and tool inventory: in-file first, sidecar fallback

pi persists the prompt and tool loadout in the session file as
`role: "system"` messages (vendored `docs/session-format.md`
"SessionMessageEntry"). `system-message-replay.ts` replays them along the
branch, and `Session.systemPrompt` (base content + one component per named
section + tool definitions, all with real tokenizer estimates),
`Session.toolInventory` (every tool declared on the branch, with the turns
that invoked it) and `readSystemPromptText` all come from that when present.

Older session files without system messages fall back to the sidecar:
`Session.systemPrompt` is populated, conditionally, since Phase 9.8: the
vendored `packages/pi-system-prompt-logger` extension (Phase 9.7, not part
of pi itself) captures the fully assembled system prompt plus selected
tools/skills/context files to a JSONL sidecar log
(`~/.pi/agent/logs/system-prompts.jsonl`) from outside pi's own session
format. When a user has installed it (`npm run configure` offers to) and a
session's file has a matching captured record,
`pi-agent-log-provider.ts` reads it via `system-prompt-sidecar-reader.ts`
(joined on resolved `sessionFile` path — see architecture.md §6.2.5 for the
full join-key reasoning; since PR #279 a branch uses the latest record
captured at or before its last entry, else the earliest)
and builds `SystemPromptComponent[]` via `system-prompt-components.ts`.

Knock-on effects in the UI for pi sessions:

- `components/SystemPromptBreakdown` renders real meter rows when a match
  exists, same as any other provider. With no match, its empty-state text
  is pi-agent-specific ("No system prompt captured for this session yet —
  open the system prompt inspector for how to enable it"), distinct from
  mitmproxy's permanent "this provider does not capture..." message.
- Unlike other providers, its "Open system prompt inspector" button
  **always** renders for `pi-agent` sessions (not gated on a `built-in`
  component being present) — so the inspector itself can explain what to
  do when there's no capture yet.
- `components/SystemPromptInspector` fetches through the same
  `GET /api/sessions/:id/system-prompt` route VS Code uses;`app.ts` branches
  on `registry.getActiveProviderId() === "pi-agent"` before reaching the
  VS-Code-only session-store path, delegating to a new
  `PiAgentLogProvider.readSystemPromptText(sessionId)` method (not on the
  shared `LogProvider` interface — ISP, matching the existing
  VS-Code-special-case precedent). On success the real captured text
  renders identically to a VS Code prompt (Pretty/Raw/Icicle — that
  rendering machinery is already provider-agnostic, no changes needed
  there). On no match, the inspector shows a plain-text (no link — an
  earlier "link to the extension's README" idea was explicitly rejected)
  message pointing at `npm run configure` as the install path, instead of
  the VS Code-specific hint.
- `npm run configure`/`unconfigure` (`scripts/install.sh`/`uninstall.sh`)
  interactively offer to build (`npm run bundle
  --workspace=packages/pi-system-prompt-logger`) and install/remove
  `~/.pi/agent/extensions/pi-system-prompt-logger.js` — this is the actual
  install mechanism; the UI never links to the extension's own README.

## Most recent change (2026-10-09, schema verification)

Checked the provider against the published schema shipped in the vendored
`@earendil-works/pi-coding-agent` 0.87.1 (`docs/session-format.md`,
`docs/message-types.md`, pi-ai `dist/types.d.ts`) and fixed what it
dropped: top-level `usage` entries, optional usage on toolResult/compaction/
branch_summary, `Usage.reasoning`, `ToolCall.arguments`,
`ThinkingContent.thinking`, and the in-file system prompt/tool loadout. See
architecture.md §6.2.5 for the attribution rules.

## Earlier change (2026-09-04, Phase 9.8)

Wired `PiAgentLogProvider` to optionally read the `pi-system-prompt-logger`
sidecar log vendored in Phase 9.7, per two explicit UX requirements: the
system prompt inspector shows the real captured prompt when a sidecar
record matches, and a plain-text (no link) "run `npm run configure`"
message when it doesn't.

- [system-prompt-sidecar-reader.ts](../../packages/server/src/data-sources/pi-agent/system-prompt-sidecar-reader.ts) /
  [system-prompt-components.ts](../../packages/server/src/data-sources/pi-agent/system-prompt-components.ts) /
  [resolve-pi-system-prompt-log-path.ts](../../packages/server/src/platform/pi-agent-paths/resolve-pi-system-prompt-log-path.ts) —
  new, TDD-first (see Code map above)
- [pi-agent-log-provider.ts](../../packages/server/src/data-sources/pi-agent/pi-agent-log-provider.ts) —
  `PiAgentLogProviderOptions.systemPromptLogPath`, sidecar-index threading
  through `buildSessionForBranch`/`listSessions`/`readSession`, new
  `readSystemPromptText(sessionId)` method
- [app.ts](../../packages/server/src/app.ts) — `GET
  /api/sessions/:id/system-prompt` branches on
  `registry.getActiveProviderId() === "pi-agent"`
- [SystemPromptBreakdown.tsx](../../packages/web/src/components/SystemPromptBreakdown.tsx) —
  button gate becomes `hasBuiltIn || providerId === "pi-agent"`; new
  pi-agent-specific empty-state text
- [SystemPromptInspector.tsx](../../packages/web/src/components/SystemPromptInspector.tsx) /
  [App.tsx](../../packages/web/src/App.tsx) — new `providerId` prop,
  threaded through, branches the fetch-failure message
- [scripts/install.sh](../../scripts/install.sh) /
  [scripts/uninstall.sh](../../scripts/uninstall.sh) — interactive
  build+install / remove of the extension via `npm run configure`/
  `unconfigure`, independent of and non-fatal to the existing alias setup

Full server suite (439 tests) and full web suite (284 tests) pass after the
change; `install.sh`/`uninstall.sh` verified manually (no automated harness
exists for shell scripts in this repo).

## Previous change (2026-09-02, ~23:29 UTC)

Bug report: the "System prompt" tab showed a confusing empty state for pi
sessions — the fallback message told the user to "enable
agentDebugLog.fileLogging.enabled and reload VS Code," which is a VS Code
setting that doesn't apply to pi (or mitmproxy) sessions at all. Fix:
`SystemPromptBreakdown` gained an optional `providerId` prop (wired from
`session.providerId` in `App.tsx`) and a provider-neutral message for any
non-`vscode` session — since superseded by the pi-agent-specific message
above.

## Capturing a real session for Phase 11

Tooling for 1.0 task V12; the capture itself is V13 (owner step), the fixtures
V14. Never commit or share an unredacted file: sessions hold prompts, tool
output and file contents.

1. **Install the logger.** Confirm `~/.pi/agent/extensions/pi-system-prompt-logger.js`
   exists. If not, build and copy it
   ([package README](../../packages/pi-system-prompt-logger/README.md#install)):
   `npm run bundle --workspace=packages/pi-system-prompt-logger`, then copy
   `packages/pi-system-prompt-logger/dist/pi-system-prompt-logger.js` into
   `~/.pi/agent/extensions/` and run `/reload` in pi.
2. **Use a throwaway directory with no secrets**, for example
   `mkdir ~/pi-capture-demo && cd ~/pi-capture-demo` with a few harmless files
   (`git init`, a small `hello.ts`). Do not run pi in a real project.
3. **Session A, linear.** Run `pi`. Send 3 to 5 prompts; at least one must make
   pi call a tool (for example "read hello.ts and summarise it"). Exit pi.
4. **Session B, rewind.** Run `pi` again and send 3 prompts with at least one
   tool call. Then run `/tree` (pi's session tree navigator), select an
   earlier user message, edit its text and submit it. This creates a second
   branch in the same file, which is the case the sidecar rule (PR #279) and
   fork tagging need. Answer the "summarize the branch you leave" prompt with
   yes, so the file gets a `branch_summary` entry. Send one more prompt on the
   new branch and exit. (`/fork` instead makes a new file with a
   `parentSession` header; `/tree` is the in-file case this task wants. Source:
   pi's `docs/sessions.md` and `docs/session-format.md`, checked 2026-11-14.
   The exact `/tree` key presses were not run by the task author; if the
   prompts differ in your pi version, any way of leaving a branch and
   continuing from an earlier message is fine.)
5. **Find the files.** Sessions: `~/.pi/agent/sessions/--<cwd with slashes as dashes>--/<timestamp>_<uuid>.jsonl`
   (`ls -t ~/.pi/agent/sessions/*demo*/ | head`). Sidecar log:
   `~/.pi/agent/logs/system-prompts.jsonl`, one record per session.
6. **Redact each session** from the repo root:

   ```bash
   npm run fixtures:redact-pi -w packages/server -- \
     ~/.pi/agent/sessions/<dir>/<session-A>.jsonl \
     --sidecar ~/.pi/agent/logs/system-prompts.jsonl \
     --name pi-linear --out ~/pi-redacted
   # same for session B with --name pi-rewind
   ```

   The CLI copies only that session's sidecar records, runs a leak scan and a
   check that the pi provider reads the redacted copy like the original, and
   writes nothing if either fails. It prints counts and key names only.
7. **Inspect.** Run
   `grep -rniE "$USER|$(hostname)|/home/|@" ~/pi-redacted` : the only hits
   should be `/home/user/...` and `user@example.com`. Open the files in an
   editor if you want; every prompt, answer and tool output is placeholder
   text of the same length. Add `--mask <word>` and re-run for anything else
   private (a client name that sits in a kept field, say).
8. **Hand over** the four files in `~/pi-redacted` (`pi-linear.jsonl`,
   `pi-linear.system-prompts.jsonl`, `pi-rewind.jsonl`,
   `pi-rewind.system-prompts.jsonl`) to the main session. Never hand over or
   commit files from `~/.pi/agent`.

### What the redaction CLI keeps and replaces

Source: `packages/server/scripts/redact-pi-capture-lib.mts` (rules in its
header; unit-tested).

- **Kept byte-for-byte:** all numbers, booleans and nulls (usage, token and
  cost figures, epoch timestamps); all keys; string values under structural
  keys (`type`, `id`, `parentId`, `timestamp`, `role`, `api`, `provider`,
  `model`, `modelId`, `stopReason`, `name`, `toolName`, `toolCallId`, `kind`,
  `thinkingLevel`, `customType`, `fromId`, `firstKeptEntryId`, `targetId`,
  `sessionId`, `capturedAt`, `required`, `mimeType`, `selectedTools`,
  `skillNames`, `contextFilePaths`).
- **Replaced with same-length placeholder text:** every other string: user
  prompts, assistant text, thinking and its signature, tool arguments and
  results, file contents, summaries, tool descriptions, system-prompt text and
  sections. Each word becomes a deterministic pronounceable word of the same
  length; spaces, tabs and line breaks stay, so sizes and line structure hold.
  Unknown string fields are replaced too, and listed by key name in the
  output.
- **Masked everywhere kept:** `cwd` and the capture directory become
  `/home/user/project`; `/home/<name>` and `/Users/<name>` become `/home/user`;
  usernames `user`; hostnames `host`; emails `user@example.com`; secrets
  `[REDACTED]` (`redactSecrets`).
- **Sidecar:** `systemPrompt` is redacted so pi's in-file sections appear
  verbatim-redacted inside it, which keeps the PR #279 combine logic matching;
  `sessionFile` becomes `/home/user/.pi/agent/sessions/--home-user-project--/<name>.jsonl`
  (the V14 test rewrites it to the fixture path, as `readSystemPromptSidecarIndex`
  joins on it); `systemPromptChars` is unchanged because lengths are.
- **Not preserved:** the token estimates the app computes over text (they
  tokenise placeholder words differently). Real usage figures from pi are
  preserved exactly.
- **Verify step:** the CLI reads the original and the redacted copy through
  `PiAgentLogProvider` and compares branch count, turns per branch, per-turn
  usage, tool names, fork tagging and system-prompt component labels (which
  carry the character counts). A unit test runs the same check on
  `schema-v3-session.jsonl`. The real check happens in V14.

## Open items (pending real-data verification)

Per architecture.md §6.2.5, this provider is now verified against pi's
published schema as shipped in the vendored package, but still not pinned
against a real, redacted captured session. Until one is obtained:

- `tool`, `vision` token counts stay `{ known: false }` — confirmed: pi's
  `Usage` has no field for them.
- `costAiCredits` (per-turn and session-level) stays permanently
  `{ known: false }` — AI Credits is Copilot's own billing unit with no
  defined conversion for pi's own cost figures (may never be resolvable).
- Non-assistant usage is attributed to the turn whose span contains it; a
  `branch_summary`'s usage therefore lands on the previous turn of the new
  branch. Whether it should count toward the following turn instead is a
  judgement call worth revisiting with real data.
- Fork vs. rewind is approximate: any turn following a tree branch point is
  tagged `triggeredEvent: "fork"`; a real `branch_summary` entry's more
  specific intent isn't distinguished yet.

**Next step for real-data verification** (implementation-plan.md
Phase 11): obtain one redacted real
`~/.pi/agent/sessions/**/*.jsonl` capture, diff its actual field names
against the fixtures in `packages/server/fixtures/pi-agent/`, and update the
extractors + this doc + architecture.md §6.2.5 together once confirmed.

**`packages/pi-system-prompt-logger`** (vendored Phase 9.7, consumed
starting Phase 9.8 — see "System prompt" section above) is a candidate tool
for unblocking this: installing it into a real pi session and running a
turn captures a real `sessionId` and `~/.pi/agent/sessions/**/*.jsonl` file
side by side with its own `system-prompts.jsonl` record, giving both the
real-session-format capture this section needs *and* a real look at
`selectedTools`/`skillNames`/`contextFilePaths`/`sessionId`-vs-`header.id`
semantics — the last of which Phase 9.8's `sessionFile`-based join
deliberately sidesteps rather than resolves (see architecture.md §6.2.5).
The rule for a forked/rewound session's records is decided (PR #279,
2026-11-14): a branch uses the latest record captured at or before its
last entry, else the earliest. A real fork capture confirms it. Phase 11
is required for 1.0.0 (owner, 2026-11-14).
