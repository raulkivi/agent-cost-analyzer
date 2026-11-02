# Agent Host fixtures

Test fixtures for the VS Code Agent Host readers (`src/data-sources/agent-host/`).

- `agent-host.schema.sql`: `CREATE TABLE` statements of `User/globalStorage/agent-host.db` (session catalog), verbatim from `sqlite_master`.
- `session.schema.sql`: same for `agentSessionData/<id>/session.db` (per-session turns and usage).
- `catalog-rows.json`, `session-rows.json`: sample rows to load into databases built from those schemas.
- Source: VS Code Insiders 1.145 on Linux, captured 2026-10-28; usage JSON shapes match real `turn_usage` rows (`quotaSnapshots` dropped).
- Redacted: all ids replaced with made-up UUIDs, titles and paths replaced (home paths use `/home/user`), prompt text and git/changeset metadata omitted. Token and nanoAIU numbers are real or lightly adapted from real turns.
- `session-rows.json` covers a single-model turn, two multi-model turns (top-level `model` differing from the first `turnTokenTotals` entry in one), and a turn without a `turn_usage` row.

## copilot-cli/ (step 10.14)

A fake Copilot home for the event-log reader and builders: `session-state/<sdkSessionId>/events.jsonl`, plus `rows.json` with matching `chats_v2` rows (`provider_data` with `sdkSessionId`) and `turns` rows (`id`, `event_id`, `checkpoint_ref`). Format: docs/architecture.md section 6.2.2.2.

- Captured 2026-10-29 from Copilot CLI 1.0.103 logs on this machine; rebuilt as synthetic content (all message, tool and prompt text is made up, paths use `/home/user`), keeping event types, field names, ids and join keys.
- `5d1a0001-...`: normal session, two turns. Attachments (`file`, `blob`, `selection`, image blob plus `session.binary_asset`), a tool failure, a shell call, a file edit, an `external_tool` call, `session.shutdown` token counts.
- `5d1a0002-...`: four turns plus the aborted-turn duplicate row (bare id, `event_id` NULL): a subagent (`agentId`, `parentToolCallId`, its own `user.message` with `source: "agent-..."` and `system.message`), a `delivery: "steering"` message sharing the previous `interactionId`, a started-but-never-completed tool call and a cancelled permission before `abort`. No trailing newline (a live file).
- `5d1a0003-...`: three `system.message` events (one per turn after a model change and a resume), `session.compaction_start` with `systemTokens`.
- `5d1a0004-...`: malformed lines: not JSON, a JSON array, a JSON string, no `id`, no `type`, blank and whitespace-only lines, an event with odd field types, an unknown event type (valid), and a truncated last line. `rows.json` `expected.malformed` gives the counts.
- `chats_v2` also covers: a session with no log dir (`missingLog`), a session whose first chats have NULL, non-JSON, array, id-less and empty `provider_data` (the usable one is `...0006`), and one where `chat_order` NULL sorts last.
- `turns.unmatched`: turns whose event ids are not in any log.

