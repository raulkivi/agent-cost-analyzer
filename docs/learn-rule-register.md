# Learn simulation: rule register (Phase 13, step 13.0)

Status: **draft for owner review** (2026-11-04). Exit criterion of step 13.0:
every vendor × rule cell has a source id or is marked unknown, and the owner
signs off the rules, the cheaper-sibling list and the model-id mapping.
Plan: [plans/vendor-aware-learn-simulation.md](plans/vendor-aware-learn-simulation.md) §5, §7.
Background: [learn-scenarios-fact-check.md](learn-scenarios-fact-check.md).

Method: one research pass per vendor against the vendor's live docs and
GitHub's `models-and-pricing.yml`, checked 2026-11-04. Anything a vendor doesn't
document is **unknown**; no rule is borrowed from another vendor.
Caveats: some quotes come from fetch summaries, not raw pages (rows marked
"para"), so re-read them before they appear in the UI. The two-model scenarios
are 4, 14 and 18.

## Owner decisions needed

1. **Kimi K3 (D1):** Copilot hosts it on Fireworks AI. Moonshot's and
   Fireworks' docs describe automatic prefix caching, but Moonshot bills a cache
   write that GitHub doesn't list. Keep it disabled, or simulate it as best-effort?
   Either way, the disabled reason "caching behaviour isn't documented" is
   inaccurate for Kimi and should be reworded.
2. **xAI cheaper sibling (D4):** all three Grok models are priced the same, so
   xAI has no cheaper sibling. Skip the two-model scenarios (4, 14, 18) for xAI?
3. **OpenAI long-context threshold (S18):** OpenAI says 272K; GitHub lists
   GPT-5.6 Luna at 200K and the others at 272K. Proposal: follow GitHub.
4. **xAI tier boundary (S18):** xAI says ">=200k", GitHub says ">200K". Proposal: follow GitHub.
5. **Claude Code effort change (S11):** Claude Code keeps the cache for some
   5.x models; the API docs say it always misses. Proposal: a Claude Code-only
   override in the profile.
6. **Fact-check corrections:** "OpenAI 24-hour default since May 2026" (earlier
   models) and "Google explicit caching TTL defaults to 1 hour" were not found
   in the vendor docs today. Re-verify or change to unknown.
7. **Google post-promo prices:** unknown for Gemini 4 Argon and 3.8 Flash.
8. **Copilot log ids:** only five are confirmed (`gpt-6-luna`, `gpt-5.3-codex`,
   `gpt-6.1-sol`, `claude-sonnet-4.6`, `claude-sonnet-5`); the rest are inferred
   or unknown. Phase 13.5a real captures should confirm them.


## Rule register, Anthropic column (step 13.0), checked 2026-11-04

Abbreviations: PC = https://platform.claude.com/docs/en/build-with-claude/prompt-caching ; CC = https://code.claude.com/docs/en/prompt-caching ; VIS = https://platform.claude.com/docs/en/build-with-claude/vision ; THK = https://platform.claude.com/docs/en/build-with-claude/thinking ; DIAG = https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics ; GHP = https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing (fetched live).
All "checked" cells = 2026-11-04. Models = the 12 Anthropic models in GHP.

| Rule | Value | Confidence | Source URL | Short verbatim quote | checked |
|---|---|---|---|---|---|
| Caching kind | `breakpoints` (explicit `cache_control`, up to 4, plus optional top-level automatic caching that uses one slot) | documented | PC | "You can define up to 4 cache breakpoints" ; "the automatic cache breakpoint uses one of the 4 available breakpoint slots" | 2026-11-04 |
| Where Copilot places breakpoints | unknown (not in any Anthropic doc; belongs in profile `assumptions`) | unknown | - | - | 2026-11-04 |
| Lookback | breakpoint reads look back at most 20 positions; writes only at breakpoints | documented | PC | "The system checks at most 20 positions for each breakpoint" ; "Cache writes occur only at your breakpoint." | 2026-11-04 |
| Default TTL | 5 min | documented | PC | "By default, the cache has a 5-minute lifetime." | 2026-11-04 |
| Extended TTL | 1 h via `"ttl": "1h"`; 1 h entries must precede 5 min entries | documented | PC | "a 1-hour cache entry must appear before any 5-minute cache entries" | 2026-11-04 |
| Which TTL Copilot requests | unknown (GitHub docs not re-checked here; no Anthropic doc covers Copilot) | unknown | - | - | 2026-11-04 |
| Which TTL Claude Code requests (harness rule, S-CC) | main conversation: 1 h on Claude subscription within plan usage, else 5 min; subagents/forks/compaction/titles: 5 min (except server-controlled helpers); override `promptCacheTtl` / `CLAUDE_CODE_PROMPT_CACHE_TTL`, `subagentPromptCacheTtl` | documented | CC#cache-lifetime | "Main conversation \| One hour \| Five minutes" (subscription-in-plan vs API key/credits/cloud) ; "Subagents fall outside the main-conversation TTL bucket, so they get five minutes even on a subscription" | 2026-11-04 |
| Refresh on hit | yes, free | documented | PC | "The cache is refreshed for no additional cost each time the cached content is used." | 2026-11-04 |
| TTL clock origin | start of the request that writes or reads the entry, not end of response | documented | PC | "The lifetime is measured from the start of the request that writes or reads the cache entry, not from the end of its response." | 2026-11-04 |
| Entry readable only after first response starts (concurrency / fork) | documented in fact-check; not re-located in the part of PC fetched | inferred (from fact-check quote, not re-verified live) | docs/learn-scenarios-fact-check.md claim register | "a cache entry only becomes available after the first response starts" | 2026-11-04 |
| Min cacheable tokens, Claude Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Opus 5 / Fable 5 / Fable 5.1 | 512 | documented | PC#cache-limitations | "512 tokens: Claude Fable 5.1, Claude Mythos 5.1, Claude Opus 5.5, Claude Opus 5, Claude Sonnet 5.5, Claude Fable 5, Claude Mythos 5, and Claude Haiku 5.5" | 2026-11-04 |
| Min cacheable tokens, Claude Sonnet 5 / Opus 4.8 / Sonnet 4.6 / Sonnet 4 | 1,024 | documented | PC#cache-limitations | "1,024 tokens: Claude Opus 4.8, Claude Sonnet 5, Claude Sonnet 4.6, ... Claude Sonnet 4 (retired, except on ...)" | 2026-11-04 |
| Min cacheable tokens, Claude Haiku 4.5 | 4,096 | documented | PC#cache-limitations | "4,096 tokens: Claude Haiku 4.5" | 2026-11-04 |
| Min cacheable tokens, Opus 4.8 (fast mode) | 1,024 assumed (same model as Opus 4.8; fast is a speed setting) | inferred | PC | "Switching between `speed: \"fast\"` and standard speed invalidates system and message caches" | 2026-11-04 |
| Below-minimum behaviour | silently uncached, no error | documented | PC | "Any requests to cache fewer than this number of tokens are processed without caching, and no error is returned." | 2026-11-04 |
| Cache write multiplier, 5 min | 1.25x base input | documented | PC#pricing | "Cache write tokens with a 5-minute TTL are 1.25 times the base input tokens price." | 2026-11-04 |
| Cache write multiplier, 1 h | 2x base input | documented | PC#pricing | "Cache write tokens with a 1-hour TTL are 2 times the base input tokens price." | 2026-11-04 |
| Cache read multiplier, default | 0.1x base input | documented | PC#pricing | "Cache read tokens are 0.1 times the base input tokens price (see the table footnote for per-model exceptions)." | 2026-11-04 |
| Cache read multiplier, Opus 5.5 / Sonnet 5.5 | 0.05x | documented | PC#pricing | "Cache hits and refreshes on Claude Opus 5.5 and Claude Sonnet 5.5 are priced at 0.05x the base input price." | 2026-11-04 |
| Cache read multiplier, Fable 5.1 | 0.025x (NEW vs fact-check, which names only Opus/Sonnet 5.5) | documented | PC#pricing | "Cache hits and refreshes on Claude Fable 5.1 and Claude Mythos 5.1 are priced at 0.025x the base input price." | 2026-11-04 |
| Cache read multiplier, Fable 5, Opus 5, Opus 4.8, Sonnet 5, Sonnet 4.6, Sonnet 4, Haiku 5.5, Haiku 4.5 | 0.1x ("All other models use the standard 0.1x multiplier") | documented | PC#pricing | "All other models use the standard 0.1x multiplier." | 2026-11-04 |
| Read price independent of TTL that wrote it | single "cache hits and refreshes" price per model | documented (table has one column) | PC#pricing | table column "Cache hits & refreshes" | 2026-11-04 |
| GHP prices agree with PC (USD/M: input / cached / write(5m) / output) | Haiku 4.5 1/0.10/1.25/5; Haiku 5.5 <=100K 0.10/0.01/0.125/0.50, >100K 0.50/0.05/0.625/2.50; Sonnet 4 and 4.6 3/0.30/3.75/15; Sonnet 5 2/0.20/2.50/10; Sonnet 5.5 2/0.10/2.50/10; Opus 4.8 and 5 5/0.50/6.25/25; Opus 5.5 4/0.20/5/20; Fable 5 10/1.00/12.50/50; Fable 5.1 10/0.25/12.50/50; Opus 4.8 fast 10/1.00/12.50/50 | documented (GHP); 1 h write price not in GHP, derive 2x input per PC | GHP ; PC#pricing | GHP: "all Anthropic models include a cache write cost" ; PC 1 h column e.g. Sonnet 5.5 "$4 / MTok" | 2026-11-04 |
| Haiku 5.5 long-context tier | prompt >100,000 tokens uses the higher tier; cache reads/writes count toward prompt length | documented | PC#pricing | "On a model priced by prompt length, cache reads and cache writes count toward a request's prompt length." | 2026-11-04 |
| Opus 4.8 (fast mode) 1 h write | PC lists no fast-mode row; 2x $10 = $20 is an extrapolation | unknown | - | - | 2026-11-04 |
| Output/input price ratio | 5x for every Copilot Anthropic model (Haiku 4.5 5/1, Haiku 5.5 0.5/0.1, Sonnet 5/5.5 10/2, Sonnet 4/4.6 15/3, Opus 4.8/5 25/5, Opus 5.5 20/4, Fable 5/5.1 50/10); confirms fact-check R-05 | documented | PC#pricing ; GHP | table rows (computed) | 2026-11-04 |
| Layer order (S1) | tools -> system -> messages; change invalidates that level and all after | documented | PC#what-invalidates-the-cache | "the cache follows the hierarchy: `tools` -> `system` -> `messages`. Changes at each level invalidate that level and all subsequent levels." | 2026-11-04 |
| Usage fields (S2) | total input = cache_read + cache_creation + input_tokens; `input_tokens` = tokens after last breakpoint | documented | PC | "total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens" | 2026-11-04 |
| Invalidation: tools change (S10) | tools, system, messages all invalidated | documented | PC#what-invalidates-the-cache | "Modifying tool definitions (names, descriptions, parameters) invalidates the entire cache" | 2026-11-04 |
| Invalidation: tool-set change in Claude Code | with tool search (default on supported models) deferred MCP tools do not change the prefix, so no invalidation; without it, adding/removing a definition invalidates | documented | CC#connecting-or-removing-an-mcp-server | "Tools deferred: Claude Code keeps the tool list from the conversation's first request for the whole conversation" | 2026-11-04 |
| Invalidation: system change (S9) | system + messages; tools stay | documented | PC (hierarchy) | "Changes at each level invalidate that level and all subsequent levels." | 2026-11-04 |
| Invalidation: web search / citations toggle | system + messages (tools kept) | documented | PC table | "Enabling/disabling web search modifies the system prompt" | 2026-11-04 |
| Invalidation: mid-conversation system message / inline tools | no invalidation on Fable 5.1, Fable 5, Opus 5.5, Opus 4.8, Opus 5, Sonnet 5.5, Haiku 5.5 (not Sonnet 5); inline tools need beta header | documented | PC | "you can add a new system instruction partway through a conversation without invalidating the system or message caches" ; "This feature is not available on Claude Sonnet 5." | 2026-11-04 |
| Invalidation: image added/removed (S8) | messages only; tools and system kept | documented | PC table | "Adding/removing images anywhere in the prompt affects message blocks" | 2026-11-04 |
| Invalidation: `tool_choice` change (S8) | messages only | documented | PC table | "Changes to the `tool_choice` parameter only affect message blocks" | 2026-11-04 |
| Invalidation: thinking change (S11) | messages always; tools and system on models that render config ahead of them. Which models: not listed in the docs | documented (rule) / unknown (per-model list) | PC table ; THK#thinking-and-prompt-caching | "changing it always invalidates message blocks; tool and system caches are also invalidated on models that render the configuration ahead of them." | 2026-11-04 |
| Invalidation: effort change (S11) | same as thinking (messages always; tools/system model-specific); explicit default == omitted; per-message effort via `role:"system"` message keeps prefix. Claude Code: cache KEPT on Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1 (API key / subscription), invalidated otherwise | documented | PC table ; CC#changing-effort-level | "On Opus 5.5, Sonnet 5.5, Haiku 5.5, and Fable 5.1 with an API key or a Claude subscription, you keep the cache when you change effort." | 2026-11-04 |
| Invalidation: dropped thinking blocks / non-tool-result turn | Opus 4.5+, Sonnet 4.6+, Haiku 5.5: thinking preserved, cache valid; earlier Opus/Sonnet and Haiku through 4.5: thinking stripped, later messages dropped from cache | documented | PC table | "On earlier Opus/Sonnet models and Haiku models through Claude Haiku 4.5, all previously-cached thinking blocks are stripped from context" | 2026-11-04 |
| Invalidation: speed (fast mode) toggle | system + messages invalidated (PC table); separate caches per speed | documented | PC table ; CC#turning-on-fast-mode | "Fast mode and standard speed keep separate caches" | 2026-11-04 |
| Invalidation: model switch (S12) | nothing carries over; cache is per model | documented | DIAG ; CC#switching-models | "The cache is per-model." ; "Each model has its own cache." | 2026-11-04 |
| Invalidation: compaction (S13) | conversation layer replaced by summary; system prompt layer stays cached; project context read from cache only if CLAUDE.md/memory unchanged; summarization request reads warm prefix; next turn writes only the short summary | documented | CC#compacting-the-conversation | "By design, this invalidates the conversation layer" ; "While the cache is warm, that request reads your prefix from the cache." | 2026-11-04 |
| Compaction, API level | `cache_control` on the compaction block places a breakpoint after the summary; images/documents in summarized range are lost | documented | https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand | "`cache_control` on the block places a breakpoint after the summary." | 2026-11-04 |
| Invalidation: `/clear` (S14) | history dropped; project context (CLAUDE.md, memory) reloaded after `/clear` or `/compact`, so it hits only if unchanged. Docs do not state `/clear` outcome in the cache page beyond the layer table | documented (layer table) / inferred (full /clear outcome) | CC#how-the-cache-is-organized | "Project context \| CLAUDE.md, auto memory, unscoped rules \| Session starts, or after `/clear` or `/compact`" | 2026-11-04 |
| Invalidation: rewind (S15) | next request hits the earlier cache entry (system + project context unchanged); turns since kept entry warm | documented | CC#rewinding-the-conversation | "the next request hits the earlier cache entry. Every turn since then has read through that prefix, which kept the entry warm even if the original turn was longer ago than the TTL." | 2026-11-04 |
| Invalidation: fork (S15) | fork inherits system prompt, tools and history exactly; first request reads parent's cache; `/fork` session copy keeps cache (isolation instruction appended at end) | documented | CC#subagents-and-the-cache | "A fork, by contrast, inherits the parent's system prompt, tools, and conversation history exactly, so its first request reads the parent's cache." | 2026-11-04 |
| Invalidation: subagent (S16) | own system prompt and tools; first request does not read parent's cache; parent prefix unaffected; subagent TTL 5 min by default | documented | CC#subagents-and-the-cache | "Its first request doesn't read the parent's cache, because the two prefixes differ" ; "The parent's cache is unaffected." | 2026-11-04 |
| Invalidation: CLAUDE.md edit mid-session, permission mode, output style, skills, plugin skills/hooks | no invalidation (appended as messages or not applied until `/clear`/`/compact`/restart) | documented | CC#actions-that-keep-the-cache | "Editing them mid-session does not invalidate the cache, but the edit also doesn't apply." | 2026-11-04 |
| Invalidation: images accumulating in Claude Code | oldest image batch removed, reprocessing from earliest affected message onward (one slow turn per batch) | documented | CC#accumulating-many-images | "the next request reprocesses the conversation from the earliest of those messages onward" | 2026-11-04 |
| Cache isolation | per workspace (Claude API, AWS, Foundry); per organization on Bedrock / Google-managed | documented | PC | "Prompt caching uses workspace-level isolation." | 2026-11-04 |
| Exact match requirement | 100% identical prefix segments | documented | PC | "Cache hits require 100 percent identical prompt segments" | 2026-11-04 |
| Image token formula | ceil(w/28) x ceil(h/28) visual tokens (28x28 patches) | documented | VIS#evaluate-image-size | "An image, therefore, costs `⌈width / 28⌉ × ⌈height / 28⌉` visual tokens." | 2026-11-04 |
| Image caps, standard tier (all models before 4.7: Haiku 4.5, Sonnet 4, Sonnet 4.6) | long edge 1,568 px, max 1,568 visual tokens | documented | VIS | "Standard \| All other models \| 1,568 px \| 1,568" | 2026-11-04 |
| Image caps, high-resolution tier ("Claude 4.7 and later": Opus 4.8, Opus 5, Opus 5.5, Sonnet 5, Sonnet 5.5, Haiku 5.5, Fable 5, Fable 5.1) | long edge 2,576 px, max 4,784 visual tokens. Applying "4.7 and later" to Haiku 5.5 / Fable is a reading of the version number | documented (rule) / inferred (model mapping) | VIS | "High-resolution \| Claude 4.7 and later models \| 2,576 px \| 4,784" | 2026-11-04 |
| Image token examples | 1920x1080: 1,560 standard, 2,691 high-res; 1000x1000: 1,296 both; 3840x2160: 1,560 / 4,784 | documented | VIS | "1920x1080 px ... 1456x819 px \| 1,560 \| Not resized \| 2,691" | 2026-11-04 |
| Image request limits | 100 images/request for 200k-context models, 600 otherwise; 8000x8000 px max; 10 MB per image (API) | documented | VIS#request-limits | "100 for each request on the API, for models with a 200k-token context window ; 600 ... for all other models" | 2026-11-04 |
| Whether an image counts toward the cacheable prefix minimum / image token cost when cached | image tokens are ordinary prefix tokens once in messages; not stated explicitly | unknown | - | - | 2026-11-04 |
| Thinking tokens billing | billed as output tokens (from fact-check; not re-fetched) | inferred (fact-check) | docs/learn-scenarios-fact-check.md | "the tokens Claude spends reasoning are billed as output tokens, even when the thinking text isn't returned to you" | 2026-11-04 |

### Curated cheaper-sibling candidates (Anthropic, for owner review)
Proposed only; not from a vendor doc (editorial choice). Prices from GHP:
- Opus 5.5 ($4) -> Sonnet 5.5 ($2) or Haiku 5.5 ($0.10)
- Opus 5 / Opus 4.8 ($5) -> Sonnet 5 ($2)
- Fable 5 / Fable 5.1 ($10) -> Opus 5.5
- Sonnet 5.5 / Sonnet 5 / Sonnet 4.6 -> Haiku 5.5
- Haiku 4.5 -> Haiku 5.5
- Sonnet 4, Opus 4.8 (fast mode): confidence unknown; owner decision.
Constraint noted in fact-check N-04: VS Code subagent model may not exceed main model's cost tier.

### Contradictions / deltas versus docs/learn-scenarios-fact-check.md and the plan
1. S11 (plan) says effort change always invalidates messages. Claude Code docs: on Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1 the cache is KEPT on effort change (API key / subscription). API-level PC still says messages always miss; the two differ, so the profile needs a harness-level override for Claude Code only (Copilot behaviour unknown).
2. Fact-check R-05 and claim register name 0.05x only for Opus/Sonnet 5.5. Live PC adds Fable 5.1 (and Mythos 5.1) at 0.025x; GHP shows Fable 5.1 cached $0.25 vs Fable 5 $1.00. S5/Pricer must not assume 0.1x or 0.05x globally.
3. Fact-check N-03 min-token range "512-4,096" is right, but exact per model is now: 512 (Fable 5/5.1, Opus 5/5.5, Sonnet 5.5, Haiku 5.5), 1,024 (Sonnet 5, Sonnet 4.6, Sonnet 4, Opus 4.8), 2,048 (Opus 4.7), 4,096 (Opus 4.6/4.5, Haiku 4.5). Opus 4.7 at 2,048 is a middle value the fact-check range does not name.
4. S14 (plan): "tools and system still match" after `/clear`. CC doc supports system prompt layer; project context reloaded and hits only if unchanged (already in S14 wording). No contradiction, but the CC page has no explicit `/clear` row beyond the layer table, so the full `/clear` outcome is inferred.
5. Fact-check says "Caches are isolated per organization: out of date, per workspace". Confirmed; Bedrock/Google-managed remain per org. Copilot is neither: isolation for Copilot unknown.
6. Plan S3/S1 are for the API; Claude Code adds a harness TTL rule (1 h main conversation on subscription, 5 min otherwise, subagents 5 min) absent from the fact-check. Copilot's TTL is unknown, so any simulation of Copilot-hosted Claude must mark TTL assumed (5 min default).
7. Not found in the docs fetched: GHP's Opus 4.8 (fast mode) row has no matching PC row; Mythos models appear in PC but not in Copilot.
8. Plan S2 conflicts with nothing: formula re-verified verbatim.

## Rule register, OpenAI column (step 13.0), checked 2026-11-04

Sources: PC = https://developers.openai.com/api/docs/guides/prompt-caching ; PR = https://developers.openai.com/api/docs/pricing ; IMG = https://developers.openai.com/api/docs/guides/images-vision ; GH = https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
Families: NEW = GPT-5.6+ (5.6, 6, 6.1); G55 = GPT-5.5/5.5 Pro; OLD = other earlier (5.4, 5.3-Codex, 5.2, 5.1, 5, 4.1, 4o...). Quotes marked (para) are WebFetch paraphrase/summary, not confirmed verbatim: re-check on the page before quoting.

| Rule | Value | Confidence | Source | Quote | checked |
|---|---|---|---|---|---|
| Caching kind, all | Automatic prefix, on by default | documented | PC | "Prompt caching is enabled by default for supported OpenAI models." | 2026-11-04 |
| Caching kind, NEW | Implicit (default) plus optional explicit breakpoints (`prompt_cache_options.mode=explicit`, up to 4 writes/request); explicit mode with no breakpoints = no caching | documented | PC | "When no explicit breakpoints are placed, the request does not use prompt caching or create cache writes." | 2026-11-04 |
| Implicit breakpoint, NEW | OpenAI places one at end of latest eligible message | documented | PC | "OpenAI places a breakpoint at the end of the latest eligible message." | 2026-11-04 |
| Caching kind, G55/OLD | Implicit only | documented | PC | (para) "implicit only" | 2026-11-04 |
| Min cacheable tokens, NEW | 1,024 | documented | PC | "The minimum cacheable prompt length is 1,024 tokens for GPT-5.6 and later." | 2026-11-04 |
| Min cacheable tokens, G55/OLD | Varies with request settings (tools, images, output schemas, reasoning effort, verbosity); exact number not extracted | unknown (do not assume 1,024) | PC | (para) "minimum varies with request settings" | 2026-11-04 |
| Increment, G55 | 2,048-token breakpoint intervals | documented | PC | "Spaced at regular 2,048-token intervals." | 2026-11-04 |
| Increment, OLD | Reported cached_tokens rounded down to multiple of 128; breakpoint interval model-dependent | documented (128 for reporting); interval unknown | PC | "rounding down to the nearest multiple of 128." | 2026-11-04 |
| Increment, NEW | Not stated (breakpoint at end of latest eligible message) | unknown | PC | - | 2026-11-04 |
| TTL, NEW | Default 30 min; 12 h option (`prompt_cache_options.ttl`, Responses API); minimum lifetime, not a cap | documented | PC | "set `prompt_cache_options.ttl` to choose the minimum cache lifetime." | 2026-11-04 |
| TTL, G55 | `prompt_cache_retention` "24h" only; in-memory value not listed | documented (para) | PC | (para) 'with `"24h"` only' | 2026-11-04 |
| TTL, OLD | `in_memory`: 5-10 min inactivity, up to 1 h; `24h`: up to 24 h. Fact-check says 24 h is default for non-ZDR orgs since May 2026 (not re-confirmed on page) | documented (in_memory/24h); default unknown | PC | "Entries typically remain active for around 5 to 10 minutes of inactivity, up to one hour." | 2026-11-04 |
| TTL refresh on hit | Not stated | unknown | PC | - | 2026-11-04 |
| Cache write charge, NEW | Yes: 1.25x uncached input (30 min), 2.5x (12 h); "not an additive fee" (write replaces input charge) | documented | PC, PR, GH | "cache writes cost 1.25× the standard, uncached input-token rate for the default 30-minute lifetime." / "2.5× the uncached input-token rate." | 2026-11-04 |
| Cache write charge, G55/OLD | None | documented | PC, GH | "No additional cache-write charge." / GH: "Earlier OpenAI models have no cache write cost." | 2026-11-04 |
| Cache read multiplier, NEW | 0.1x input on most; 0.05x on GPT-6.1 Sol and Terra. Price tables: 6.1 Sol 0.10/2.00, 6.1 Terra 0.05/1.00 (0.05x); 6-Sol, 6-Astra, 5.6-Sol/Terra/Luna, 6-Luna all 0.1x | documented | PC, PR | "Subsequent reads cost 0.1× the ordinary input rate on most of these models" | 2026-11-04 |
| Cache read multiplier, OLD | GPT-5.x 0.1x (5.4: .25/2.5; 5.2/5.1/5: 0.1x); gpt-4.1 and o3 0.25x; gpt-4o 0.5x; 5.5 0.1x. Derived from price table | documented (price table) | PR | table rows, e.g. gpt-4.1 $2.00 input / $0.50 cached | 2026-11-04 |
| Layer order | Stable content first (developer instructions, shared reference), dynamic last. Exact tools/system/messages render order not stated | documented (principle); order unknown | PC | "Put stable developer instructions and shared reference material first." | 2026-11-04 |
| Invalidation: general | Any change invalidates from first changed token onward | documented | PC | "Cache reuse requires the entire rendered prefix to match." / "the prefix after that change cannot match the existing cache entry." | 2026-11-04 |
| Invalidation: tools change | Tool names, descriptions, schemas, ordering, tool instructions change the prefix | documented | PC | "Changes tool names, descriptions, schemas, ordering, or tool-specific instructions." | 2026-11-04 |
| Invalidation: system/instructions change | Prefix change from that point (general rule); no layer-specific scoping stated | inferred from general rule | PC | "Put stable developer instructions ... first." | 2026-11-04 |
| Invalidation: image add/remove | Images affect minimum length; invalidation behaviour not stated | unknown | PC | "tools, images, output schemas, reasoning effort, and verbosity" (min length only) | 2026-11-04 |
| Invalidation: model switch | Different model, different cache | documented | PC | "A different model can use different weights and caching behavior." | 2026-11-04 |
| Invalidation: reasoning effort change | Can change model-side reasoning instructions (so prefix); also affects min length | documented (weakly) | PC | "Can change model-side reasoning instructions." | 2026-11-04 |
| Invalidation: compaction | Can prevent reuse from first changed token onward | documented | PC | "can prevent reuse from the first changed token onward." | 2026-11-04 |
| Other settings affecting hits | parallel_tool_calls, text.format, text.verbosity | documented (para) | PC | (para) | 2026-11-04 |
| prompt_cache_key | NEW: not needed; old: routing hint, no guarantee | documented | PC | "the key is not needed to optimize caching." | 2026-11-04 |
| Reasoning tokens | Billed as output | documented | https://developers.openai.com/api/docs/guides/reasoning (via fact-check) | "billed as output tokens" | 2026-11-04 (not re-fetched) |
| Tier threshold S18, OpenAI API | Long context >272K input: NEW and 5.5/5.4 only. Tier prices ~2x input, cached, writes; output 1.5x | documented | PR | "Short context: ≤272K input tokens. Long context: >272K input tokens." | 2026-11-04 |
| Tier threshold S18, GitHub | >272K for 5.6 Sol/Terra, 6 *, 6.1 *; **>200K for GPT-5.6 Luna** (OpenAI API says 272K for 5.6-luna): contradiction between vendor page and GH page; Copilot billing follows GH | documented (GH) / conflict | GH vs PR | GH: "GPT-5.6 Luna ... Long context > 200K" | 2026-11-04 |
| Tiering, OLD in GH | GPT-5.3-Codex, 5.4 nano: single tier (N/A threshold). GH lists no 5.4 / 5.5 long tier though OpenAI does | documented (GH) | GH | "Default / N/A" | 2026-11-04 |
| Image tokens (D15), patch family (gpt-6-astra, 5.6 *, 5.5, 5.4 *, 5.2, 4.1-mini) | patches = ceil(w/32)*ceil(h/32), after resize limits and patch budget; tokens = ceil(patches * 1.2) (4.1-mini 1.62; 5-nano 1.5). >30,000 patches rejected. Limits: low fits 512x512 (NEW/5.5); high 2,500 patches, 2048/side (5.5, 5.4, 5.6 Sol/Terra/Luna); original: 10,000 patches/6000 px (5.5, 5.4) or full up to 65,535 px (NEW); 5.4/5.2 low = 2048 px/6,144-patch budget; default detail auto. Exact budget-shrink formula in IMG | documented (paraphrase of page; re-read formula before coding) | IMG | (para) "patch_count = ceil(width/32) x ceil(height/32)" | 2026-11-04 |
| Image tokens, tile family (gpt-5.1, 4.1, 4o, 4o-mini) | low = base only; high: fit 2048 square, shortest side to 768, count 512 tiles; total = base + tiles*tile. gpt-5.1 70/140; 4o, 4.1 85/170; 4o-mini 2833/5667 (deprecated: gpt-5 70/140, o3 75/150) | documented (para) | IMG | (para) | 2026-11-04 |

### Contradictions with docs/learn-scenarios-fact-check.md
- None on cache rules: F-08/F-09/F-10 and the "Other providers" rows agree with the PC page (30 min default, 12 h option, 1.25x/2.5x writes, none earlier).
- Fact-check row says "24-hour default ... since May 2026" for earlier models: current PC text only says `in_memory` or `24h`; default not confirmed. Mark default unknown until re-read.
- Fact-check says OpenAI pages were fetched via search excerpts (medium confidence) in the original source list; this run fetched them directly (WebFetch summaries, not raw), so quotes marked (para) still need exact-wording check.
- New facts not in fact-check: 0.05x read for GPT-6.1 Sol/Terra; Luna 200K (GH) vs 272K (OpenAI) tier threshold; G55 2,048-token interval and 24h-only retention; explicit breakpoints produce no caching when none set.

## Rule register: Google (Gemini) in GitHub Copilot, checked 2026-11-04

Doc URLs: ai.google.dev/gemini-api/docs/* now 301-redirects to aistudio.google.com/docs/* (same content). Copilot pricing page: https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing . Hosting page: https://docs.github.com/en/copilot/reference/ai-models/model-hosting

| Rule | Value | Confidence | Source URL | Short verbatim quote | checked |
|---|---|---|---|---|---|
| Caching kind (Gemini API) | Implicit, on by default for Gemini 2.5+; explicit (manual cache objects) exists only on generateContent for Gemini 3 / 2.5, not Argon+ | documented | https://aistudio.google.com/docs/caching | "Implicit caching is enabled by default for all Gemini 2.5 and newer models." / "switch to the generateContent API" for explicit | 2026-11-04 |
| Caching kind as used by Copilot | Copilot uses "Google's Durable Caching"; whether it is implicit or explicit is not stated | documented (name), unknown (mechanism) | https://docs.github.com/en/copilot/reference/ai-models/model-hosting | "GitHub uses Google's Durable Caching" | 2026-11-04 |
| Implicit cache TTL | No TTL documented | unknown | https://aistudio.google.com/docs/caching | page has no TTL text; only "Try to send requests with similar prefix in a short amount of time" | 2026-11-04 |
| Explicit cache TTL default / max | Default 1 hour per fact-check F-09; max not documented. NOT reproducible: the caching pages fetched today contain no "TTL" text | unknown (re-verify; fact-check cites it) | https://ai.google.dev/gemini-api/docs/caching | fact-check quote: "If not set, the TTL defaults to 1 hour" (absent in today's fetch) | 2026-11-04 |
| Copilot's own cache lifetime | Up to 24 hours | documented | model-hosting URL above | "Cached data is encrypted and held for up to 24 hours." (upper bound on retention, not a guaranteed hit window) | 2026-11-04 |
| Minimum cacheable tokens (implicit) | 4,096 for Gemini 4 Argon, 3.8 Flash, 3.6 Flash, 3.1 Pro Preview; 2,048 for 2.5 Flash and 2.5 Pro. Other models (3.5 Flash-Lite etc.) not listed | documented | https://aistudio.google.com/docs/caching | "The following table lists the minimum input token count for each model" | 2026-11-04 |
| Multi-turn rule, Gemini 4 | Previous request is cached in full only if the new request adds at least 2,050 tokens; otherwise the last 2,050 tokens of the previous request are reprocessed at standard input rate | documented | https://aistudio.google.com/docs/caching | "Gemini caches the full previous request only if the new request adds at least 2,050 tokens." | 2026-11-04 |
| Storage / write charge, Copilot | None listed for Gemini (no cache-write column value) | documented (absence) | https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing | Gemini rows list Input, Cached input, Output only | 2026-11-04 |
| Storage charge, Gemini API explicit | Per 1M tokens per hour: 3.8/3.6 Flash $0.50 (-> $1.00 Jan 1 2027); 3.5 Flash-Lite, 3.1 Flash-Lite, 3 Flash Preview, 2.5 Flash/Flash-Lite $1.00; 3.1 Pro Preview, 2.5 Pro $4.50. Argon: not listed (implicit only). Not billed in Copilot | documented (API only) | https://aistudio.google.com/docs/pricing | table column "Cache storage / 1M tokens/hour" | 2026-11-04 |
| Cache read multiplier (Copilot) | 3.8 Flash $0.075 / $0.75 = 0.10x; Argon $0.10 / $2.00 = 0.05x. Derived from price table | documented (prices), inferred (ratio) | models-and-pricing URL | Gemini 3.8 Flash input $0.75, cached $0.075; Argon input $2.00, cached $0.10 | 2026-11-04 |
| Cache read multiplier (Gemini API) | 3.1 Pro 0.10x; 3.8 Flash 0.10x; Argon 0.05x; 3.5 Flash-Lite 0.10x; 2.5 Pro 0.10x. No generic percent stated in prose | documented (prices) | https://aistudio.google.com/docs/pricing | "Context cache read" column | 2026-11-04 |
| Layer order | Only advice: large, common content first. No documented tools/system/messages order | unknown (advice documented) | https://aistudio.google.com/docs/caching | "Try putting large and common contents at the beginning of your prompt" | 2026-11-04 |
| Invalidation: tools change | Not documented | unknown | - | caching page has no invalidation section | 2026-11-04 |
| Invalidation: system prompt change | Not documented (prefix match implied by the "beginning of prompt" advice only) | unknown | - | same | 2026-11-04 |
| Invalidation: image added/removed | Not documented | unknown | - | same | 2026-11-04 |
| Invalidation: model switch | Not documented for Gemini (caches are per model in the API; no quote) | unknown | - | same | 2026-11-04 |
| Invalidation: thinking change | Not documented | unknown | - | same | 2026-11-04 |
| Invalidation: compaction | Not documented (any prefix rewrite is a vendor-neutral fact, not a Google rule) | unknown | - | same | 2026-11-04 |
| Tiered pricing S18, Copilot | None: only a Default tier, "Not applicable" threshold, for Gemini 3.8 Flash and Argon | documented | models-and-pricing URL | Tier "Default", Threshold "Not applicable" | 2026-11-04 |
| Tiered pricing S18, Gemini API | 200k prompt threshold on 3.1 Pro Preview ($2->$4 in, $12->$18 out, $0.20->$0.40 cache) and 2.5 Pro. Not applicable to Copilot models listed | documented (API only) | https://aistudio.google.com/docs/pricing | "$2.00 (<=200k) / $4.00 (>200k)" | 2026-11-04 |
| Promo pricing: Gemini 3.8 Flash | $0.75 in / $0.075 cached / $3.75 out through 2026-12-31 (API: rises to $1.50 / $0.15 / $7.50 on 2027-01-01). Post-promo Copilot price unknown | documented (end date), unknown (Copilot post-promo price) | models-and-pricing URL; API pricing URL | "available at the promotional pricing of $0.75 per 1M input tokens" through December 31, 2026 | 2026-11-04 |
| Promo pricing: Gemini 4 Argon | $2.00 in / $0.10 cached / $10.00 out. Copilot says until 2026-12-01; API says "$2.00 through November 30, 2026", then $4.00 / $0.20 / $20.00 | documented | same | "promotional pricing of $2.00 per 1M input tokens" until December 1, 2026 | 2026-11-04 |
| Image token formula D15 | Both dims <=384 px: 258 tokens. Larger: tiled into 768x768 tiles at 258 tokens each; tile count estimated via crop unit floor(min(w,h)/1.5), then ceil-style division of each dim (example 960x540 -> unit 360 -> 3x2 = 6 tiles = 1,548 tokens). Gemini 3 media_resolution sets a per-image max; allowed values not confirmed. Whether Copilot sends images this way: unknown | documented (API), unknown (Copilot path / Gemini 3.8+ / 4) | https://aistudio.google.com/docs/image-understanding | "258 tokens if both dimensions <= 384 pixels." / "Larger images are tiled into 768x768 pixel tiles, each costing 258 tokens." | 2026-11-04 |

### Contradictions with docs/learn-scenarios-fact-check.md
- Line 258 / F-09 "explicit caching defaults to 1 hour" cites the caching page; that page (both generateContent and Interactions variants, fetched today) contains no TTL text. Re-verify or mark unknown. Line 45 already rates Google sources "medium".
- Line 258 "Gemini: implicit caching, no fixed TTL" is correct only as "no TTL documented".
- Line 260/262 (24 hours) confirmed verbatim. But "held for up to 24 hours" is a data-retention bound, not proof of a 24-hour hit window; do not model it as a guaranteed TTL.
- Line 304 promo note: Argon promo ends 2026-12-01 (Copilot) / 2026-11-30 (API); 3.8 Flash ends 2026-12-31. Check the plan uses these exactly.
- Plan §5 S18 lists "OpenAI, xAI, Haiku 5.5" only: consistent, Google Copilot models have no tier.

### Notes
- Gemini API pricing page tail (chars 100000+) unread.
- Copilot models-and-pricing lists only Gemini 3.8 Flash and Gemini 4 Argon; 3.6 Flash / 3.1 Pro etc. are API-only here.

## Phase 13.0 rule register: xAI column + Moonshot/Microsoft verdicts

checked 2026-11-04. Quotes are verbatim from WebFetch extractions (small-model summaries of the pages; re-verify before quoting in UI).

Short URLs: XB = https://docs.x.ai/developers/advanced-api-usage/prompt-caching/best-practices ; XM = .../prompt-caching/multi-turn ; XH = .../prompt-caching/how-it-works ; XU = .../prompt-caching/usage-and-pricing ; XP = https://docs.x.ai/developers/models ; GP = https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing ; GH = https://docs.github.com/en/copilot/reference/ai-models/model-hosting

### xAI (Grok 4.5 / 4.6 / 4.7 in Copilot, "hosted on xAI")

| Rule | Value | Confidence | Source URL | Short verbatim quote | checked |
|---|---|---|---|---|---|
| Caching kind | automatic, prefix-based, not guaranteed. Use `best-effort` (D5 holds) | documented | https://docs.x.ai/developers/advanced-api-usage/prompt-caching ; XB | "The xAI API performs prompt caching automatically." / "Eviction and routing mean cache hits aren't guaranteed." | 2026-11-04 |
| Applies to Copilot-hosted Grok | hosting is xAI; whether Copilot sets `x-grok-conv-id` / `prompt_cache_key` is not stated | unknown | GH | "These models are hosted on xAI." (nothing on routing headers) | 2026-11-04 |
| Cache lifetime (TTL) | none stated. Only "evicted at any time"; keep as assumed value in assumptions popover | unknown (no TTL) | XB ; XH | "Cache entries can be evicted at any time due to server load or restarts." | 2026-11-04 |
| Minimum cacheable tokens | not stated | unknown | XB, XU, XP | (absent on all pages) | 2026-11-04 |
| Cache write charge | none stated on xAI pages; GitHub table lists no write price for xAI | documented-by-absence: treat write = 0 (GP) but xAI silent | GP | "None of these providers has a cache write cost listed." (page summary; GP) | 2026-11-04 |
| Cache read price (GitHub, USD/1M cached input) | 4.5/4.6/4.7: $0.50 default tier; $1.00 long tier (0.25x input) | documented | GP | Grok 4.5/4.6/4.7: $2.00 / $0.50 / $6.00 (<=200K); $4.00 / $1.00 / $12.00 (>200K) | 2026-11-04 |
| Cache read multiplier | 0.25x input on GitHub price table for all three. NOTE: xAI's own page shows grok-4.5 cached $0.30 (0.15x) vs GitHub $0.50; grok-4.6/4.7 match. Use GitHub price (Copilot bills it) and flag discrepancy | documented (GP); xAI page differs for 4.5 | GP ; XP | xAI: "grok-4.5 < 200k 2.00 0.30 6.00" | 2026-11-04 |
| Prefix definition | start of messages array, exact match, includes tool results | documented | XB ; XH | "The cacheable prefix includes all messages up to and including tool call results." / "messages at the beginning that match exactly are served from cache" | 2026-11-04 |
| Layer order (tools/system/messages) | not defined. Only: system prompt, few-shot, references "at the beginning". Position of tools unknown, so S1 cannot be asserted for xAI | unknown (tools); inferred (system first) | XB ; XH | "Place system prompts, few-shot examples, and reference documents at the beginning where they form a stable prefix." | 2026-11-04 |
| Invalidation: edit/remove/reorder earlier message | invalidates from the changed message onward | documented | XM ; XB | "Any change to earlier messages breaks the cache." / "Any edit, removal, or reorder breaks the cache." | 2026-11-04 |
| Invalidation: dropping reasoning content | breaks cache (reasoning models) | documented | XM | "omitting it is the top cause of cache misses." | 2026-11-04 |
| Invalidation: system prompt change | not stated explicitly. Generic "earlier message change" would imply from system onward only if system is first | unknown | XM | "does not mention changes to the system prompt" | 2026-11-04 |
| Invalidation: tools change | not stated | unknown | XM | (absent) | 2026-11-04 |
| Invalidation: image added/removed | not stated | unknown | XM | (absent) | 2026-11-04 |
| Invalidation: model switch | not stated for xAI. Do not borrow S12 Anthropic rule | unknown | XM | (absent) | 2026-11-04 |
| Invalidation: thinking/effort change | not stated | unknown | XM | (absent) | 2026-11-04 |
| Invalidation: idle gap | no TTL stated; only eviction | unknown | XB | "Cache entries can be evicted at any time" | 2026-11-04 |
| Tiered pricing threshold (S18) | 200k prompt tokens; whole request billed at higher tier (input, cached, output). Boundary differs: xAI ">= 200k", GitHub ">200K" | documented | XP ; GP | "requests whose prompt reaches the listed token threshold are billed at the higher rate for all tokens in the request." / GP: "Long context (>200K input tokens)" | 2026-11-04 |
| Image token formula | none published. Fall back to estimate with `estimated: true` | unknown | https://docs.x.ai/developers/model-capabilities/images/understanding ; XU | "The page doesn't explain what that setting [detail] does to token usage." (limits only: 20MiB, jpg/png, no image-count limit) | 2026-11-04 |
| Cached-token reporting field | `usage.prompt_tokens_details.cached_tokens` / `input_tokens_details.cached_tokens` | documented | XU | "Cached tokens appear in `usage.prompt_tokens_details.cached_tokens`" | 2026-11-04 |

Consequence for the profile: with unknown TTL/min tokens/layer order, S17 "best-effort" must show lifetime as an ASSUMED value; any turn depending on an unknown row (tools/system/image/model-switch/thinking invalidation) falls to `unavailableTokenCount` per §4.3, unless the owner accepts documented "any earlier change breaks cache" as the only invalidation rule (messages-only prefix).

### Moonshot AI (Kimi K3, Copilot: "hosted by GitHub on Fireworks AI")

| Rule | Value | Confidence | Source URL | Short verbatim quote | checked |
|---|---|---|---|---|---|
| Copilot host | GitHub on Fireworks AI, not Moonshot's API | documented | GH | "Kimi K3 is hosted by GitHub on Fireworks AI." / "prompts and completions are not sent to Moonshot AI." | 2026-11-04 |
| Moonshot-documented caching (own API) | automatic prefix cache, TTL 5m default / 1h, hit refreshes, K3 cache write billed ($3.00/1M 5m, $6.00/1M 1h), hit $0.30 | documented, but for Moonshot's own API only | https://platform.kimi.ai/docs/pricing/chat-k3.md ; https://platform.kimi.ai/docs/guide/context-caching.md | "The Kimi API automatically enables context caching billing for repeated request prefixes ... default TTL ... of 5m." | 2026-11-04 |
| Does that apply to the Copilot-hosted model | no evidence. Moonshot page does not mention third-party deployments; GitHub bills no write fee (differs from Moonshot's $3.00 write) | unknown | GP ; platform.kimi.ai guide | "It doesn't mention third-party deployments." / GP: no cache write cost for Moonshot | 2026-11-04 |
| Fireworks (actual host) generic caching | automatic longest-prefix cache, on for all models; TTL "at least several minutes ... up to several hours"; no min tokens; no write charge; per-replica | documented generically for Fireworks, NOT for GitHub's Copilot deployment | https://docs.fireworks.ai/guides/prompt-caching | "Fireworks will automatically find the longest prefix of the request that is present in the cache and reuse it." | 2026-11-04 |
| GitHub price row | $3.00 input / $0.30 cached / $15.00 output; no write, no tier | documented | GP | "Kimi K3 ... $3.00 / $0.30 / $15.00" | 2026-11-04 |
| Verdict | D1 "Not simulated" stands for Copilot (no Copilot-specific caching doc), but OWNER MUST KNOW: Moonshot and Fireworks both document automatic prefix caching, and GitHub bills a cached-input rate. If D1 is reversed, it would be a best-effort profile on Fireworks docs with TTL unknown, same shape as xAI. Disabled reason text "caching behaviour isn't documented" is NOT strictly accurate for Kimi: better "not documented for GitHub's Fireworks deployment" | inferred (verdict) | n/a | n/a | 2026-11-04 |

### Microsoft (MAI-Code-1.1-Flash, Copilot: "hosted on Azure in GitHub's tenant")

| Rule | Value | Confidence | Source URL | Short verbatim quote | checked |
|---|---|---|---|---|---|
| Copilot host | Azure AI Foundry in GitHub's tenant (also local option) | documented | GH | "hosted on Azure in GitHub's tenant" | 2026-11-04 |
| Any caching behaviour documented | none: no TTL, min tokens, prefix rules, invalidation, write charge on GitHub docs or found vendor docs | unknown | GH ; https://docs.github.com/en/copilot/reference/ai-models/supported-models | MAI footnote only: "MAI models are continuously improving models. Performance and behavior may evolve over time as new checkpoints are released." | 2026-11-04 |
| GitHub price row | $0.20 input / $0.02 cached / $1.20 output; no write, no tier | documented | GP | "MAI-Code-1.1-Flash ... $0.20 / $0.02 / $1.20" | 2026-11-04 |
| Verdict | Cached-input price exists (0.1x) but no behaviour doc. D1 stands: not simulated. Third-party listings (pi.dev) mention cache read/write rates and "long cache retention"; not vendor docs, ignored | documented (price) / unknown (behaviour) | n/a | WebSearch: "found no official documentation of how its prompt caching works" | 2026-11-04 |

### Caveats
- Page text came through WebFetch summarisation; one GP table was restated, not copied. Re-fetch raw before putting quotes in the UI.
- GitHub supported-models page is 382k chars; read only offsets 0-200k and 300k+ (not 200k-300k). Hosting facts came from GH page instead.
- Other GitHub hosting page also states "GitHub uses prompt caching" for Claude and Gemini only; no xAI/Kimi/MAI caching statement.

## Step 13.0: model register (research only; checked 2026-11-04)

Source: github/docs `data/tables/copilot/models-and-pricing.yml` (raw, full file, 29 distinct models / 37 tier rows). USD per 1M tokens. Cache write "n/a" = "Not applicable" (no charge listed); "-" = field absent in YAML.

### (a) Models

Copilot-log id column: ids seen in repo tests/fixtures (Agent Host `usage.model`, `model` fields) are marked [seen]. Others follow the observed pattern (lowercase, spaces to "-", dots kept) and are marked [inferred]. No real capture confirms them.

| Display name | Vendor | Price-table id (proposed) | Copilot log id | In / cached / write / out | Tiers (threshold) | Promo end | Simulated |
|---|---|---|---|---|---|---|---|
| GPT-5.3-Codex | OpenAI | gpt-5.3-codex | gpt-5.3-codex [seen] | 1.75 / 0.175 / n/a / 14.00 | none | - | yes |
| GPT-5.4 nano | OpenAI | gpt-5.4-nano | [inferred] gpt-5.4-nano | 0.20 / 0.02 / n/a / 1.25 | none | - | yes |
| GPT-5.6 Luna | OpenAI | gpt-5.6-luna | [inferred] | 0.20 / 0.02 / 0.25 / 1.20; >200K: 0.40 / 0.04 / 0.50 / 1.80 | 200K | - | yes |
| GPT-5.6 Sol | OpenAI | gpt-5.6-sol | [inferred] | 4.00 / 0.40 / 5.00 / 20.00; >272K: 8.00 / 0.80 / 10.00 / 30.00 | 272K | - | yes |
| GPT-5.6 Terra | OpenAI | gpt-5.6-terra | [inferred] | 2.00 / 0.20 / 2.50 / 12.00; >272K: 4.00 / 0.40 / 5.00 / 18.00 | 272K | - | yes |
| GPT-6 Astra | OpenAI | gpt-6-astra | [inferred] | 10.00 / 1.00 / 12.50 / 50.00; >272K: 20.00 / 2.00 / 25.00 / 75.00 | 272K | - | yes |
| GPT-6 Luna | OpenAI | gpt-6-luna | gpt-6-luna [seen] | 0.10 / 0.01 / 0.125 / 0.50; >272K: 0.20 / 0.02 / 0.25 / 0.75 | 272K | - | yes |
| GPT-6 Sol | OpenAI | gpt-6-sol | [inferred] | 2.00 / 0.20 / 2.50 / 10.00; >272K: 4.00 / 0.40 / 5.00 / 15.00 | 272K | - | yes |
| GPT-6.1 Sol | OpenAI | gpt-6.1-sol | gpt-6.1-sol [seen, acceptance test] | 2.00 / 0.10 / 2.50 / 10.00; >272K: 4.00 / 0.20 / 5.00 / 15.00 | 272K | - | yes |
| GPT-6.1 Terra | OpenAI | gpt-6.1-terra | [inferred] | 1.00 / 0.05 / 1.25 / 5.00; >272K: 2.00 / 0.10 / 2.50 / 7.50 | 272K | - | yes |
| Claude Haiku 4.5 | Anthropic | claude-haiku-4.5 | [inferred] | 1.00 / 0.10 / 1.25 / 5.00 | none | - | yes |
| Claude Haiku 5.5 | Anthropic | claude-haiku-5.5 | [inferred] | 0.10 / 0.01 / 0.125 / 0.50; >100K: 0.50 / 0.05 / 0.625 / 2.50 | 100K | - | yes |
| Claude Sonnet 4 | Anthropic | claude-sonnet-4 | [inferred] | 3.00 / 0.30 / 3.75 / 15.00 | none | - | yes |
| Claude Sonnet 4.6 | Anthropic | claude-sonnet-4.6 | claude-sonnet-4.6 [seen] | 3.00 / 0.30 / 3.75 / 15.00 | none | - | yes |
| Claude Opus 4.8 | Anthropic | claude-opus-4.8 | [inferred] | 5.00 / 0.50 / 6.25 / 25.00 | none | - | yes |
| Claude Opus 5 | Anthropic | claude-opus-5 | [inferred] | 5.00 / 0.50 / 6.25 / 25.00 | none | - | yes |
| Claude Opus 5.5 | Anthropic | claude-opus-5.5 | [inferred] | 4.00 / 0.20 / 5.00 / 20.00 | none | - | yes |
| Claude Sonnet 5 | Anthropic | claude-sonnet-5 | claude-sonnet-5 [seen, ~48 hits] | 2.00 / 0.20 / 2.50 / 10.00 | none | - | yes |
| Claude Sonnet 5.5 | Anthropic | claude-sonnet-5.5 | [inferred] | 2.00 / 0.10 / 2.50 / 10.00 | none | - | yes (default fallback, D3) |
| Claude Opus 4.8 (fast mode) (preview) | Anthropic | claude-opus-4.8-fast | unknown (likely a separate id or a mode flag) | 10.00 / 1.00 / 12.50 / 50.00 | none | - | yes (YAML says release_status GA despite "(preview)" in name) |
| Claude Fable 5 | Anthropic | claude-fable-5 | [inferred] | 10.00 / 1.00 / 12.50 / 50.00 | none | - | yes |
| Claude Fable 5.1 | Anthropic | claude-fable-5.1 | [inferred] | 10.00 / 0.25 / 12.50 / 50.00 | none | - | yes |
| Gemini 3.8 Flash | Google | gemini-3.8-flash | unknown | 0.75 / 0.075 / - / 3.75 | none | footnote `gemini-flash-promo`; end date unknown (YAML gives a date only for Argon) | yes |
| Gemini 4 Argon | Google | gemini-4-argon | unknown | 2.00 / 0.10 / - / 10.00 | none | 2026-12-01 | yes |
| Grok 4.5 | xAI | grok-4.5 | unknown | 2.00 / 0.50 / - / 6.00; >200K: 4.00 / 1.00 / - / 12.00 | 200K | - | yes |
| Grok 4.6 | xAI | grok-4.6 | unknown | same as Grok 4.5 | 200K | - | yes |
| Grok 4.7 | xAI | grok-4.7 | unknown | same as Grok 4.5 | 200K | - | yes |
| MAI-Code-1.1-Flash | Microsoft | mai-code-1.1-flash | unknown | 0.20 / 0.02 / - / 1.20 | none | - | NO, disabled (D1) |
| Kimi K3 | Moonshot AI | kimi-k3 | unknown | 3.00 / 0.30 / - / 15.00 | none | - | NO, disabled (D1) |

Count: OpenAI 10, Anthropic 12, Google 2, xAI 3, Microsoft 1, Moonshot AI 1 = 29; 27 simulated. Matches plan section 6.

Notes
- Anthropic YAML rows carry no threshold/tier except Haiku 5.5; GitHub's rendered page may differ, not checked.
- Cache-write rule: YAML says it applies to Anthropic and GPT-5.6+ only. GPT-5.3-Codex and GPT-5.4 nano have none. Google and xAI have no cache_write field (plan ModelPrice needs `cacheWriteUsdPerM: null`).
- Mapping rule suggestion: normalise Copilot id by lowercasing and matching the table id exactly; unmatched ids fall through to "unknown model", never a guess. Confirm [inferred] ids against real Analyze sessions in Phase 11/13.5a.

### (b) Cheaper sibling (same vendor only)

Scenario numbering: the plan (section 2, D4) names the two-model scenarios as 4 (model switch), 14 (cascading switch) and 18 (subagent on cheaper model). The task text said 2, 12, 18; scenarios 2 and 12 are subagent / inline-exploration scenarios with no model switch in the docs I saw. Same sibling map serves any of them.

| Model | Cheaper sibling | Rationale |
|---|---|---|
| Claude Opus 4.8 (fast) | claude-opus-4.8 | same model, standard speed; 5x cheaper |
| Claude Fable 5 / 5.1 | claude-opus-5.5 | next tier down, $4/$20 vs $10/$50 |
| Claude Opus 5.5 | claude-sonnet-5.5 | $2/$10 |
| Claude Opus 5 | claude-sonnet-5 | same generation, $2/$10 |
| Claude Opus 4.8 | claude-sonnet-4.6 | $3/$15, closest older Sonnet |
| Claude Sonnet 5.5 | claude-haiku-5.5 | $0.10/$0.50 (<=100K); default-model case |
| Claude Sonnet 5 | claude-haiku-5.5 | same |
| Claude Sonnet 4.6 / 4 | claude-haiku-4.5 | $1/$5, same generation |
| Claude Haiku 5.5 | none | cheapest Anthropic model |
| Claude Haiku 4.5 | claude-haiku-5.5 | cheaper and newer (cross-generation, owner to confirm) |
| GPT-6 Astra | gpt-6-sol | $2/$10 vs $10/$50 |
| GPT-6 Sol | gpt-6-luna | $0.10/$0.50 |
| GPT-6.1 Sol | gpt-6.1-terra | $1/$5, same generation |
| GPT-6.1 Terra | gpt-6-luna | $0.10/$0.50 (no 6.1 Luna) |
| GPT-6 Luna | none | cheapest OpenAI model |
| GPT-5.6 Sol | gpt-5.6-terra | $2/$12 |
| GPT-5.6 Terra | gpt-5.6-luna | $0.20/$1.20 |
| GPT-5.6 Luna | gpt-6-luna | $0.10/$0.50; GPT-5.4 nano is not cheaper on output |
| GPT-5.3-Codex | gpt-5.4-nano | $0.20/$1.25 |
| GPT-5.4 nano | gpt-6-luna | $0.10/$0.50 |
| Gemini 4 Argon | gemini-3.8-flash | $0.75/$3.75; price is promo-dependent |
| Gemini 3.8 Flash | none | only other Google model is dearer |
| Grok 4.5 / 4.6 / 4.7 | none | all three have identical prices; no cheaper xAI model exists. Owner decision: hide two-model scenarios for xAI, or allow same-model "switch" |

### (c) Mismatches with repo

- The repo has NO price table or per-token rate today (searched packages/*/src): AI credits come from logs (`nanoAiu`) and the Learn scenarios use an illustrative 0.005 credits per 1K rate. So nothing to diff against GitHub's table yet; Phase 13 creates the first one.
- Plan section 6 says "Promotional prices (Gemini)" for both Gemini models. YAML has a promo footnote on both but a date (2026-12-01) and "post-promo pricing not published" comment only for Argon. Flash promo end: unknown.
- Plan section 2 says cheaper-model scenarios are 4, 14, 18; task brief said 2, 12, 18 (see (b)).
- docs/architecture.md:609 links `docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing`; the brief gives `/reference/ai-models/models-and-pricing`. Unverified which is current (rendered page not fetched).
- Sonnet 4.6 appears in repo tests only as a log id; classic VS Code logs use `claude-sonnet-5` style ids too, so Claude ids appear to match price-table ids with spaces to dashes. Not confirmed for Haiku/Opus/Fable/Gemini/Grok/Kimi/MAI.
