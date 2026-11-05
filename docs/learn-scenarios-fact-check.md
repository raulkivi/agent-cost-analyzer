# Learn scenarios: fact-check against external sources

Checked: 2026-11-03. Scope: the 18 Learn-mode scenarios: the fixtures in
[`packages/server/fixtures/learn-scenarios/`](../packages/server/fixtures/learn-scenarios/),
their docs in [`docs/scenarios/`](scenarios/README.md), and the sections of
[agentic-coding-explained.md](agentic-coding-explained.md) they are taken
from.

Each claim was checked against the vendor's own documentation, and every
verdict below names its source. Anything already fixed by this change is
marked **Fixed**. Changes that alter scenario numbers or teaching points are
marked **Proposed** and wait for the owner's decision (see
[Proposed re-models](#proposed-re-models)).

## Contents

1. [Method and source limits](#method-and-source-limits)
2. [Findings at a glance](#findings-at-a-glance)
3. [Fixed in this change](#fixed-in-this-change)
4. [Proposed re-models](#proposed-re-models)
5. [Per-scenario verdicts](#per-scenario-verdicts)
6. [Claim register](#claim-register)
7. [Gaps: what the scenarios don't cover](#gaps-what-the-scenarios-dont-cover)
8. [Source list](#source-list)

## Method and source limits

1. **Internal arithmetic.** Each turn's AI Credits was recomputed from its
   token counts and the rates its scenario doc states. A new test,
   [`fixture-arithmetic.test.ts`](../packages/server/src/data-sources/learn-scenarios/fixture-arithmetic.test.ts),
   now runs this check on every turn, so slips can't come back. Doc tables
   were compared with the fixtures cell by cell.
2. **External claims.** Each factual claim was checked against first-party
   documentation:
   - Anthropic (platform.claude.com, code.claude.com).
   - OpenAI, Google and xAI.
   - GitHub (docs.github.com).
   - VS Code (code.visualstudio.com).

| Source family | How it was read | Confidence |
|---|---|---|
| Anthropic API and Claude Code docs | Live pages fetched; quotes verbatim | High |
| GitHub Copilot docs | Read from the `github/docs` source (HEAD 2026-11-02); docs.github.com wasn't reachable from the session | High (source, not the rendered page) |
| VS Code docs | Read from the `microsoft/vscode-docs` source (HEAD 2026-11-02). code.visualstudio.com URLs follow the site's path convention but weren't opened | High for content; URLs unverified |
| OpenAI, Google Gemini, xAI | Search-engine excerpts of the official pages; the pages themselves couldn't be fetched | Medium: re-check wording before quoting |

VS Code moved its Copilot docs from `/docs/copilot/...` to `/docs/agents/...`
and `/docs/agent-customization/...`. Older links in this repo may point at
the old paths.

## Findings at a glance

Severity: **High** means a teaching point or number is wrong; **Medium** means
a claim is overstated or out of date; **Low** means a slip or a missing nuance.

| ID | Severity | Finding | Where | Status |
|---|---|---|---|---|
| F-01 | Low | Instructions-edit turn 3 is 0.0562; the stated rates give **0.0564** | fixture, scenario 10 doc, all-scenarios | Fixed |
| F-02 | Low | Inline-exploration turn 5 is 0.0105; the rates give **0.0107** | fixture, scenario 12 doc, all-scenarios | Fixed |
| F-03 | Low | Cheaper-subagent turn 2 is 0.0094; the rates give **0.0096** (total 0.0301 becomes **0.0303**) | fixture (incl. turn 3 text), scenario 18 doc, all-scenarios | Fixed |
| F-04 | Low | Image-scenario fixture turn 2 has `tool: 100`; the doc table (and its 0.0110 cost) has none | fixture | Fixed |
| F-05 | Low | 1-hour-scenario turn 3 is 0.0122; the scenario's own rates give 0.012275, which rounds to **0.0123** | fixture, scenario 13 doc, all-scenarios | Fixed |
| F-06 | Low | Cascading-scenario turn 6 cites a "model-switch-only" total of 0.176; the Model Switch scenario totals **0.1853** | fixture | Fixed |
| F-07 | **High** | The app says tool definitions sit "early" and an instructions edit invalidates "*everything*" while a tool change only invalidates what comes after it. Anthropic documents the opposite order: **tools → system → messages**. Tool definitions come first, so a tool change invalidates the **entire** cache; an instructions edit (system prompt) leaves the tool block cacheable | scenarios 5, 10, 11; agentic §4, §12, §17.3; README | Fixed (text). The miss numbers still hold for a harness that caches no breakpoint after the tools |
| F-08 | Medium | "A 5+ minute break is long enough to exceed **every provider's** default TTL". Only Anthropic's 5-minute default is that short. OpenAI's in-memory caching keeps entries 5-10 minutes, and its 24-hour default retention (non-ZDR orgs) and GPT-5.6+'s 30-minute default last longer. GitHub holds Copilot's Gemini caches for up to 24 hours | scenario 9 fixture, doc; agentic §17.1-17.3 | Fixed |
| F-09 | Medium | §17.1 provider table out of date: OpenAI "GPT-5.6+ … fixed 30-minute minimum TTL" (actually a 30-minute *default*, with a 12-hour option); Google "no TTL documented" (explicit caching default TTL unknown; Copilot uses Durable Caching for up to 24 hours); xAI "not documented" (it is documented, best-effort) | agentic §17.1 | Fixed |
| F-10 | Medium | "OpenAI-style caching has no cache-write charge" is wrong for GPT-5.6+, which charge 1.25x (30 minutes) or 2.5x (12 hours) | agentic §6, §17.1 | Fixed in §17.1; §9's note left as is (it hedges "varies") |
| F-11 | Medium | Copilot billing described as "per-model multipliers". Since 2026-06-01 Copilot bills **per token by model** in GitHub AI Credits (1 credit = $0.01); multipliers remain only for legacy annual plans | agentic §6 | Fixed |
| R-01 | **High** | **Every cache miss is billed twice.** The full history is counted both as uncached input and as a cache write. Anthropic's usage fields are separate (`total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens`), so a miss bills the history once, as a cache write | 11 turns in 8 scenarios | **Proposed** |
| R-02 | **High** | 1-hour cache writes priced at 2x the *5-minute write* rate (0.0125 per 1K). Anthropic: "2 times the base input tokens price", i.e. **0.01** here | scenario 13 (all 10 turns) | **Proposed** |
| R-03 | **High** | Images invalidate only the **messages** cache (tools ✓, system ✓, messages ✘). Scenario 15 shows a full miss with 0 cache read. The scenario's own text ("at the point of insertion") contradicts its table | scenario 15 | **Proposed** |
| R-04 | Medium | Scenario 1 turn 2 attaches a screenshot and still reads the full 4,500-token cache. By Anthropic's table, an image appearing invalidates the messages cache, so scenarios 1 and 15 contradict each other | scenario 1 vs 15 | **Proposed** (needs a decision, see R-04) |
| R-05 | Low | Illustrative rates use output = 3x input. Every current Anthropic model prices output at **5x** input, and Opus 5.5 / Sonnet 5.5 read cache at **0.05x** (not 0.1x). Model B prices cache writes at 1x input (Anthropic: 1.25x; pre-5.6 OpenAI: none) | all scenarios | Documented in agentic §6 (rates are labelled illustrative); no number change proposed |
| R-06 | Low | A screenshot is shown as ~700 vision tokens. Anthropic's formula is ⌈w/28⌉×⌈h/28⌉, so a 1920×1080 screenshot costs **1,560** tokens (2,691 on the high-resolution tier). 700 fits only a ~960×570 image | scenarios 1, 12, 15 | Proposed: relabel as "a small screenshot" or raise to ~1,560 |
| N-01 | Low | `/clear` keeps the system prompt and tools cached. CLAUDE.md and memory are **reloaded** after `/clear`, so they hit only if unchanged. `/clear` also starts a new session id, and the old session stays on disk, resumable with `/resume` | scenario 6 | Fixed (source note added to the doc) |
| N-02 | Low | Thinking changes: the messages cache is always invalidated; tools/system "on models that render the configuration ahead of them". Scenario 16's full miss is right only for those models | scenario 16 | Documented (source note) |
| N-03 | Low | Smallest cacheable prefix: 512-4,096 tokens by model. Subagent scenarios 2 and 18 cache a 1,200-token first turn, which would **not** be cached on Opus 4.5-4.7 or Haiku 4.5 (no error, just uncached) | scenarios 2, 18 | Documented (source note) |
| N-04 | Low | VS Code `runSubagent` exists only in the Local harness; the Copilot harness uses a `task` tool. A subagent model may not be above the main model's cost tier (cheaper is fine, as scenario 18 assumes) | scenarios 2, 12, 18 | Documented (source note) |
| N-05 | Low | Path-scoped `.instructions.md` (`applyTo`) attaches automatically in Local only when `chat.includeApplyingInstructions` is on; in the Copilot harness `applyTo` targets the files the agent works with | scenario 11 | Documented (source note) |

## Fixed in this change

**Arithmetic (F-01 to F-06).** Fixed in every copy: fixture, per-scenario
doc and all-scenarios.md. The new test pins each turn's cost to its
scenario's stated rates: base rates for `example-model`/`model-a`, Model B's
rates for `model-b`, and scenario 13's own write rate until R-02 is decided.
It failed on these five turns before the fix and passes after.

**Prefix order (F-07).** Anthropic's [what invalidates the
cache](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#what-invalidates-the-cache):
"the cache follows the hierarchy: `tools` → `system` → `messages`. Changes
at each level invalidate that level and all subsequent levels." The tool
definitions row is ✘ ✘ ✘, "invalidates the entire cache". The "byte 0"
wording and the "a tool change only invalidates what comes after it" contrast
were rewritten in scenarios 5 and 10, the README, all-scenarios.md and
agentic §4/§12/§17.3. The scenario-10 diagram's Mermaid source was updated.
The rendered SVG
(`docs/scenarios/diagrams/scenario-10-editing-custom-instructions-mid-session.drawio.svg`)
still reads "byte 0" and needs a re-render.

**TTL and provider claims (F-08 to F-11).** Scenario 9's fixture text and
doc, agentic §6, §17.1 (table rewritten, with a sources paragraph), §17.2
and §17.3.

## Proposed re-models

These change scenario numbers and the headline multiples quoted in the
narratives, in four places each: fixture, per-scenario doc,
all-scenarios.md and agentic doc tables, plus some diagrams. They are left
for the owner to approve.

**Decision (2026-11-03).** The owner chose true per-vendor simulation over
hand edits. R-01 to R-04 will be fixed by construction in Phase 13
([plans/vendor-aware-learn-simulation.md](plans/vendor-aware-learn-simulation.md),
rules S2, S5 and S8). The numbers below remain the reference for its
Anthropic golden tests.

### R-01: bill a cache miss once, not twice

Anthropic's [prompt caching FAQ](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
says: "`total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens`",
where `input_tokens` are "Tokens **after the last cache breakpoint** that
aren't cached". On a miss, the history is billed once, as cache-write
tokens. Only the new message after the last breakpoint is plain uncached
input. The fixtures instead put the whole history in `uncachedInput` *and*
in `cacheWrite`.

Proposed rule: on each miss turn, set `uncachedInput` to its current value
minus the cache size before the turn (the new content only). At the
scenarios' own rates:

| Scenario | Turn | Uncached input | AI Credits now → proposed | Session total now → proposed |
|---|---:|---|---|---|
| 9 Smoke break | 8 | 5,900 → 150 | 0.0746 → **0.0458** | 0.1674 → **0.1386** |
| 4 Model switch | 3 | 4,300 → 200 | 0.1080 → **0.0670** | 0.1853 → **0.1443** |
| 14 Cascading | 3 | 4,300 → 200 | 0.1080 → **0.0670** | 0.3131 → **0.2189** |
| 14 Cascading | 5 | 5,380 → 60 | 0.1242 → **0.0710** | (above) |
| 5 MCP tool change | 3 | 4,350 → 250 | 0.0579 → **0.0374** | 0.1198 → **0.0993** |
| 10 Instructions edit | 3 | 4,150 → 50 | 0.0564 → **0.0359** | 0.1163 → **0.0958** |
| 11 Silent pull-in | 3 | 4,200 → 100 | 0.0573 → **0.0368** | 0.1172 → **0.0967** |
| 16 Reasoning toggle | 3 | 4,150 → 50 | 0.0671 → **0.0466** | 0.1914 → **0.1441** |
| 16 Reasoning toggle | 5 | 5,420 → 70 | 0.0667 → **0.0399** | (above) |
| 15 Image | 3, 5 | see R-03 | | |

This changes headline numbers. Scenario 9's miss becomes about **5.2x** a
warm turn (0.0458 vs 0.0088), not 8.5x, and the avoidable spend becomes
about **0.037** AI Credits, not 0.066. The teaching point (a miss is a
several-fold spike) still holds.

Two caveats. For providers that don't charge cache writes (pre-GPT-5.6
OpenAI), a miss bills the history as plain input with no write. Either way,
the history is never billed both ways. Only one model can be shown per
scenario, and the fixtures use Anthropic-style rates.

### R-02: 1-hour cache write is 2x base input

[Anthropic pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing):
"Cache write tokens with a 1-hour TTL are 2 times the base input tokens
price" (e.g. Opus 4.8: $5 input, $6.25 5-minute write, $10 1-hour write). At
the scenario's 0.005 base input, that is **0.01**, not 0.0125. Recomputed,
scenario 13's turns become 0.0350, 0.0095, 0.0112, 0.0141, 0.0093, 0.0091,
0.0101, 0.0104, 0.0102, 0.0086, for a total of **0.1275**, not 0.1447.
Together with R-01 (scenario 9's total becomes 0.1386), the 1-hour TTL still
comes out cheaper over this break. The scenario's conclusion holds; only the
margin changes.

### R-03: an image invalidates only the conversation

Anthropic's invalidation table: "Images ✓ | ✓ | ✘ — Adding/removing images
anywhere in the prompt affects message blocks". Tools and system stay
cached. Proposed scenario-15 numbers, keeping the 3,000-token static prefix
used by the other 5-turn scenarios (see scenario 6) as a cache read and
applying R-01:

| Turn | Cache read | Cache write | Uncached input | AI Credits now → proposed |
|---:|---:|---:|---:|---|
| 3 | 0 → 3,000 | 4,700 → 1,700 | 4,200 → 100 | 0.0594 → **0.0217** |
| 5 | 0 → 3,000 | 5,300 → 2,300 | 5,000 → 80 | 0.0663 → **0.0245** |

The session total becomes **0.0924** (from 0.1719). Each image turn is
then about 2x a normal turn, not 5-6x. The scenario text "invalidates the
prefix at the point of insertion" should become "invalidates the
conversation part of the cache; tools and system prompt still hit".

### R-04: scenario 1's screenshot contradicts scenario 15

Scenario 1 turn 2 attaches a screenshot and still reads the full 4,500-token
cache, while scenario 15 says the same event misses. By Anthropic's table
(R-03), scenario 1 turn 2 should read only the tool/system part. There are
two options:
- (a) re-model scenario 1 turn 2 as a messages-level miss, which changes
  every running total after it;
- (b) keep scenario 1 as is and add a note pointing to scenario 15.

(b) is cheaper. (a) is the more correct choice.

## Per-scenario verdicts

| # | Scenario | Verdict | Findings | Key sources |
|---:|---|---|---|---|
| 1 | Cache Basics | Mostly correct | R-04, R-05, R-06 | [PC pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing), [Vision](https://platform.claude.com/docs/en/build-with-claude/vision), [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning) |
| 2 | The Subagent's Own Session | Correct | N-03, N-04 | [Claude Code subagents](https://code.claude.com/docs/en/sub-agents), [CC caching: subagents](https://code.claude.com/docs/en/prompt-caching#subagents-and-the-cache), [VS Code subagents](https://code.visualstudio.com/docs/agents/run/subagents) |
| 3 | Context Compaction | Correct | — | [CC caching: compacting](https://code.claude.com/docs/en/prompt-caching#compacting-the-conversation), [API compaction](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand), [VS Code compact](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions#compact-conversation-context) |
| 4 | Model Switch | Mechanism correct; miss double-counted | R-01 | [Cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics) ("The cache is per-model."), [CC caching: switching models](https://code.claude.com/docs/en/prompt-caching#switching-models) |
| 5 | MCP Tool Change | Fixed (F-07); miss double-counted | F-07, R-01 | [PC: what invalidates](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#what-invalidates-the-cache), [VS Code tools](https://code.visualstudio.com/docs/agents/run/tools) |
| 6 | `/clear` | Correct, with nuance | N-01 | [CC caching: how the cache is organized](https://code.claude.com/docs/en/prompt-caching#how-the-cache-is-organized), [CC sessions](https://code.claude.com/docs/en/sessions#manage-context-within-a-session) |
| 7 | `/rewind` | Correct | — | [CC caching: rewinding](https://code.claude.com/docs/en/prompt-caching#rewinding-the-conversation), [CC checkpointing](https://code.claude.com/docs/en/checkpointing), [VS Code checkpoints](https://code.visualstudio.com/docs/agents/run/review-code-edits#restore-a-checkpoint) |
| 8 | Session Forking | Correct | — | [CC sessions: branch](https://code.claude.com/docs/en/sessions#branch-a-session), [VS Code fork](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions#fork-a-chat-session), [PC](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) (an entry is readable only after the first response starts) |
| 9 | Smoke Break | Fixed (F-08); miss double-counted | F-08, R-01 | [PC](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) (5-minute default, measured from request start), [OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching) |
| 10 | Instructions Edit | Fixed (F-01, F-07); miss double-counted | F-01, F-07, R-01 | [PC: what invalidates](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#what-invalidates-the-cache), [VS Code custom instructions](https://code.visualstudio.com/docs/agents/reference/custom-instructions-reference) |
| 11 | Silent `.instructions.md` pull-in | Correct, setting-dependent; miss double-counted | N-05, R-01 | [VS Code custom instructions](https://code.visualstudio.com/docs/agents/reference/custom-instructions-reference) |
| 12 | Inline vs. Subagent | Fixed (F-02) | F-02, R-06 | [CC subagents](https://code.claude.com/docs/en/sub-agents) |
| 13 | 1-Hour Breakpoint | Fixed (F-05); write rate wrong | F-05, R-02 | [PC pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing) |
| 14 | Cascading Triggers | Fixed (F-06); misses double-counted | F-06, R-01 | as 4 and 9 |
| 15 | Image Attachment | **Wrong scope of invalidation** | F-04, R-03, R-06 | [PC: what invalidates](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#what-invalidates-the-cache), [Vision](https://platform.claude.com/docs/en/build-with-claude/vision) |
| 16 | Reasoning Toggle | Correct for some models; miss double-counted | N-02, R-01 | [Thinking and prompt caching](https://platform.claude.com/docs/en/build-with-claude/thinking#thinking-and-prompt-caching), [VS Code thinking effort](https://code.visualstudio.com/docs/agent-customization/language-models#configure-thinking-effort-and-context-size) |
| 17 | Nested Forking | Correct | — | as 8 |
| 18 | Cheaper-Model Subagent | Fixed (F-03) | F-03, N-03, N-04 | [CC subagents](https://code.claude.com/docs/en/sub-agents) (`model: haiku`), [VS Code subagent model](https://code.visualstudio.com/docs/agents/run/subagents#select-the-model-for-a-subagent) |

## Claim register

Every distinct factual claim the scenarios rely on, its verdict and its
source. Quotes are verbatim from the source (see the method section for how
each source family was read).

### Prompt caching (Anthropic)

| Claim | Verdict | Source and quote |
|---|---|---|
| Default cache lifetime is 5 minutes, refreshed free on each hit | Correct | [PC](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): "By default, the cache has a 5-minute lifetime. The cache is refreshed for no additional cost each time the cached content is used." |
| The TTL clock starts at the request, not the end of the response | Correct | PC FAQ: "The lifetime is measured from the start of the request that writes or reads the cache entry, not from the end of its response." |
| 5-minute write 1.25x, read 0.1x base input | Correct (Opus/Sonnet 5.5 read at 0.05x) | [PC pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing): "Claude Sonnet 4.6 \| $3 / MTok \| $3.75 / MTok \| $6 / MTok \| $0.30 / MTok \| $15 / MTok"; "Cache hits and refreshes on Claude Opus 5.5 and Claude Sonnet 5.5 are priced at 0.05x the base input price." |
| 1-hour write is ~2x the normal write price | **Wrong**: 2x base input (R-02) | PC pricing: "Cache write tokens with a 1-hour TTL are 2 times the base input tokens price." |
| Cache reads cost the same whichever TTL wrote them | Correct (implied) | PC pricing has a single "Cache hits and refreshes" column per model |
| Prefix order tools → system → messages | Correct (the app had it reversed, F-07) | [PC: what invalidates](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#what-invalidates-the-cache): "the cache follows the hierarchy: `tools` → `system` → `messages`." |
| Changing tools invalidates everything | Correct | Same table: tool definitions ✘ ✘ ✘, "invalidates the entire cache" |
| Images invalidate the cache | Partly: messages only (R-03) | Same table: "Images ✓ \| ✓ \| ✘ — Adding/removing images anywhere in the prompt affects message blocks" |
| Thinking-budget changes invalidate the cache, both on and off | Correct; tools/system only on some models (N-02) | [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking#thinking-and-prompt-caching): "The thinking configuration (mode, and `budget_tokens` in extended mode) is rendered into the prompt, so changing it always invalidates message blocks; tool and system caches are also invalidated on models that render the configuration ahead of them." |
| Web search / citations / `tool_choice` toggles invalidate | Correct, at different levels | PC table: web search/citations ✓ ✘ ✘; `tool_choice` ✓ ✓ ✘ |
| Caches are per model | Correct | [Cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics): "The cache is per-model." |
| Caches are isolated per organization | Out of date: per workspace | PC: "Prompt caching uses workspace-level isolation. … This applies to the Claude API, Claude Platform on AWS, and Microsoft Foundry; Bedrock and Claude Models on Google Cloud (Google managed) maintain organization-level cache isolation." |
| Cache-hit tokens, cache-write tokens and plain input tokens are separate | Correct, and the fixtures break it (R-01) | PC FAQ: "`total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens`" |
| Swift/Go randomize JSON key order and break caches | Correct | PC troubleshooting: "some languages (for example, Swift, Go) randomize key order during JSON conversion, breaking caches." |
| Up to 4 breakpoints, ~20-block lookback | Correct | PC: "You can define up to 4 cache breakpoints"; "The system checks at most 20 positions for each breakpoint" |
| Forked branches read the shared prefix as a hit | Correct | [CC caching](https://code.claude.com/docs/en/prompt-caching#subagents-and-the-cache): "A fork… inherits the parent's system prompt, tools, and conversation history exactly, so its first request reads the parent's cache." PC: "a cache entry only becomes available after the first response starts." |
| Smallest cacheable prefix | Not stated in the scenarios (N-03) | [PC: limitations](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#cache-limitations): from 512 tokens (Opus 5.5, Sonnet 5.5, Haiku 5.5) up to 4,096 (Opus 4.5/4.6, Haiku 4.5); "Any requests to cache fewer than this number of tokens are processed without caching, and no error is returned." |
| Thinking tokens billed as output | Correct | [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking): "the tokens Claude spends reasoning are billed as output tokens, even when the thinking text isn't returned to you" |
| Image token cost (~700 per screenshot) | Low for a full screenshot (R-06) | [Vision](https://platform.claude.com/docs/en/build-with-claude/vision): "An image, therefore, costs `⌈width / 28⌉ × ⌈height / 28⌉` visual tokens"; 1920x1080 → 1,560 |

### Other providers and Copilot billing

| Claim | Verdict | Source |
|---|---|---|
| OpenAI: automatic caching, evicted after 5-10 minutes of inactivity, up to ~1 hour | Correct for `in_memory` only; 24-hour default for non-ZDR orgs (ZDR orgs default to `in_memory`) | [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) |
| OpenAI GPT-5.6+: "explicit breakpoints with a fixed 30-minute minimum TTL" | Partly: implicit by default; 30 minutes is the *default*, 12 hours optional | same |
| OpenAI charges no cache writes | Wrong for GPT-5.6+ (1.25x / 2.5x) | same; [GitHub models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing): "Earlier OpenAI models have no cache write cost." |
| OpenAI reasoning tokens billed as output | Correct | [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning): "they still occupy space in the model's context window and are billed as output tokens." |
| Gemini: implicit caching, no fixed TTL | Correct as "no TTL documented"; explicit cache default TTL unknown (the "1 hour" default is not in Google's docs) | [Gemini caching](https://ai.google.dev/gemini-api/docs/caching): no TTL default stated |
| xAI caching not documented | Wrong: documented, best-effort | [xAI prompt caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/best-practices) |
| A 5+ minute pause exceeds every provider's TTL | Wrong (F-08) | all of the above; [GitHub model hosting](https://docs.github.com/en/copilot/reference/ai-models/model-hosting): Gemini "Cached data is encrypted and held for up to 24 hours." |
| Copilot bills in AI Credits (formerly premium requests) | Correct; per token, 1 credit = $0.01 | [GitHub models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing): "Each token is priced based on the model used, and the total is converted into AI credits, where 1 AI credit = $0.01 USD." |
| Copilot publishes no per-model cache TTL | Correct, but it does document caching | [GitHub model hosting](https://docs.github.com/en/copilot/reference/ai-models/model-hosting) (Anthropic prompt caching; Gemini Durable Caching for up to 24 hours) |

### Client features (Claude Code, VS Code)

| Claim | Verdict | Source |
|---|---|---|
| `/clear` drops history, static prefix still cached | Partly (N-01) | [CC caching](https://code.claude.com/docs/en/prompt-caching#how-the-cache-is-organized): project context (CLAUDE.md, memory) is reloaded "after `/clear` or `/compact`"; [CC sessions](https://code.claude.com/docs/en/sessions#manage-context-within-a-session): "Claude Code saves the previous session; resume it with `/resume`" |
| `/compact` replaces history with a summary | Correct | [CC sessions](https://code.claude.com/docs/en/sessions#manage-context-within-a-session): "`/compact [instructions]`: replace history with a summary"; [CC caching](https://code.claude.com/docs/en/prompt-caching#compacting-the-conversation): "While the cache is warm, that request reads your prefix from the cache" |
| `/rewind` discards later turns and resumes from a cached prefix | Correct | [CC caching](https://code.claude.com/docs/en/prompt-caching#rewinding-the-conversation): "the next request hits the earlier cache entry"; [CC checkpointing](https://code.claude.com/docs/en/checkpointing): "A file that only Bash commands changed isn't tracked" |
| Forking exists | Correct | [CC sessions](https://code.claude.com/docs/en/sessions#branch-a-session) (`/branch`, `/fork`, `--fork-session`); [VS Code fork](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions#fork-a-chat-session) |
| Subagents have their own context and return a summary | Correct | [CC subagents](https://code.claude.com/docs/en/sub-agents): "the subagent does that work in its own context and returns only the summary"; [VS Code subagents](https://code.visualstudio.com/docs/agents/run/subagents): "A subagent works in its own context and returns a focused result to the main agent." |
| Subagent on a cheaper model | Correct | CC subagents: `model` accepts "`sonnet`, `opus`, `haiku`, `fable`, a full model ID … or `inherit`"; VS Code: a subagent model may not exceed the main model's cost tier |
| `copilot-instructions.md` / `AGENTS.md` in every request | Correct, setting-dependent | [VS Code custom instructions](https://code.visualstudio.com/docs/agents/reference/custom-instructions-reference#settings): "Workspace-root `AGENTS.md` is included when `setting(chat.useAgentsMdFile)` is on." |
| `applyTo` instructions are pulled in silently | Correct, setting-dependent (N-05) | same: "In Local, matching file context can attach instructions automatically when `setting(chat.includeApplyingInstructions)` is on." |
| VS Code compacts automatically | Correct | [VS Code manage sessions](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions#compact-conversation-context): "Conversations compact automatically when the context window fills." |
| VS Code checkpoints and editing a previous request | Correct | [VS Code review edits](https://code.visualstudio.com/docs/agents/run/review-code-edits#restore-a-checkpoint): "removes subsequent requests from the conversation history and restores the workspace files" |
| MCP tool set can change mid-session; 128-tool limit | Correct | [VS Code tools](https://code.visualstudio.com/docs/agents/run/tools): "A chat request can have a maximum of 128 tools enabled at a time." |
| Thinking effort can be toggled mid-session | Correct (model picker) | [VS Code language models](https://code.visualstudio.com/docs/agent-customization/language-models#configure-thinking-effort-and-context-size) |
| Images can be attached | Correct, vision models only | [VS Code chat context](https://code.visualstudio.com/docs/chat/copilot-chat-context#vision) |
| Model can be switched mid-chat | Correct | [VS Code language models](https://code.visualstudio.com/docs/agents/concepts/language-models): "You can switch models at any time" |

## Gaps: what the scenarios don't cover

Documented behaviour that matters for AI Credits but has no scenario yet:

1. **Prompt caching in Claude Code is tool-search aware.** MCP tool changes
   don't invalidate the cache when tool search is on, which is the default
   ([CC caching](https://code.claude.com/docs/en/prompt-caching#actions-that-invalidate-the-cache)).
   Scenario 5 shows only the harness-without-tool-search case.
2. **The effort setting and `speed: "fast"` also invalidate the cache**
   (PC table). Setting effort explicitly to the model's default does not.
3. **Mixing 1-hour and 5-minute breakpoints.** 1-hour entries must come
   first, and billing splits three ways
   ([PC: mixing TTLs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#mixing-different-ttls)).
4. **Mid-conversation system messages and inline tools** (newer models) can
   add instructions or tools without invalidating the cache (PC). This
   affects scenarios 5, 10 and 11 on those models.
5. **Compaction drops images and documents** inside the summarized range
   ([compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)).
6. **Copilot SDK `cacheExpiresAt`** gives a per-call cache expiry, a
   first-party signal Analyze mode could show
   ([GitHub Copilot SDK streaming events](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events)).
7. **Promotional prices.** Gemini 3.8 Flash has a Copilot promo through
   2026-12-31 and Gemini 4 Argon through 2026-12-01; post-promo Copilot prices
   are unknown (GitHub models and pricing footnotes).

## Source list

- Current verified rule register (2026-11-04): [learn-rule-register.md](learn-rule-register.md)
- Anthropic: [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
  [extended thinking](https://platform.claude.com/docs/en/build-with-claude/thinking),
  [vision](https://platform.claude.com/docs/en/build-with-claude/vision),
  [cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics),
  [compaction](https://platform.claude.com/docs/en/build-with-claude/compaction),
  [on-demand compaction](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand)
- Claude Code: [prompt caching](https://code.claude.com/docs/en/prompt-caching),
  [sessions](https://code.claude.com/docs/en/sessions),
  [checkpointing](https://code.claude.com/docs/en/checkpointing),
  [subagents](https://code.claude.com/docs/en/sub-agents),
  [commands](https://code.claude.com/docs/en/commands)
- OpenAI: [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching),
  [reasoning](https://developers.openai.com/api/docs/guides/reasoning)
- Google: [Gemini context caching](https://ai.google.dev/gemini-api/docs/caching)
- xAI: [prompt caching best practices](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/best-practices)
- GitHub: [Copilot models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing),
  [model hosting](https://docs.github.com/en/copilot/reference/ai-models/model-hosting),
  [usage-based billing changelog](https://github.blog/changelog/2026/04/27/github-copilot-is-moving-to-usage-based-billing/)
- VS Code: [custom instructions reference](https://code.visualstudio.com/docs/agents/reference/custom-instructions-reference),
  [subagents](https://code.visualstudio.com/docs/agents/run/subagents),
  [manage sessions](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions),
  [review code edits](https://code.visualstudio.com/docs/agents/run/review-code-edits),
  [tools](https://code.visualstudio.com/docs/agents/run/tools),
  [language models](https://code.visualstudio.com/docs/agent-customization/language-models),
  [chat context](https://code.visualstudio.com/docs/chat/copilot-chat-context)
