# Scenario 18: A Subagent Running a Cheaper Model

> Extracted from [docs/agentic-coding-explained.md](../agentic-coding-explained.md#7-how-subagents-work-and-how-they-reduce-ai-credits-spend), Section 7.

Section 7 of the main doc notes that "subagents can also run with a
**different, cheaper model** suited to the narrower task... while the parent
session keeps using a more capable (and expensive) model only for the tasks
that truly need it." [Scenario 2](02-subagent-own-session.md) shows a
subagent's isolation savings but keeps the same model as the parent
throughout. This scenario makes the model difference explicit: the parent
runs `model-b` (capable, expensive); a narrow, mechanical search-and-summarize
subagent task runs on `model-a` (cheaper, faster) instead.

| Subagent turn | What it does | Cache write | Cache read | Cache size after | Uncached input | Tool | Reasoning | Output text | **Turn total** | **Turn AI Credits** |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Searches the codebase (`grep_search`) for every call site of a deprecated helper, on `model-a` | 1200 | 0 | 1200 | 250 | 500 | 150 | 110 | **2210** | **0.0152 AI Credits** |
| 2 | Reads the matched files in full to check each call site's arguments | 300 | 1200 | 1500 | 100 | 700 | 120 | 90 | **2510** | **0.0094 AI Credits** |
| 3 | Synthesizes the compact summary returned to the parent | 150 | 1500 | 1650 | 50 | 0 | 80 | 160 | **1940** | **0.0055 AI Credits** |
| **Subagent session total** | | **1650** | **2700** | — | **400** | **1200** | **350** | **360** | **6660** | **0.0301 AI Credits** |

This subagent's total (**0.0301 AI Credits**) is cheap for two independent
reasons that compound: it's isolated (per Section 7, none of its 6,660
internal tokens ever touch the parent's cache — the parent only pays for the
~100-token compact summary), *and* it runs on a model priced for a narrow,
mechanical task rather than the parent's more capable, pricier `model-b`. If
this same exploration had instead run inline in the parent session under
`model-b`'s rates — the counterfactual [Scenario 12](12-inline-exploration-bloat.md)
computes directly — the equivalent work would cost several times more, on top
of permanently bloating the parent's cache. Choosing a subagent's model
independently of the parent's is a lever [Scenario 2](02-subagent-own-session.md)
doesn't exercise but Section 7 explicitly calls out as available.
