# pi coding-agent LogProvider — working notes

**Last changed:** 2026-11-16 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

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
| [context-edits.ts](../../packages/server/src/data-sources/pi-agent/context-edits.ts) | `latestContextEdits` (latest `context_edit` per target on a branch) and `contextEditFor` (the inspector's "omitted"/"replaced" mark) |
| [resolve-pi-agent-sessions-dir.ts](../../packages/server/src/platform/pi-agent-paths/resolve-pi-agent-sessions-dir.ts) | Locates `~/.pi/agent/sessions/` and lists session files for the current cwd |
| [resolve-pi-system-prompt-log-path.ts](../../packages/server/src/platform/pi-agent-paths/resolve-pi-system-prompt-log-path.ts) | Resolves the optional `pi-system-prompt-logger` sidecar log path (`PI_SYSTEM_PROMPT_LOG_PATH` env override, else `~/.pi/agent/logs/system-prompts.jsonl`) |
| [system-prompt-sidecar-reader.ts](../../packages/server/src/data-sources/pi-agent/system-prompt-sidecar-reader.ts) | Reads the sidecar JSONL into a `Map` keyed by resolved `sessionFile` path, keeping every record of a file in `capturedAt` order; `system-prompt-sidecar-matcher.ts` picks one per branch (PR #279) |
| [system-message-replay.ts](../../packages/server/src/data-sources/pi-agent/system-message-replay.ts) | `replaySystemMessages` — replays a branch's `role: "system"` messages (and compaction checkpoints) into the current prompt text, sections and tools, like pi-ai's `getCurrentSystemMessage`; since savings Increment 3 V27 also `toolHistory`: each declared tool's last definition and the requests it was declared for |
| [shared-prefix.ts](../../packages/server/src/data-sources/pi-agent/shared-prefix.ts) | `sharedPrefixRequests` — the leading requests a branch shares with an earlier branch of its file, in leaf order (`Session.sharedPrefixRequests`; savings D27) |
| [system-prompt-components.ts](../../packages/server/src/data-sources/pi-agent/system-prompt-components.ts) | `buildPiSystemPromptComponentsFromState` (in-file system prompt) and `buildPiSystemPromptComponents` (sidecar fallback) → `SystemPromptComponent[]`, mirroring `buildSystemPromptBreakdown`'s VS Code shape |
| `packages/server/fixtures/pi-agent/*.jsonl` | Test fixtures: `schema-v3-session` (follows the published schema in the vendored package: system messages, `arguments`, `thinking`, toolResult usage, a `cache_warm` usage entry, a compaction with usage and `systemMessage`), plus the older hand-authored `normal-session`, `forked-session`, `malformed-lines-session`, `no-usage-session`. Tests write sidecar logs into a tmpdir, since the join key `sessionFile` is checkout-path-dependent |
| `packages/server/fixtures/pi-agent/generated/` | Sessions the real pi wrote with a local model, redacted, each with its `.system-prompts.jsonl` records, plus `manifest.json` (see "Generating pi fixtures"); read by `generated-fixtures.test.ts` and `scripts/pi-generated-fixtures.test.mts` |

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
Since savings Increment 3 V27 each inventory entry also has the definition
size the tool last had (a tool removed mid-session is no longer unknown) and
`loadedRequests`, the requests it was declared for, which the savings
report's unused-tools money uses (D34). A forked file's later branch counts
the requests it shares with an earlier branch in `sharedPrefixRequests`
and leaves them out of `loadedRequests`, so the report counts them once
(D27; [savings-increment-3.md](../plans/savings-increment-3.md) §7.1).

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

## Earlier change (2026-10-09, schema verification)

Checked the provider against the published schema shipped in the vendored
`@earendil-works/pi-coding-agent` 0.87.1 (`docs/session-format.md`,
`docs/message-types.md`, pi-ai `dist/types.d.ts`) and fixed what it
dropped: top-level `usage` entries, optional usage on toolResult/compaction/
branch_summary, `Usage.reasoning`, `ToolCall.arguments`,
`ThinkingContent.thinking`, and the in-file system prompt/tool loadout. See
architecture.md §6.2.5 for the attribution rules.

## Change of 2026-09-04 (Phase 9.8)

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

## Generating pi fixtures

The Phase 11 fixtures in `packages/server/fixtures/pi-agent/generated/` are
written by the owner's real pi with a local model, then redacted and
committed (owner decision 2026-11-14; replaces the manual capture, 1.0 task
V13). CI never runs a model: the server test suite reads only the committed
files (`src/data-sources/pi-agent/generated-fixtures.test.ts`,
`scripts/pi-generated-fixtures.test.mts`).

**Local-model exception.** The repo rule "no local model" has one exception:
running pi with the local model to generate these fixtures. One pi process
at a time, nothing else heavy on the model server meanwhile, never for
coding tasks.

**When to regenerate:** after a pi update (the manifest records the pi
version; drift shows up as failing provider tests), or when a scenario
changes.

```bash
npm run fixtures:generate-pi            # full run, 310 s idle gap
npm run fixtures:generate-pi -- --quick # no idle gap, for development
```

Options: `--scenarios s1,s3`, `--idle-seconds <n>`, `--provider`/`--model`
(default: `defaultProvider`/`defaultModel` from `~/.pi/agent/settings.json`),
`--pi <command>` (default: the first `pi` on `PATH` outside `node_modules`;
the repo's vendored pi is older), `--timeout-seconds <n>` per prompt
(default 900), `--out <dir>`, `--keep-temp` (keeps the unredacted temp home
for debugging; delete it after), `--gondolin`.

**What it does** (`packages/server/scripts/generate-pi-fixtures.mts`, pure
parts in `generate-pi-fixtures-lib.mts`):

1. Refuses to run in CI, checks the model server answers, and builds
   `pi-system-prompt-logger`.
2. Creates a temp home under the OS temp dir: an agent dir
   (`PI_CODING_AGENT_DIR`) holding a `models.json` with only the chosen
   provider and model (copied from `~/.pi/agent/models.json`), a
   `settings.json` with compaction on, and the logger in `extensions/`; a
   workspace with three harmless files (`hello.ts`, `notes.md`, `AGENTS.md`)
   and `git init`. It never copies `auth.json`, sessions, skills,
   `APPEND_SYSTEM.md` or other extensions. The logger writes to the temp dir
   (`PI_SYSTEM_PROMPT_LOG_PATH`); `PI_OFFLINE=1` and `--no-mcp` keep pi off
   the network.
3. Drives pi in RPC mode (`pi --mode rpc`, `docs/rpc.md`): one process at a
   time, a timeout per prompt, dialogs cancelled. A restart resumes the same
   file with `--session <file>` and a new `models.json`.
4. Redacts every session and its sidecar records with
   `redact-pi-capture-lib.mts` (`redactCapture`; the temp home is masked to
   `/home/user`), runs the leak scan and the provider check, and writes
   `<stem>.jsonl`, `<stem>.system-prompts.jsonl` and `manifest.json` (pi
   version, model, variant, date, idle gap, per-file counts; no paths). A
   failed check writes nothing. It prints counts only.

**Scenarios** (stems are fixed, so a rerun replaces the same files):

| Id | Stem | What pi does |
|---|---|---|
| S1 | `pi-linear` | 4 prompts with `read`, `bash` and `edit` calls (`write` stays unused) and an idle gap (default 310 s) between prompts 2 and 3 |
| S2 | `pi-compaction` | 2 prompts, a manual `/compact` (RPC `compact`), a prompt, then a restart whose context window is sized so pi's threshold check compacts around the next prompt |
| S3 | `pi-context-edit` | 2 prompts, then a restart with a window that leaves the next response about 300 output tokens, far below `maxTokens`: the response stops on `length`, and pi's recovery appends `context_edit` omissions and a compaction and retries (`docs/compaction.md` "Overflow and Length Recovery Ordering"). The run fails if the file has no `context_edit` |
| S4 | `pi-fork`, `pi-fork-parent` | 2 prompts, then RPC `fork` from the second prompt and a new prompt: a new file with a `parentSession` header. Synthetic coverage; the owner never forks. In-file `/tree` branching has no RPC command and is not generated |

Compaction keeps 64 recent tokens (`keepRecentTokens`), so these short
sessions have something to summarise. S2 and S3 run in two pi processes, so
their sidecars hold two records each, which exercises the PR #279 matcher.

**Gondolin variant** (`--gondolin`, off by default): loads
`~/.pi/agent/extensions/gondolin` with `-e`, so pi's tools run in the
Gondolin micro-VM, and writes to `generated/gondolin/`. It runs headless: Gondolin adds `find`, `grep` and `ls` to the tool set
and needed no dialog. Last run 2026-11-14: all four scenarios passed in
7.5 minutes, committed beside the default ones and covered by the same
manifest and contract tests.

**Last full run** (2026-11-14, pi 1.5.2, `llamacpp/qwen3.8-flash-next:setup6`, default variant):

| File | Turns | Tool calls | Compactions | `context_edit` | Sidecar records |
|---|---|---|---|---|---|
| `pi-linear` | 4 | 4 | 0 | 0 | 1 |
| `pi-compaction` | 4 | 2 | 2 | 0 | 2 |
| `pi-context-edit` | 3 | 1 | 1 | 1 | 2 |
| `pi-fork-parent` | 2 | 1 | 0 | 0 | 1 |
| `pi-fork` | 2 | 1 | 0 | 0 | 1 |

A full run takes about 7.5 minutes: S1 about 340 s (310 s of it the idle
gap), S2 to S4 under 2 minutes together. S2 was rerun alone afterwards
(`--scenarios s2`, 41 s). In S3 the retry after recovery stopped on `length` again, so pi
gave up after its one compact-and-retry attempt, as designed.

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
  (the generated-fixture test rewrites it to the fixture path, as `readSystemPromptSidecarIndex`
  joins on it); `systemPromptChars` is unchanged because lengths are.
- **Not preserved:** the token estimates the app computes over text (they
  tokenise placeholder words differently). Real usage figures from pi are
  preserved exactly.
- **Verify step:** the CLI reads the original and the redacted copy through
  `PiAgentLogProvider` and compares branch count, turns per branch, per-turn
  usage, tool names, fork tagging and system-prompt component labels (which
  carry the character counts). A unit test runs the same check on
  `schema-v3-session.jsonl`; the generator runs it on every generated file.

## Phase 11 results (2026-11-14, generated fixtures)

The provider ran test-first against the generated sessions
(`src/data-sources/pi-agent/generated-fixtures.test.ts`, which also runs
`describeLogProviderContract` over them). Every field it reads exists in
what pi 1.5.2 writes (a test pins the list), turn usage sums to every usage
carrier in each file, and the sidecar combine and PR #279 matcher work on
real records. Field-name diff against `schema-v3-session.jsonl`:

- New in real files, not read by the provider: `model_change` and
  `thinking_level_change` before the first prompt (they land in the first
  turn's `precedingEntries`), user content as `{type: "text"}` blocks,
  assistant `durationMs`/`rawStopReason`/`responseId`/`thinkingLevel`,
  `usage.cost.totalFromProvider`, tool-result `details` (edit diffs),
  compaction `details`/`fromHook`, tool declarations'
  `constrainedSampling`, and the header's `parentSession` on a fork.
- `context_edit` entries were not handled. The turn inspector printed them
  (and a compaction between two rounds) as raw JSON under "Added messages".
  Fixed: see below.
- The generated files carry no `usage` entries (pi warms no cache for a
  local model) and no tool-result usage; the provider's handling of those
  stays pinned by `schema-v3-session.jsonl`.

**`context_edit` handling** (decided 2026-11-14). A `context_edit` changes
only what later requests send; the target stays in raw history and in pi's
usage totals (`docs/session-format.md` "ContextEditEntry"). So:

- Usage is unchanged: the omitted attempt's tokens still count toward its
  turn (they were billed).
- The turn inspector marks the response or tool result a `context_edit`
  targets, "omitted from later context" (`replacement: null`) or "replaced
  in later context", with a note (`contextEdit` on the response round or the
  tool call, `context-edits.ts`). The latest edit on the branch wins, as in
  pi.
- "Added messages" shows a compaction or branch summary as its summary text
  and leaves metadata entries (`context_edit`, model and thinking changes,
  `usage`, labels) out.
- An edit of a user or custom message is not shown; pi's recovery only
  edits assistant attempts and their tool results.

**Decisions settled by the generated sessions:**

- The sidecar record's `sessionId` equals the session header's `id` (every
  generated record). The join stays on `sessionFile`.
- A resumed session (a second pi process on the same file) gets a second
  sidecar record; the matcher picks the latest at or before the branch end
  (S2, S3).

## Open items

- Fork double counting: `/fork` writes a new file that repeats the parent's
  earlier entries with the same ids and usage (S4), so listing both files
  counts that usage twice. The owner never forks (2026-11-14); not fixed.
- In-file `/tree` branching and `branch_summary` usage are still pinned
  only by hand-authored fixtures: pi's RPC mode has no tree navigation
  command. Which turn a `branch_summary`'s usage counts toward and fork vs.
  rewind tagging stay as described in architecture.md §6.2.5.
- `tool`, `vision` token counts stay `{ known: false }`: pi's `Usage` has
  no field for them.
- `costAiCredits` stays `{ known: false }`: AI Credits is Copilot's own
  billing unit.
