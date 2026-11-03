# Scenario 7: `/rewind` (or Editing a Previous Turn in VS Code)

> Extracted from [docs/agentic-coding-explained.md](../agentic-coding-explained.md#15-how-rewind-or-editing-a-previous-turn-in-vs-code-affects-tokens-and-cache), Section 15.

Claude Code's `/rewind`, and VS Code's equivalent — restoring a checkpoint or
editing an earlier user message and resubmitting — roll the conversation back to
an earlier turn and continue from there, discarding every turn after that point
(and often reverting the file edits those turns made).

What this does to tokens/cache/AI Credits:

- **The discarded turns' AI Credits are already spent** — rewinding doesn't
  refund the tokens/AI Credits already billed for the turns being thrown away.
  They're sunk.
- **Going forward, those discarded turns are never resent again**: the next turn
  resumes from the cache size *at the rewind point*, not from the (larger) cache
  size the abandoned branch had reached. That's the actual saving — it stops a
  bad turn from being read-and-billed-again in every future turn.
- **The prefix up to the rewind point is usually still a warm cache hit** (same
  model, same tools, same instructions) — so, unlike a model/tool switch, resuming
  doesn't force a full uncached resend; it picks up cheaply right where the good
  history left off.
- If the resubmitted message is **edited**, it's new content from that point
  on — a fresh branch starts from the rewind point, but still on top of the
  still-valid earlier cache.

| Turn | What happens | Cache write | Cache read | Cache size after | Uncached input | Tool | Reasoning | Output text | **Turn total** | **Turn AI Credits** |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Normal turn; writes static prefix + own content | 3500 | 0 | 3500 | 500 | 0 | 150 | 150 | **4300** | **0.0289 AI Credits** |
| 2 | Normal turn; reads/extends the cache | 600 | 3500 | 4100 | 200 | 100 | 120 | 180 | **4700** | **0.0115 AI Credits** |
| 3 | **Wrong path**: model edits the wrong files based on a misunderstanding (will be rewound away) | 1830 | 4100 | 5930 | 250 | 1200 | 200 | 180 | **7760** | **0.0264 AI Credits** |
| 4 | **`/rewind`** back to end of turn 2 with a corrected instruction; turn 3's 1830 tokens are discarded and never read again | 820 | 4100 | 4920 | 220 | 300 | 140 | 160 | **5740** | **0.0143 AI Credits** |
| 5 | Normal turn continuing on the corrected branch | 260 | 4920 | 5180 | 90 | 0 | 70 | 100 | **5440** | **0.0071 AI Credits** |

Turn 3 (**0.0264 AI Credits**) is money already spent and gone — `/rewind` can't undo that
charge. What it *does* do shows up in **turn 4's cache read (4100)**: it resumes
from turn 2's cache size, not turn 3's larger 5930, so the mistaken turn never
bloats any future turn's context or AI Credits. Compare that to *not* rewinding and
instead just sending a correction on top — the model would keep re-reading (and
re-paying for) that wrong 1830-token detour in every subsequent turn forever.

**Sources** (checked 2026-11-03):

- [Claude Code: rewinding the conversation](https://code.claude.com/docs/en/prompt-caching#rewinding-the-conversation): the next request hits the earlier cache entry
- [Claude Code: checkpointing](https://code.claude.com/docs/en/checkpointing): what rewind restores; Bash-only changes not tracked
- [VS Code: restore a checkpoint](https://code.visualstudio.com/docs/agents/run/review-code-edits#restore-a-checkpoint): VS Code checkpoints and editing a previous request

Fact-check: see [learn-scenarios-fact-check.md](../learn-scenarios-fact-check.md#per-scenario-verdicts). No open findings.
