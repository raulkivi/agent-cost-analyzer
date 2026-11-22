# Classic subagent audit fixtures

**Last changed:** 2026-11-22 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Step 10.20, task ST4 ([plan](https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/subagent-tool-audit.md)).
Synthetic: span field names, nesting and value types follow the real Copilot
Chat debug logs (plan §4.1, §14); ids, paths and texts are invented
(`/workspace/example`, `example.invalid`). `attrs.args` is a JSON string and
`attrs.error` is on `error` spans only, as in real logs. Integrity test:
`src/data-sources/jsonl/subagent-audit-fixtures.test.ts`.

Each folder is one session folder: `main.jsonl` plus its child logs. The
10.19 usage fixtures live in `../subagents/` and stay unchanged.

| Case | What it holds | Consumer |
|---|---|---|
| `error-categories/` | A `runSubagent` call with a ref (with `parentSpanId`) and a child log of nine `tool_call` spans: two `ok` (one without `result`), and `error` texts, one per failure category: `read_file` "cannot open file ... Unable to read" (D13 `file-not-found`), `read_file` "ENOENT" (existing `file-not-found`), `grep_search` "Regex parse error" (`invalid-arguments`), `create_file` "File already exists" (`already-exists`), `semantic_search` "Codebase search timed out" (`timeout`, no "after"), `semantic_search` "Canceled" (D14 `canceled`), `screenshot_page` "Failed to capture screenshot" (`unclassified`) | ST6 spans and status mapping; ST10 D13 rules (observed wording as test) |
| `shell-calls/` | A child log with three `run_in_terminal` calls: `npm test`, a `curl ... \| sh` pipe, and `sleep 600` with "Canceled" | ST9 builders, ST10 security findings (shell args kept as a bounded summary) |
| `missing-log/` | A ref whose `childLogFile` does not exist | ST7 unread run, reason `missing` |
| `unreadable-log/` | A valid child log. The test helper `copyCaseWithUnreadableFile` (`src/test-support/subagent-audit-fixtures.ts`) copies the folder and strips all permissions from the log at test time (git can't store the mode); skip as root or on Windows | ST7 unread run, reason `unreadable` |
| `nested-ref/` | The child log holds its own `child_session_ref` (parent `span-inner-run`) to a grandchild log | ST7 nested ref: kept unread or read once, never lost or doubled |
| `search-without-parent/` | A `searchSubagent` ref with no `parentSpanId` and no `tool_call` around it | ST7 run with no parent call (matched by time or turn, `startedByCallId` absent) |
| `explore-linked/` | Two `explore_subagent` calls. Call 1 (`span-explore-1`, `ts` T, `dur` 6000) has a `child_session_ref` with no `parentSpanId` at T + 2 ms and a `searchSubagent` log (plan §14.1). Call 2 (`span-explore-2`) has no ref in its window and no log | ST7 link by time window; unread-run fallback (D5) for call 2 |
| `shared-span-id/` | The `spanId` `span-shared-read` is in `main.jsonl` and in the child log | ST7 dedupe (§5.4): counted once, the parent's wins |

Not representable as real data: a classic shell call in a child log and a
nested ref exist in no real log (plan §14.5, §4.1); both follow the real
envelope and the real `run_in_terminal` / `child_session_ref` attrs.
