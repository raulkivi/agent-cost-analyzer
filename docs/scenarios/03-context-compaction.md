# Scenario 3: Context Compaction/Summarization

> Extracted from [docs/agentic-coding-explained.md](../agentic-coding-explained.md#10-how-context-compactionsummarization-affects-tokens-cache-and-ai-credits), Section 10.

When a session's history grows close to the model's context-window limit, the
client (or the model itself) can **compact** it: instead of sending every raw past
message, it asks the model to produce a condensed summary of everything so far,
and that summary — not the original messages — becomes the new prefix for future
turns.

What this does to tokens/cache/AI Credits:

- **One-time spike on the compaction turn**: producing the summary requires
  reading the *entire* prior history (still a cache hit, if it hasn't expired) and
  generating a new chunk of output (the summary itself) — so that turn's output
  tokens (and reasoning) are larger than usual.
- **Cache invalidation from that point on**: the summary text is *new*, different
  content from the raw history it replaces — it doesn't byte-match the old cached
  prefix. So the old cache entry becomes useless; a **new, smaller cache** starts
  from the summary instead of the full raw transcript.
- **Fewer AI Credits afterward**: because the new prefix (summary + new turns) is much
  smaller than the raw history it replaced, every subsequent turn reads (and
  eventually re-writes) far fewer cached tokens — cutting the steady per-turn AI Credits
  growth at the price of losing verbatim detail from the compacted turns.

| Turn | What happens | Cache write | Cache read | Cache size after | Uncached input | Tool | Reasoning | Output text | **Turn total** | **Turn AI Credits** |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Normal turn; writes static prefix + own content | 3500 | 0 | 3500 | 500 | 0 | 150 | 150 | **4300** | **0.0289 AI Credits** |
| 2 | Normal turn; reads/extends the cache | 600 | 3500 | 4100 | 200 | 100 | 120 | 180 | **4700** | **0.0115 AI Credits** |
| 3 | **Context compaction**: reads all prior history (4100) one last time, replaces it with a ~500-token summary as the new cache prefix | 1350 | 4100 | **1350** | 150 | 0 | 300 | 400 | **6300** | **0.0217 AI Credits** |
| 4 | Normal turn; now builds on the much smaller post-compaction cache | 300 | 1350 | 1650 | 80 | 0 | 100 | 120 | **1950** | **0.0063 AI Credits** |
| 5 | Normal turn; cache stays small relative to what it would have been | 210 | 1650 | 1860 | 60 | 0 | 60 | 90 | **2070** | **0.0047 AI Credits** |

The key number is **cache size after turn 3**: it *drops* from 4100 to 1350 even
though the conversation keeps growing — instead of turn 4 reading 4100+ tokens
(and turn 5 reading even more), it reads only 1350, then 1650. Turn 3 itself uses
more AI Credits than a normal turn (the compaction "tax"), but turns 4-5 are noticeably
cheaper than if the raw history had kept growing uncompacted — that trade-off is
the whole point of compaction.

**Sources** (checked 2026-11-03):

- [Claude Code: manage context within a session](https://code.claude.com/docs/en/sessions#manage-context-within-a-session): `/compact` replaces history with a summary
- [Claude Code: compacting the conversation](https://code.claude.com/docs/en/prompt-caching#compacting-the-conversation): the compaction request reads the warm prefix from cache
- [Anthropic: on-demand compaction](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand): API compaction; the summary replaces the messages
- [VS Code: compact conversation context](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions#compact-conversation-context): VS Code automatic compaction and `/compact`

Fact-check: see [learn-scenarios-fact-check.md](../learn-scenarios-fact-check.md#per-scenario-verdicts). No open findings.
