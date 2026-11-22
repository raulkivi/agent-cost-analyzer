# Agent Host subagent audit fixtures

**Last changed:** 2026-11-22 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Step 10.20, task ST4 ([plan](https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/subagent-tool-audit.md)).
A fake Copilot home like `../copilot-cli/`: `session-state/<sdkSessionId>/events.jsonl`,
with no `rows.json` (tests build the catalog rows they need). Synthetic: event
types and field names follow real Copilot CLI 1.0.x logs (plan §4.2, §14.2);
ids, paths and texts are invented. Integrity test:
`src/data-sources/jsonl/subagent-audit-fixtures.test.ts`.

Log values keep the log's own spelling; the spelling check skips fixture
folders (`.codespellrc`).

| Session | What it holds | Consumer |
|---|---|---|
| `5d1a0010-...` | One turn with three runs. `task` `toolu_T1` (`agent-00000001`, the agent id differs from the call id), started by a main call. Its own call `toolu_T2` (`task`) starts a depth-2 run (`agent-00000002`, `parentToolCallId` `toolu_T2`; `bash` shell call and `grep_search`). `search_code_subagent` `toolu_S1` (`agentId` equals the call id; a `file_search` and a `grep_search` failing with "Regex parse error"). A refused permission: `bash` `toolu_R1` in run 1, `permission.completed` `denied-interactively-by-user`, completed `success: false` (code `rejected`; the real refusal wording was not captured, so this text is invented). `subagent.completed` per run with `totalToolCalls` | ST8 `originOf`, depth 1 and 2, label sources, order; ST9 builders (denied outcome, failed call); ST10 findings (`bash rm -rf` in a run) |
| `5d1a0011-...` | The canceled run (plan §14.2): run `agent-00000001` has 26 `tool.execution_start` and 24 `tool.execution_complete`. The two extra starts are `bash` calls: `toolu_X1` with a `permission.requested` and `approved`, `toolu_X2` with `approved` then `cancelled`. Then `abort`, `subagent.completed` twice (both `totalToolCalls` 24, the second with `cancelled: true`) and `session.shutdown` | ST8 cross-check of `totalToolCalls` against completed calls, dedupe of `subagent.completed`; ST9 builders (unfinished calls read as unknown or canceled) <!-- codespell:ignore cancelled --> |

Not representable: a real depth-2 run exists in no captured log (plan §14.5);
its shape follows the depth-1 events (`agentId` of the inner run,
`parentToolCallId` of the starting call, which is itself a call of the outer
run).
