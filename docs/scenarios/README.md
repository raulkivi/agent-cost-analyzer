# Learn-mode scenarios

An index of the worked-example docs behind Learn mode's 18 bundled
scenarios. Each doc is extracted from a section of
[agentic-coding-explained.md](../agentic-coding-explained.md) and expands it
into a concrete, turn-by-turn example: a markdown table of that scenario's
per-turn token/cache numbers (several also add a cumulative-AI-Credits
table), and — where the flow benefits from a picture, not every scenario —
a Mermaid `sequenceDiagram` and/or an `xychart-beta` bar chart. The same
data seeds the actual JSON fixture the app serves in
[`packages/server/fixtures/learn-scenarios/`](../../packages/server/fixtures/learn-scenarios/),
so what you read here is what you'll see if you pick that scenario in the
running app.

| # | Scenario | What it shows | Diagrams |
|---|---|---|:---:|
| 1 | [Cache Basics — An 8-Turn Session](01-cache-basics-8-turn-session.md) | Baseline example: how every token type (cache write/read, uncached, tool, vision, reasoning, output) shows up turn by turn, and how the cache read/write shape emerges as a session grows. | sequence + chart |
| 2 | [The Subagent's Own Session](02-subagent-own-session.md) | The subagent spawned in Scenario 1's turn 2, from the inside — its own isolated context/cache, invisible to and not repaid by the parent. | chart |
| 3 | [Context Compaction/Summarization](03-context-compaction.md) | What happens to tokens, cache, and AI Credits when a session's history is compacted into a condensed summary partway through. | — |
| 4 | [Changing the Model Mid-Session](04-model-switch.md) | Why switching models mid-session breaks the prompt cache — caches are scoped per model, so the new model starts cold. | — |
| 5 | [Changing MCP Tools Mid-Session](05-mcp-tool-change.md) | How enabling/disabling an MCP server mid-session changes the tool-definitions block sent every turn, and its cache impact. | — |
| 6 | [Claude Code's `/clear`](06-clear.md) | `/clear` drops the *visible* history for the next message but doesn't delete anything from disk — what that means for cache and tokens. | — |
| 7 | [`/rewind` (or Editing a Previous Turn)](07-rewind.md) | Rolling a session back to an earlier turn and continuing from there, discarding (and often reverting) everything after that point. | — |
| 8 | [Session Forking](08-session-forking.md) | Branching a new, independent session from a shared history point while the original session keeps going too. | flowchart |
| 9 | [Cache TTL — A 5+ Minute Smoke Break](09-cache-ttl-smoke-break.md) | Extends Scenario 1 to 10 turns to show a cache expiring mid-session after a 5+ minute idle gap, and the cost of rebuilding it. | sequence |
| 10 | [Editing Custom Instructions Mid-Session](10-instructions-edit.md) | Editing `copilot-instructions.md`/`AGENTS.md` mid-session breaks the cache at byte 0, since instructions sit at the very front of the prefix. | sequence |
| 11 | [A New File Type Silently Changes the Prompt](11-silent-instructions-pullin.md) | A path-scoped `.instructions.md` file (`applyTo` glob) silently entering or leaving the prompt as different files get touched turn to turn. | — |
| 12 | [Exploring Inline vs. Isolating in a Subagent](12-inline-exploration-bloat.md) | Contrasts Scenario 1/2's isolated-subagent exploration against doing the same investigation inline in the parent session — the token/AI Credits cost of bloating the parent's own cache. | flowchart |
| 13 | [Cache TTL — Surviving a Break with the 1-Hour Breakpoint](13-cache-ttl-1-hour-breakpoint.md) | Replays Scenario 9's exact idle gap, but with the optional 1-hour TTL breakpoint (at ~2x normal cache-write price) instead of the default 5-minute one. | sequence |
| 14 | [Cascading Triggers — A Model Switch Followed by a Cache-Expiry](14-cascading-model-switch-then-ttl-lapse.md) | What happens when two invalidation triggers stack — a model switch (Scenario 4) followed a few turns later by that new model's own TTL lapsing. | sequence |
| 15 | [An Image Attachment Invalidates the Cache](15-image-attachment-invalidation.md) | An image appearing in the conversation invalidates the cache purely by changing the request shape, independent of any explicit setup change. | flowchart |
| 16 | [Toggling Extended Thinking Mid-Session](16-reasoning-budget-toggle.md) | Flipping the reasoning/thinking-budget setting mid-task invalidates the cache the same way an image attachment does, for the same underlying reason. | sequence |
| 17 | [Forking Twice — A Nested Branch from Within a Branch](17-session-forking-multi-branch.md) | Extends Scenario 8: a forked branch can itself fork again, making its own fork point a shared trunk for the next branch. | flowchart |
| 18 | [A Subagent Running a Cheaper Model](18-subagent-cheaper-model.md) | Extends Scenario 2: a subagent doing narrow, well-scoped work on a cheaper model than its parent, and the AI Credits saved by that split. | — |

For all 18 scenarios combined into a single document (every table and
diagram, one after another), see
[all-scenarios.md](all-scenarios.md).

See also: [User Guide](../UserGuide.md#learn-mode) for how these scenarios
appear in the running app, and
[agentic-coding-explained.md](../agentic-coding-explained.md) for the prose
reference material they're extracted from.
