# Scenario 6: Claude Code's `/clear`

> Extracted from [docs/agentic-coding-explained.md](../agentic-coding-explained.md#14-how-claude-codes-clear-affects-tokens-and-cache), Section 14.

`/clear` tells the client to drop the visible conversation history and start the
next message with an empty transcript — but it does **not** delete anything from
disk.

**Does it clear all cache, or keep instructions/tool definitions?** It clears only
the **conversation-history** portion of the context. The system prompt,
`CLAUDE.md`/instructions, and tool/MCP definitions are not "cached files" that
get wiped — they're just reloaded from disk and resent fresh on the very next
turn, exactly like session start. If that static block's content hasn't changed
and the provider's cache entry for it hasn't expired (TTL), it's often **still a
cache hit** right after `/clear` — only the old turn-by-turn conversation on top
of it is gone (and simply never resent again, so there's nothing to invalidate).

Why use it:

- **Starting a genuinely new, unrelated task** in the same terminal/session
  without paying to keep resending (and without the model being anchored to) a
  long, no-longer-relevant conversation.
- **It's free to invoke** — unlike compaction ([Scenario 3](03-context-compaction.md)),
  there's no summarization step, so no extra reasoning/output tokens are spent
  condensing anything; the old turns are simply dropped.
- It trades away **all continuity** (nothing is retained, not even a summary),
  which is the key difference from compaction: `/clear` = full discard, no tax,
  no memory; compaction = partial discard, one-time tax, keeps the gist.

| Turn | What happens | Cache write | Cache read | Cache size after | Uncached input | Tool | Reasoning | Output text | **Turn total** | **Turn AI Credits** |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Normal turn; writes static prefix + own content | 3500 | 0 | 3500 | 500 | 0 | 150 | 150 | **4300** | **0.0289 AI Credits** |
| 2 | Normal turn; reads/extends the cache | 600 | 3500 | 4100 | 200 | 100 | 120 | 180 | **4700** | **0.0115 AI Credits** |
| 3 | **`/clear`**: conversation history (the 1100 tokens turns 1-2 added) is dropped; only the still-valid static prefix (3000) is read; a new unrelated task starts | 600 | 3000 | 3600 | 300 | 0 | 130 | 170 | **4200** | **0.0113 AI Credits** |
| 4 | Normal turn on the new task; cache builds up again from the post-`/clear` baseline | 320 | 3600 | 3920 | 120 | 0 | 90 | 110 | **4240** | **0.0074 AI Credits** |
| 5 | Normal turn; still far smaller than the old conversation would have grown to | 220 | 3920 | 4140 | 70 | 0 | 60 | 90 | **4360** | **0.0059 AI Credits** |

The tell is **turn 3's cache read (3000)**: instead of reading the full 4100-token
history a normal turn would have inherited (or a spike from a forced resend, as
in [Scenario 4](04-model-switch.md)/[Scenario 5](05-mcp-tool-change.md)), it drops
straight back to just the static prefix. And unlike a compaction or a model/tool
switch, turn 3 (**0.0113 AI Credits**) isn't a spike at all — it's roughly in line
with a normal turn, because nothing had to be summarized or resent; the old turns
were simply never sent again.

**Sources** (checked 2026-11-03):

- [Claude Code: manage context within a session](https://code.claude.com/docs/en/sessions#manage-context-within-a-session): `/clear` starts fresh; the old session is saved and resumable
- [Claude Code: how the cache is organized](https://code.claude.com/docs/en/prompt-caching#how-the-cache-is-organized): CLAUDE.md and memory are reloaded after `/clear`

Fact-check: see [learn-scenarios-fact-check.md](../learn-scenarios-fact-check.md#per-scenario-verdicts). Open findings for this scenario: N-01.
