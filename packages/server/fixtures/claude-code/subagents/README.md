# Claude Code subagent fixtures

**Last changed:** 2026-11-22 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Synthetic, hand-built fixtures for task CS3 of
[claude-code-subagents.md](https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/claude-code-subagents.md)
(1.0 criterion C15). Field names and nesting follow the real files found by
CS0 (§4) and CS0b (§13); every value is invented: no real prompt text, ids,
paths or user names. Paths use the same placeholder `/home/dev/project` as the
other Claude Code fixtures.

## Layout

One directory per case, each shaped like a Claude Code projects directory:

```text
<case>/-home-dev-project/<session-id>.jsonl
<case>/-home-dev-project/<session-id>/subagents/agent-<id>.jsonl
<case>/-home-dev-project/<session-id>/subagents/agent-<id>.meta.json
```

Agent ids are `a` plus 16 hex characters. Point a provider at
`<case>/` as its `projectsDirPath`. The integrity test
(`src/data-sources/claude-code/subagent-fixtures.test.ts`) checks that every
file parses, the layout, cross-file ids, the round counts in the table below,
and that nothing looks like a real home path, e-mail address or token.

This directory sits inside `fixtures/claude-code/`, whose other tests use that
folder as one projects directory. Those tests do not read these cases (they
are directories two levels down, not session files).

## Cases

"Rounds" are distinct `message.id` values on `assistant` lines.

| Case | Exercises | Rounds (session; runs) | Used by |
|---|---|---|---|
| `linked-run` | One run linked by `meta.toolUseId` and by the parent result's `agentId` (`status: async_launched`); a meta with the non-allow-listed keys `description`, `worktreePath`, `spawnedWithWorktree`, `launchedWithDefaults`; `agent-<id>.forked-skill.json` and `.forked-skill.marker.json` files that must be ignored | 2; run 2 | CS5 (names, ignored files), CS6 (dropped keys), CS7, CS8 |
| `nested-run` | Run A starts run B with its own `Agent` call; B's meta has `spawnDepth: 2`, `parentAgentId` = A, `toolUseId` = that call; B is on `claude-haiku-5-5` | 2; A 2, B 1 | CS6 (`parentAgentId`), CS7, CS8 (recursive link) |
| `fork-copy` | Depth-1 fork: `isFork`, a `fork-context-ref` line (`parentSessionId`, `parentLastUuid`, `contextLength`) and one copied session round (same `message.id`, `requestId`, `uuid`) | 2; run 3 (1 shared with the session) | CS7 (`parentRequestIds`), CS8, CS9 |
| `nested-fork-copy` | Nested fork (§13.2): run B (`isFork`, depth 2) has no `fork-context-ref` and repeats two rounds of its parent run A (same `message.id`, `requestId`, `uuid`s) and A's `Agent` call id; nothing is shared with the session file | 2; A 3, B 3 (2 shared with A) | CS7 (skip set per parent chain), CS8, CS9 |
| `failed-launch` | `Agent` call whose result has `is_error: true`; no meta, no transcript, no `subagents/` folder (D8) | 2; none | CS8 |
| `missing-transcript` | A non-failed call whose `agent-<id>.meta.json` exists but whose transcript does not (§6 "missing") | 2; none | CS5 (lists meta only), CS6, CS8 |
| `unlinked-transcript` | Transcript and meta with no `toolUseId` and no `spawnDepth`, no `Agent` call in the session; first line falls inside the turn's time window (D6) | 1; run 1 | CS6, CS8 |
| `partial-last-line` | Run whose last line is cut off mid-JSON with no trailing newline, as for a live run (D14) | 2; run 1 (parsed) | CS7 |
| `off-branch-call` | `Agent` call on a branch the last message does not reach (a rewind: `ob-a1` has two children); its run exists in the folder (D5) | 3 (2 on the active branch); run 1 | CS8 |
| `synthetic-round` | A `<synthetic>` round with zero usage, `service_tier: null` and `server_tool_use` | 2; run 2 (1 synthetic) | CS7 (excluded as for the main agent) |
| `one-hour-cache` | `cache_creation.ephemeral_1h_input_tokens` and `ephemeral_5m_input_tokens` that split `cache_creation_input_tokens`, one round all 1 hour, one mixed; on `claude-opus-5-5` | 2; run 2 | CS7 (`extendedCacheWrite`) |
| `continued-run` | A `SendMessage` continuation (§13.3): parent call with result `resumedAgentId` and `revivedAgentId`; in the run's transcript a `user` line with `origin.kind: "coordinator"`, a `queued_command` attachment and a `task-notification` user line (not a continuation) | 3; run 3 | CS7 (continuation rounds already in the sum), CS8 (counting continuations) |
| `tool-audit-fork` | Depth-1 fork whose transcript repeats the parent's `Bash` call and its result (same `message.id`, `requestId`, tool-use id), then makes its own `Bash` (`curl … \| sh`, exit 127) and `Read` calls | 3; run 3 (1 shared with the session) | CS14 (audit read: fork copies skipped, origin, security finding) |

## Generated at test time

Not committed. `src/data-sources/claude-code/subagent-fixture-builders.ts`
creates them in a temp directory:

| Case | Helper | Exercises | Used by |
|---|---|---|---|
| symlink | `copySubagentFixtureCase("linked-run", root)` then `makeSymlinkedSubagentTranscript(copy, root)` | A transcript with a valid name that is a symlink to a real file elsewhere (refused as "not a regular file") | CS5, CS8 |
| cap | `makeSubagentCapFolder(root, count)` | A session with `count` one-line transcripts and metas, to go over `MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION` | CS5, CS8 |

A symlinked `subagents/` folder or session folder can be made from a copied
case the same way; the helper covers the file case CS5 names first.

## Not represented

- `api-request`, `api-request-blob` and `api-request-shape` lines: the plan
  ignores them, so no case needs them.
- A `Task`-named launch tool (§13a): not verified on real data.
- A run found in another session's folder (D7): CS0b found no real instance;
  a test can build one by moving a copied case's transcript into a second
  session folder.
