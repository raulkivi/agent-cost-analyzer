# Scenario 4: Changing the Model Mid-Session

> Extracted from [docs/agentic-coding-explained.md](../agentic-coding-explained.md#11-how-changing-the-model-mid-session-affects-tokens-cache-and-ai-credits), Section 11.

Prompt caches are scoped **per model** (and often per model *version*/tokenizer).
Switching models mid-session — e.g. from a cheaper model to a more capable one
starting at turn 3 — means the new model has never seen any of the previous
turns' cached prefix, no matter how well-cached it was under the old model.

What this does to tokens/cache/AI Credits:

- **Full cache miss on the switch turn**: the entire prior conversation must be
  resent to the new model as plain (uncached) input — none of the old model's
  cache carries over, because caches aren't shared across models.
- **Token counts can shift**: different models use different tokenizers, so the
  same text can require a different number of tokens under the new model.
- **New rates apply immediately**: if the new model is pricier (or cheaper), every
  token from the switch turn onward — including cache write/read — is billed at
  the *new* model's rates, not the old one's.
- **A fresh cache then builds up again** from the switch turn forward, under the
  new model, growing the same way as in [Scenario 1](01-cache-basics-8-turn-session.md)
  — just starting from zero.

This example switches from a cheaper Model A (turns 1-2) to a pricier Model B
(turns 3-5, illustrative rates: cache write 0.01 AI Credits, cache read 0.001 AI Credits, uncached
input 0.01 AI Credits, reasoning/output 0.03 AI Credits per 1K tokens):

| Turn | Model | What happens | Cache write | Cache read | Cache size after | Uncached input | Reasoning | Output text | **Turn total** | **Turn AI Credits** |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | A | Normal turn; writes static prefix + own content | 3500 | 0 | 3500 | 500 | 150 | 150 | **4300** | **0.0289 AI Credits** |
| 2 | A | Normal turn; reads/extends the cache | 600 | 3500 | 4100 | 200 | 120 | 180 | **4600** | **0.0110 AI Credits** |
| 3 | **B** | **Model switch**: A's 4100-token cache is worthless to B; the whole history + new message (4300) is resent as uncached input, and B writes its *own* first cache entry | 4850 | 0 | 4850 | 4300 | 250 | 300 | **9700** | **0.1080 AI Credits** |
| 4 | B | Normal turn under B; reads/extends B's new cache | 470 | 4850 | 5320 | 120 | 150 | 200 | **5790** | **0.0213 AI Credits** |
| 5 | B | Normal turn under B | 310 | 5320 | 5630 | 80 | 90 | 140 | **5940** | **0.0161 AI Credits** |

Turn 3 (**0.1080 AI Credits**) dwarfs every other turn — nearly 10x turn 2 — purely
because of the switch: a full cache miss forcing 4300 uncached tokens through,
*and* those tokens (plus every token after) now billed at Model B's higher rates.
Turns 4-5 behave like a normal, healthy cache-building session again, just under
the new, pricier rates.

**Sources** (checked 2026-11-03):

- [Anthropic: cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics): "The cache is per-model."
- [Claude Code: switching models](https://code.claude.com/docs/en/prompt-caching#switching-models): switching models reads the whole history uncached
- [VS Code: language models](https://code.visualstudio.com/docs/agents/concepts/language-models): switching models mid-chat
- [Anthropic: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): usage fields: cache read, cache write and input are separate

Fact-check: see [learn-scenarios-fact-check.md](../learn-scenarios-fact-check.md#per-scenario-verdicts). Open findings for this scenario: R-01.
