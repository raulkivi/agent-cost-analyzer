# Agent Host fixtures

Test fixtures for the VS Code Agent Host readers (`src/data-sources/agent-host/`).

- `agent-host.schema.sql`: `CREATE TABLE` statements of `User/globalStorage/agent-host.db` (session catalog), verbatim from `sqlite_master`.
- `session.schema.sql`: same for `agentSessionData/<id>/session.db` (per-session turns and usage).
- `catalog-rows.json`, `session-rows.json`: sample rows to load into databases built from those schemas.
- Source: VS Code Insiders 1.145 on Linux, captured 2026-10-28; usage JSON shapes match real `turn_usage` rows (`quotaSnapshots` dropped).
- Redacted: all ids replaced with made-up UUIDs, titles and paths replaced (home paths use `/home/user`), prompt text and git/changeset metadata omitted. Token and nanoAIU numbers are real or lightly adapted from real turns.
- `session-rows.json` covers a single-model turn, two multi-model turns (top-level `model` differing from the first `turnTokenTotals` entry in one), and a turn without a `turn_usage` row.
