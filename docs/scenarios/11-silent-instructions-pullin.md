# Scenario 11: A New File Type Silently Changes the Prompt

> Extracted from [docs/agentic-coding-explained.md](../agentic-coding-explained.md#4-prompt--file-caching-and-how-it-saves-ai-credits), Section 4.

Path-scoped `.instructions.md` files (`applyTo` globs) are included
**conditionally** — only when a turn actually touches a matching file — so
this layer can vary turn to turn rather than staying perfectly static. If
turns 1-2 never touch a matching file, that block isn't in the prompt at all;
the first turn that *does* touch one inserts it. If the client groups this
with the other stable instructions near the top of the prompt (the common
pattern), that insertion breaks the prefix match at that position, invalidating
everything cached after it — all prior conversation included — even though
none of that conversation actually changed.

This is a **silent** trigger: nothing about the user's message looks like a
deliberate config change (no explicit model/tool switch, no edited
instructions file), so an AI Credits spike from simply opening a new kind of
file can be genuinely surprising — and, unlike every other trigger in this
series, it carries **no trigger tag** in the turns table, since nothing about
the request itself was a recognized event.

| Turn | What happens | Cache write | Cache read | Cache size after | Uncached input | Tool | Reasoning | Output text | **Turn total** | **Turn AI Credits** |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Normal turn; writes static prefix + own content. No `.sql` files touched yet, so the path-scoped SQL instructions aren't loaded | 3500 | 0 | 3500 | 500 | 0 | 150 | 150 | **4300** | **0.0289 AI Credits** |
| 2 | Normal turn; reads/extends the cache. Still no `.sql` files touched | 600 | 3500 | 4100 | 200 | 100 | 120 | 180 | **4700** | **0.0115 AI Credits** |
| 3 | **First `.sql` file touched this session**: silently pulls in a path-scoped `applyTo: **/*.sql` instructions block grouped near the top of the prompt — invalidating everything cached after that position, with no visible trigger tag | 4700 | 0 | 4700 | 4200 | 150 | 210 | 200 | **9460** | **0.0573 AI Credits** |
| 4 | Normal turn under the newly-included SQL instructions block | 650 | 4700 | 5350 | 140 | 200 | 130 | 160 | **5980** | **0.0125 AI Credits** |
| 5 | Normal turn; no further disruption | 230 | 5350 | 5580 | 70 | 0 | 70 | 100 | **5820** | **0.0070 AI Credits** |

Turn 3's cost (**0.0573 AI Credits**, ~5x turn 2) is mechanically identical to
[Scenario 10](10-instructions-edit.md)'s deliberate instructions edit — same
prefix-insertion, same full-below invalidation — but nothing in the user's
message announced it. Compare this to [Scenario 5](05-mcp-tool-change.md)'s
explicit MCP tool change: that scenario at least *looks* like a config change
to the person reading the transcript. This one doesn't. The practical
takeaway (Section 17.4 of the main doc) is to keep an eye on which file types
pull in path-scoped instructions in a given project, since the first turn that
touches one will always pay this tax, whether or not anyone was expecting it.
