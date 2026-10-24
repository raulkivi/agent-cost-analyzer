# Copilot Chat extension source investigation: cache/token logging

This document records findings from inspecting the GitHub Copilot Chat VS
Code extension's own source (`~/src/vscode-copilot-chat` on this machine) to
answer a question left open by Phase 9 planning: are there richer local
sources of Copilot Chat token/cache-usage data than `main.jsonl`, and does
GitHub's backend
response carry a vendor-shaped (Anthropic/OpenAI-style) `usage` object a
mitmproxy decoder could recognize?

It does not change any shipped code or `architecture.md`'s contracts —
`architecture.md` §7's existing description of `main.jsonl`'s fields is
already accurate (confirmed below against a real capture). This is a
research memo to inform future Phase 9+ decisions, referenced from
[log-provider-alternatives.md](providers/log-provider-alternatives.md) for the
actionable conclusions.

**Update (2026-08-09): both open questions below are now resolved.** §0–§4
were written against an archived, frozen mirror repo and left the
cache-write/reasoning-token availability and the GitHub-backend response
shape as open questions. §5 checks the same code against the *live*
`microsoft/vscode` source (Copilot Chat's actual current home, cloned and
indexed same-day, HEAD `add9a5100` dated 2026-08-09) and resolves both.
Read §0–§4 for the investigative trail; §5 for the current, confirmed
answer — §5's findings supersede §3's "unverified lead" framing and §4's
"unresolved" framing.

## 0. Critical caveat: the checked-out source is an archived, frozen snapshot

**Read this before trusting any specific claim below about current field
availability.** `~/src/vscode-copilot-chat`'s `HEAD` is commit `5863f5a7`
("Add archive notice", 2026-05-20), which added this notice to the repo's
`README.md`:

> This project has been moved into the main VS Code repository and this
> repository is now archived. Active development continues at:
> https://github.com/microsoft/vscode

Development of Copilot Chat continued inside `microsoft/vscode` after that
date — a repository not indexed for this investigation. Concretely, this
mattered: a real fixture already checked into this project,
`packages/server/fixtures/jsonl/real-session-with-usage.jsonl`, contains an
`llm_request` entry timestamped **2026-08-08** (`ts: 1786202790374`) —
eleven weeks *after* the archive date — whose `attrs` already include a
`cachedTokens` field. The archived source's own token-logging function (§2
below) does **not** write that field for the equivalent case. The archived
mirror is demonstrably behind what the shipping extension logs today.

**Conclusion**: treat everything below about *what the archived source's
code currently does* as an accurate description of an April–May 2026
snapshot, useful for understanding the logging *architecture* (how spans
become `main.jsonl` entries, what mechanism would carry cache-write/
reasoning data if added) — but not as authoritative for *exactly which
fields ship today*. For that, §1 below uses the real, dated fixture
instead, which is strictly more trustworthy than reading stale source.

## 1. Ground truth: what's actually in `main.jsonl` today

Extracted from `real-session-with-usage.jsonl`'s `llm_request` entries
(captured 2026-08-08, `model: "claude-sonnet-5"`), the full `attrs` key set
is:

```
cachedTokens, copilotUsageNanoAiu, debugName, inputMessages, inputTokens,
maxTokens, model, outputTokens, requestOptions, requestShape, responseId,
systemPromptFile, toolsFile, ttft, userRequest
```

This matches what `architecture.md` §7 and
`packages/server/src/data-sources/jsonl/llm-request-extractor.ts` already
assume and handle: `inputTokens` (total, cached + uncached), `cachedTokens`
(the cache-read subset), `outputTokens`, and `copilotUsageNanoAiu` (AI
Credits) are present and already extracted correctly by this project.

**Confirmed still absent**, even in this current, real capture: any
cache-*creation*/cache-*write* token count, and any reasoning-token count.
Notably, `requestOptions` on this same entry shows
`"thinking":{"type":"adaptive","display":"summarized"}` — extended
thinking/reasoning was active for this request — yet no reasoning-token
figure is logged anywhere in the entry. This corroborates, with a live
example, `llm-request-extractor.ts`'s existing comment that "there is no
separate cache-write figure or tool/vision/reasoning breakdown in this
event shape." **`main.jsonl` cannot be made to carry this data by any
logging-verbosity or settings change** — see §2 for why structurally.

## 2. How `main.jsonl` entries are built (architecture, per the archived source)

`main.jsonl` is written exclusively by
`ChatDebugFileLoggerService` (`src/extension/chat/vscode-node/
chatDebugFileLoggerService.ts`) — confirmed the sole writer by searching the
whole repo for the literal `main.jsonl` path construction (only this file's
`_ensureSession`/`flush` methods touch it; test-only references aside).

Internally, the extension instruments its request/response flow with
OpenTelemetry spans using a `GenAiAttr` schema
(`src/platform/otel/common/genAiAttributes.ts`) modeled on the OTel GenAI
semantic conventions, e.g.:

```ts
USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
USAGE_CACHE_READ_INPUT_TOKENS: 'gen_ai.usage.cache_read.input_tokens',
USAGE_CACHE_CREATION_INPUT_TOKENS: 'gen_ai.usage.cache_creation.input_tokens',
USAGE_REASONING_TOKENS: 'gen_ai.usage.reasoning_tokens', // custom, not yet standardized
```

`chatDebugFileLoggerService.ts:873` (`_spanToEntry`) converts a completed
span into an `IDebugLogEntry` line for `main.jsonl`, keyed on the span's
`GenAiOperationName`. For `GenAiOperationName.CHAT` (the `llm_request` entry
type), the archived source (as of 2026-05-20) copies only two usage
attributes into the entry:

```ts
...(span.attributes[GenAiAttr.USAGE_INPUT_TOKENS] !== undefined
    ? { inputTokens: asNumber(span.attributes[GenAiAttr.USAGE_INPUT_TOKENS]) }
    : {}),
...(span.attributes[GenAiAttr.USAGE_OUTPUT_TOKENS] !== undefined
    ? { outputTokens: asNumber(span.attributes[GenAiAttr.USAGE_OUTPUT_TOKENS]) }
    : {}),
```

Per §0, the shipping extension has since added `cachedTokens` here (from
`USAGE_CACHE_READ_INPUT_TOKENS`) — visible in the elsewhere-in-repo sibling
module `src/extension/trajectory/vscode-node/otelSpanToChatDebugEvent.ts:354`,
which already reads `entry.attrs.cachedTokens` from a debug-log entry and
maps `USAGE_CACHE_READ_INPUT_TOKENS` the same way for its own (different)
purpose — so the attribute plumbing existed in the archived snapshot, just
not yet wired into `_spanToEntry`'s `CHAT` case. `USAGE_CACHE_CREATION_INPUT_TOKENS`
and `USAGE_REASONING_TOKENS` attribute *keys* exist in the shared schema but
are not read by `_spanToEntry` at all (any operation), nor confirmed present
in the real Aug-2026 fixture (§1) — the most defensible reading is that the
underlying span **may** carry these attributes (populated for telemetry or
the in-IDE debug UI — see §3), but the `main.jsonl` projection has not been
extended to surface them, in either the archived snapshot or (per §1) the
current shipping build.

**Takeaway**: `main.jsonl` is explicitly a hand-picked *subset* of a richer
in-memory OTel span, chosen field-by-field in `_spanToEntry`. This confirms
the phase-9 doc's implicit assumption that main.jsonl is a lossy log, not a
complete usage record — and shows the mechanism (`_spanToEntry`'s
allowlist) is exactly why, and exactly where an upstream fix would need to
land if the extension maintainers chose to surface cache-write/reasoning
tokens the same way they apparently already added cache-read.

## 3. A promising richer local source: `agent-traces.db` (OTel SQLite span store)

Distinct from `main.jsonl`, the archived source has a second, opt-in local
persistence path for the *same* spans, before any `main.jsonl` field
selection happens: `OTelSqliteStore`
(`src/platform/otel/node/sqlite/otelSqliteStore.ts`). Its `insertSpan`
method (lines 141–183) stores every completed span's **raw attributes
verbatim** — i.e., whatever the span actually carries, not a hand-picked
subset — plus `conversation_id`, `chat_session_id`, `agent_name`, tool
calls, and (if content capture is enabled) full prompt/response text.
`getSessions()`/`getSpansByConversationId()` (lines 191–249) provide
ready-made session/turn queries.

- **Gating**: setting `github.copilot.chat.otel.dbSpanExporter.enabled`
  (default `false`,
  `src/platform/configuration/common/configurationService.ts:705`) — a
  *separate* flag from the full OTel exporter
  (`github.copilot.chat.otel.enabled`, also default `false`).
- **Location**: `<globalStorageUri>/agent-traces.db`
  (`src/extension/extension/vscode-node/services.ts:270-272`) — a SQLite
  file, same category of local, offline, read-only-from-outside artifact
  this project already reads (VS Code's own chat-session SQLite store).
- **Export command**: `github.copilot.chat.otel.exportAgentTracesDB`
  (`src/extension/otel/vscode-node/otelContrib.ts:49`).

**This has not been verified against the current shipping extension** (§0
caveat applies in full) — whether this setting still exists, is still
gated the same way, or still stores the full attribute set unfiltered, is
unconfirmed. It is a strong lead, not a confirmed capability. Before
building against it: check whether the setting exists in a current VS Code
Copilot Chat install (`Preferences: Open User Settings (JSON)`, search
`otel.dbSpanExporter`), enable it, run one real session, and inspect
whether `agent-traces.db` actually appears in the extension's global
storage directory with cache-write/reasoning fields populated.

## 4. Open question, still unresolved: what does GitHub's backend response actually contain?

Phase 9 §13's caveat states Copilot Chat's traffic goes to GitHub's own
backend (`api.githubcopilot.com`), not directly to
`api.anthropic.com`/`api.openai.com`, so a mitmproxy capture of Copilot
Chat traffic won't be vendor-SDK-shaped the way the planned Anthropic/OpenAI
HAR decoders expect. This investigation did **not** find the raw HTTP
response-parsing code that would settle whether GitHub's backend forwards a
vendor-shaped `usage` object (with `cache_read_input_tokens` etc.) or
returns its own normalized schema — the archived source shows only the
*post-normalization* `GenAiAttr` schema (§2), which is provider-agnostic by
design (`GenAiProviderName.GITHUB` is a first-class value alongside
`ANTHROPIC`/`OPENAI` in `genAiAttributes.ts:19-24`) and doesn't reveal the
wire format underneath. Separately, `src/platform/endpoint/node/
messagesApi.ts` does parse raw Anthropic-Messages-API-shaped
`cache_creation_input_tokens`/`cache_read_input_tokens` fields directly, but
that code path is reached from `src/extension/byok/vscode-node/
anthropicProvider.ts` — the "bring your own key" path, not confirmed as
also being the code that parses GitHub-backend responses.

Given §0's caveat, resolving this definitively now requires either (a)
inspecting `microsoft/vscode`'s current source (not done here — a separate,
larger repo, out of scope for this pass), or (b) the empirical approach
already identified for Phase 9: capture real Copilot Chat traffic with
`--allow-hosts` scoped to
`api.githubcopilot.com`/`api.github.com` and inspect the response bodies
directly. That empirical step remains the most reliable way to answer this,
regardless of what either source snapshot says.

## 5. Confirmed against the live `microsoft/vscode` source (2026-08-09)

Copilot Chat's current home inside `microsoft/vscode` is `extensions/
copilot/` — same internal file layout as the archived mirror (e.g.
`extensions/copilot/src/extension/chat/vscode-node/
chatDebugFileLoggerService.ts` still exists at that path). Cloned
(`--depth 1 --filter=blob:none`) and indexed scoped to that subdirectory
(the full monorepo is ~17,600 files and out of scope). HEAD at clone time:
`add9a5100` ("sessions: support editor tab display modes", 2026-08-09) —
today.

### 5a. `_spanToEntry`'s `CHAT` case today

Re-read at `extensions/copilot/src/extension/chat/vscode-node/
chatDebugFileLoggerService.ts:975` (line numbers shifted from the archived
copy but the function is structurally the same). It now includes:

```ts
...(span.attributes[GenAiAttr.USAGE_CACHE_READ_INPUT_TOKENS] !== undefined
    ? { cachedTokens: asNumber(span.attributes[GenAiAttr.USAGE_CACHE_READ_INPUT_TOKENS]) }
    : {}),
```

— confirming §1's real-fixture finding directly at the source: `cachedTokens`
was added to `main.jsonl`'s projection sometime between the 2026-05-20
archive point and today. **Still absent** from this switch case: any
`USAGE_CACHE_CREATION_INPUT_TOKENS` or `USAGE_REASONING_TOKENS`/
`USAGE_REASONING_OUTPUT_TOKENS` mapping — main.jsonl's field-selection gap
for cache-write and reasoning tokens (§1, §2) is confirmed current, not
stale.

### 5b. The span *does* carry cache-creation and reasoning data — `main.jsonl` just doesn't project it

`extensions/copilot/src/extension/prompt/node/chatMLFetcher.ts:396-441` is
the response handler for the GitHub-routed chat fetch (`metricAttrs`
explicitly sets `providerName: GenAiProviderName.GITHUB` a few lines above
the snippet below — this is not a BYOK path). After a successful fetch, it
sets these attributes on the chat span **before** `_spanToEntry` ever sees
it:

```ts
...(result.usage.prompt_tokens_details?.cached_tokens !== undefined
    ? { [GenAiAttr.USAGE_CACHE_READ_INPUT_TOKENS]: result.usage.prompt_tokens_details.cached_tokens }
    : {}),
...(result.usage.prompt_tokens_details?.cache_creation_input_tokens !== undefined
    ? { [GenAiAttr.USAGE_CACHE_CREATION_INPUT_TOKENS]: result.usage.prompt_tokens_details.cache_creation_input_tokens }
    : {}),
...
...(result.usage.completion_tokens_details?.reasoning_tokens
    ? {
        [GenAiAttr.USAGE_REASONING_TOKENS]: result.usage.completion_tokens_details.reasoning_tokens,
        [GenAiAttr.USAGE_REASONING_OUTPUT_TOKENS]: result.usage.completion_tokens_details.reasoning_tokens,
      }
    : {}),
```

So the gap identified in §1/§2 is **not** a data-availability gap — the
GitHub-routed response already yields cache-creation and reasoning token
counts (§5c resolves where from), and the extension already parses them
into the span. It's purely that `_spanToEntry`'s hand-picked field list
(§5a) doesn't carry those two attributes into `main.jsonl`. This is
exactly the mechanism §3's `agent-traces.db` sidesteps, since it stores
raw span attributes rather than a hand-picked subset — see §5d.

One accounting note worth carrying into any UI that surfaces this:
`extensions/copilot/src/extension/intents/node/toolCallingLoop.ts:1380`
comments that reasoning tokens are "a SUBSET of USAGE_OUTPUT_TOKENS
(mirrors OpenAI completion_tokens_details.reasoning_tokens)... a
sub-breakdown of output, not an addition" — i.e. don't add reasoning
tokens on top of output tokens when computing a turn total; they're
already included in `outputTokens`.

### 5c. Resolved: GitHub's backend response already yields OpenAI-shaped usage detail

`result.usage` in `chatMLFetcher.ts` (§5b) is the extension's internal,
provider-agnostic `usage` shape (`prompt_tokens`, `completion_tokens`,
`prompt_tokens_details.{cached_tokens, cache_creation_input_tokens}`,
`completion_tokens_details.reasoning_tokens`) — modeled on OpenAI's
Chat/Responses API usage schema. Confirmation that this is a *shared* type
used across providers, not GitHub-specific: the Anthropic BYOK provider
(`extensions/copilot/src/extension/byok/vscode-node/anthropicProvider.ts:783`)
maps Anthropic's native flat `cache_creation_input_tokens`/
`cache_read_input_tokens` fields into this *same* `prompt_tokens_details`
shape, with the comment "Cast needed: Anthropic returns
cache_creation_input_tokens which APIUsage.prompt_tokens_details doesn't
define" — i.e. `APIUsage` is the one shared type, and each provider adapter
maps its own wire format onto it.

Practical answer to Phase 9 §13's open caveat: **GitHub's backend response,
as consumed by the GitHub-routed fetch path, already yields cache-creation
and reasoning-token figures today** — the data is not absent, contrary to
the caveat's implicit worry. What remains genuinely unconfirmed by source
alone is the *exact wire bytes* `api.githubcopilot.com` returns (whether
its raw JSON/SSE body is itself OpenAI-Chat-Completions-shaped, or gets
mapped from something else in a layer this pass didn't trace back to the
raw `fetch()` call) — relevant only if someone builds a mitmproxy decoder
against the literal wire format; not relevant to whether the data is
obtainable at all, which is now settled. `phase-9-log-providers-
implementation.md` §13 step 4's empirical HAR capture remains the way to
pin down the exact bytes, now as a confirmation step rather than a
speculative one.

### 5d. `agent-traces.db` confirmed current, and confirmed to store what §5b's span carries

`extensions/copilot/src/platform/otel/node/sqlite/otelSqliteStore.ts` is
present in the live source with the same `insertSpan`/gating/path structure
as §3 described. Two confirmations that upgrade §3 from "unverified lead"
to "confirmed mechanism, pending one empirical run":

- `DENORMALIZED_ATTRS` (`otelSqliteStore.ts:28-43`) includes
  `reasoning_tokens: GenAiAttr.USAGE_REASONING_TOKENS` as its own indexed
  SQL column — reasoning tokens get first-class storage, not just
  incidental capture.
- `insertSpan` (`otelSqliteStore.ts:141-183`) denormalizes 16 known columns
  *and* separately loops over **every** `span.attributes` entry into a
  generic `span_attributes` key/value table — so even attributes without a
  dedicated column (like `USAGE_CACHE_CREATION_INPUT_TOKENS`, which isn't
  one of the 16) are still captured, verbatim, under their `gen_ai.usage.*`
  key.

Combined with §5b (the span already carries cache-creation and reasoning
attributes for GitHub-routed requests), this means: **if
`github.copilot.chat.otel.dbSpanExporter.enabled` is on, `agent-traces.db`
should already contain cache-write and reasoning token data that
`main.jsonl` structurally cannot carry** — a source-confirmed conclusion,
not a guess. The one remaining unconfirmed step is empirical: enable the
setting, run a real session, and read the resulting `agent-traces.db` to
confirm the values actually land as expected end-to-end (span creation →
SQLite insert → query). Gating setting and DB path are unchanged from §3.

### 5e. How `copilotUsageNanoAiu` (AI Credits) can be complete even when the token breakdown isn't

A real puzzle this investigation raised: this project already extracts
`copilotUsageNanoAiu` from every `main.jsonl` `llm_request` entry and
reports it as AI Credits (`llm-request-extractor.ts`), with no gaps — so
how can GitHub Copilot compute a cost figure for every request if the
client-visible token breakdown is incomplete (§1, §5a: cache-write is
missing from `main.jsonl`, and even the OTel span-level data in §5b is only
conditionally populated)?

**Answer: cost is not computed client-side from token counts at all.**
GitHub's backend computes it and sends the finished number down as its own
field, independent of the token-usage fields:

```ts
// extensions/copilot/src/platform/endpoint/node/messagesApi.ts:163
// (response type for the Anthropic-Messages-shaped GitHub-backend response)
copilot_usage?: {
    total_nano_aiu: number;
};
```

`chatMLFetcher.ts:400-401,444-445` (§5b) just reads
`result.usage.copilot_usage.total_nano_aiu` off the already-parsed response
and relays it three ways: into `_chatQuotaService` (the in-IDE quota/credit
UI), onto the OTel span as `CopilotChatAttr.COPILOT_USAGE_NANO_AIU`, and
from there — via `_spanToEntry`, which *does* project this one field
(§2) — into `main.jsonl`'s `copilotUsageNanoAiu`. No token math happens on
the client at any point in this chain.

This resolves the puzzle: **cost and the token breakdown are two
independent numbers GitHub's backend returns, not one derived from the
other on the client.** GitHub computes cost server-side, where it has full
visibility into every billable component (input, output, cache read, cache
write, and whatever internal per-model pricing/multipliers apply) and
returns only the finished total — so cost reporting can be, and is, 100%
complete per request regardless of whether the constituent token counts
that *would* let someone reconstruct that number independently ever reach
the client at all.

Two implications for this project:

- **AI Credits reporting is not at risk** from the cache-write gap
  identified in §1/§5a/§5b — it was never dependent on that data existing
  client-side, so nothing here threatens the accuracy of the existing
  `copilotUsageNanoAiu` extraction.
- **The billed amount can't be audited against `rate × tokens` math**, even
  with a full token breakdown from `agent-traces.db` (§5d) — GitHub's
  internal pricing logic, including whatever discount cache reads/writes
  receive, isn't exposed anywhere in this response; only the pre-computed
  total is. A future "does the cost match the tokens" sanity-check feature
  is not buildable from any local data source this investigation found.

### 5f. Empirically confirmed (2026-08-09): `agent-traces.db` carries real cache-write data end to end

§5d's one remaining unconfirmed step — whether enabling
`github.copilot.chat.otel.dbSpanExporter.enabled` actually produces
populated cache-write values, not just a code path that could in
principle produce them — is now confirmed against this machine's own real
`agent-traces.db` (`~/.config/Code - Insiders/User/globalStorage/
github.copilot-chat/agent-traces.db`), captured after enabling the setting,
reloading VS Code, and running several real turns in one session.

`SELECT DISTINCT key FROM span_attributes WHERE key LIKE '%cache%'`
confirms `gen_ai.usage.cache_creation.input_tokens` rows exist (18 in this
capture) with real, non-trivial, non-zero values (e.g. `19247`, `16860`,
`20326`, `51731`). Joining `spans` (for the denormalized `input_tokens`/
`output_tokens`/`cached_tokens`/`reasoning_tokens` columns) against
`span_attributes` (for `cache_creation.input_tokens`, not denormalized —
§3/§5d) for one real `claude-sonnet-5` session's `chat`-operation spans,
ordered by `start_time_ms`:

| input | output | cache_read | cache_write | reasoning | AI Credits |
|---|---|---|---|---|---|
| 30091 | 1567 | 13230 | 16860 | 119 | 6.05 |
| 31710 | 43 | 30090 | 1618 | — | 1.05 |
| 33557 | 383 | 13230 | 20326 | 99 | 5.73 |
| 38108 | 564 | 33556 | 4550 | 28 | 2.37 |
| 47255 | 689 | 38106 | 9147 | 26 | 3.74 |
| 55919 | 314 | 47253 | 8664 | 72 | 3.43 |
| 58901 | 471 | 55917 | 2982 | 209 | 2.34 |
| 64963 | 3099 | 58899 | 6062 | 1656 | 5.79 |
| 69928 | 678 | 64961 | 4966 | 152 | 3.22 |

The data is internally coherent, not noise: row 2's `cache_read` (30090)
equals row 1's `cache_read + cache_write` (13230 + 16860 = 30090) almost
exactly, and this pattern holds down the table — the cache written in one
turn becomes (most of) the cache read in the next, exactly matching how
prompt caching is expected to behave. This confirms §3/§5d's conclusion
end to end: input, output, cache-read, cache-write, and reasoning tokens
are all real, available, per-request today, once this one opt-in setting
is on. Nothing about this required source-level inference or estimation —
it's the API's own reported values, read straight out of the local DB.

**One gap noticed in passing, unrelated to the cache-write question**: the
`spans.turn_index` column (denormalized from `CopilotChatAttr.TURN_INDEX`
per `otelSqliteStore.ts`'s `DENORMALIZED_ATTRS`, §5d) came back empty on
every row in this capture, unlike the other denormalized columns. Ordering
by `start_time_ms` within `chat_session_id` works as a substitute (used
above) and produced a clean, chronologically correct sequence, so this
doesn't block using the table — but a future `LogProvider` built on this
source shouldn't rely on `turn_index` being populated without checking
against a fresh capture first.

## Evidence index

| Claim | Source |
|---|---|
| Repo is archived, dev moved to `microsoft/vscode` | `git log -1 HEAD` = `5863f5a7` "Add archive notice", 2026-05-20; `README.md` diff in that commit |
| Real `main.jsonl` already has `cachedTokens` as of 2026-08-08 | `packages/server/fixtures/jsonl/real-session-with-usage.jsonl`, entry `ts: 1786202790374` |
| Archived `_spanToEntry` CHAT case omits cache/reasoning fields | `src/extension/chat/vscode-node/chatDebugFileLoggerService.ts:873-937` |
| `GenAiAttr` schema has cache-creation/reasoning keys unused by `_spanToEntry` | `src/platform/otel/common/genAiAttributes.ts:61-67` |
| `main.jsonl`'s sole writer is `ChatDebugFileLoggerService` | `search_text "main.jsonl"` across the repo — all matches in this one file (+ its own test) |
| `agent-traces.db` / `OTelSqliteStore` exists, is opt-in, stores raw span attributes | `src/platform/otel/node/sqlite/otelSqliteStore.ts:141-249`; gating setting `src/platform/configuration/common/configurationService.ts:705`; path `src/extension/extension/vscode-node/services.ts:270-272` |
| GitHub backend raw response shape | Not found in archived source; resolved practically in §5c against live source |
| Live source confirms `cachedTokens` added to `_spanToEntry`'s `CHAT` case | `microsoft/vscode` HEAD `add9a5100` (2026-08-09), `extensions/copilot/src/extension/chat/vscode-node/chatDebugFileLoggerService.ts:975-1021` |
| Cache-creation/reasoning tokens ARE parsed from the GitHub-routed response, just not projected into `main.jsonl` | `extensions/copilot/src/extension/prompt/node/chatMLFetcher.ts:396-441` (sets `providerName: GenAiProviderName.GITHUB`) |
| Reasoning tokens are a subset of output tokens, not additive | `extensions/copilot/src/extension/intents/node/toolCallingLoop.ts:1380` (comment) |
| `APIUsage.prompt_tokens_details`/`completion_tokens_details` is one shared cross-provider type | `extensions/copilot/src/extension/byok/vscode-node/anthropicProvider.ts:783` (comment: "Cast needed: Anthropic returns cache_creation_input_tokens which APIUsage.prompt_tokens_details doesn't define") |
| `agent-traces.db` denormalizes `reasoning_tokens` as its own column and captures all raw attributes (incl. cache-creation) verbatim | `extensions/copilot/src/platform/otel/node/sqlite/otelSqliteStore.ts:28-43` (`DENORMALIZED_ATTRS`), `:141-183` (`insertSpan`) |
| AI Credits (`copilotUsageNanoAiu`) is a pre-computed, server-side cost figure GitHub's backend returns directly — not derived from token counts on the client | `extensions/copilot/src/platform/endpoint/node/messagesApi.ts:163` (`copilot_usage?.total_nano_aiu` response field); `extensions/copilot/src/extension/prompt/node/chatMLFetcher.ts:400-401,444-445` (reads and relays it, no token math) |
| Empirically confirmed: `agent-traces.db` carries real, non-zero cache-write values, coherent across turns | This machine's own `~/.config/Code - Insiders/User/globalStorage/github.copilot-chat/agent-traces.db`, captured 2026-08-09 after enabling `otel.dbSpanExporter.enabled` and running a real session; 18 `gen_ai.usage.cache_creation.input_tokens` rows in `span_attributes` |
