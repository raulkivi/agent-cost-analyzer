# Alternative log/cache-data sources for LogProvider: ranked options

Actionable conclusions from
[copilot-chat-source-investigation.md](../copilot-chat-source-investigation.md),
scoped for whoever picks up Phase 9+ `LogProvider` work. Read that document
first for the evidence; this one is the recommendation, kept separate so
this repo's convention of one doc per concern holds (per
[implementation-plan.md](../implementation-plan.md)).

**Update (2026-08-09, source check)**: the investigation doc's §5 confirmed
options #1 and #4 below against the *live* `microsoft/vscode` source (not
the archived mirror #1's original writeup was based on). Option #1 is now a
source-confirmed mechanism, not a speculative lead; option #4's open
question is now practically resolved.

**Update (2026-08-09, empirical confirmation)**: option #1's one remaining
open step — whether `agent-traces.db` actually populates cache-write data
in practice, not just in principle — is now closed. Investigation doc §5f:
a real capture from this machine, after enabling
`otel.dbSpanExporter.enabled` and running a real session, shows real,
non-zero `gen_ai.usage.cache_creation.input_tokens` values, internally
coherent turn-to-turn (one turn's cache-write becomes the next turn's
cache-read, as expected). Option #1 is no longer a recommendation pending
verification — it's a confirmed, working local data source. Rankings and
next step updated accordingly below.

## Ranked options

### 1. `agent-traces.db` (OTel SQLite span store) as a new `LogProvider` — top pick, confirmed working

Confirmed against the live `microsoft/vscode` source (investigation doc
§5b–§5d), not just the archived mirror: the GitHub-routed chat fetch already
parses cache-creation and reasoning token counts out of the response and
sets them on the OTel span (`chatMLFetcher.ts:396-441`); `agent-traces.db`
stores `reasoning_tokens` as its own indexed column and captures every other
raw span attribute — including cache-creation — verbatim in a generic
key/value table (`otelSqliteStore.ts:28-43,141-183`). So enabling this
setting should unlock the full input/output/cache-read/cache-creation/
reasoning breakdown per span that `main.jsonl` structurally cannot carry
(§5a: `_spanToEntry` just doesn't project those two fields), plus
already-built session/conversation grouping and structured SQL access — the
same `node:sqlite` pattern this project already uses for the VS Code
chat-session store (`architecture.md` §6.2.2), so no new dependency class.

**Tradeoffs**: requires the user to flip one VS Code setting
(`github.copilot.chat.otel.dbSpanExporter.enabled`) and start a fresh
session — same one-time, non-retroactive friction the existing
`agentDebugLog.fileLogging.enabled` setting already has (see this project's
own README §"Enabling GitHub Copilot Chat debug logging"), so it fits the
existing UX pattern rather than introducing a new one. No proxy, no
certificate trust, no external process — meaningfully lower setup cost than
the mitmproxy plan. Schema is versioned (`SCHEMA_VERSION`) and owned by the
same extension that owns `main.jsonl`, so likely more stable than
reverse-engineering an HTTP wire format. Note reasoning tokens are a subset
of output tokens, not additive (investigation doc §5b) — don't double-count
when building any UI total.

**Confirmed working, empirically (investigation doc §5f)**: with
`github.copilot.chat.otel.dbSpanExporter.enabled` on, this machine's own
`agent-traces.db` shows real, non-zero, internally-coherent cache-write
values end to end (span creation → SQLite insert → query) — not just a
code path that theoretically supports it. Nothing left to verify before
building against this source. Turn-index note: the schema's `turn_index`
column came back empty in this capture — ordering `chat`-operation spans by
`start_time_ms` within `chat_session_id` works as a substitute (used in the
investigation doc's example table) and produced a correct chronological
sequence, but a `LogProvider` built on this shouldn't assume `turn_index`
is populated without checking a fresh capture first.

This becomes step 2 in Phase 9's TDD sequence (alongside "Adapt the VS Code
path"), most likely as an enrichment source `VscodeLogProvider` reads *in
addition to* `main.jsonl` when the file is present, rather than a separate
provider id — that keeps one provider per underlying VS Code install rather
than fragmenting "VS Code data" across two ids the user would have to
understand the difference between.

### 2. Full OTel export (`otel.enabled` + OTLP exporter) — same data, more setup

Same span/attribute richness as #1 in principle, but requires running or
pointing at an OTLP collector, or parsing OTLP file-exporter output — more
moving parts than #1 for equivalent data. Only worth it if #1's SQLite path
turns out to be unavailable or removed in the current shipping extension.

### 3. `main.jsonl` at higher verbosity — not viable for cache-write/reasoning data

Confirmed by direct evidence (investigation doc §1–§2): even a real,
current capture with maximal fidelity is structurally missing cache-write
and reasoning tokens, because `_spanToEntry`'s per-operation field list
— not a verbosity setting — determines what's projected into the file. No
setting changes what gets written. Already correctly handled as
`known: false` / omitted by this project's existing extractor and
`architecture.md` §7's "actionable unavailable" contract; nothing to change
here except possibly a code comment once #1 is confirmed to close this gap
via a different provider.

### 4. mitmproxy HAR (Phase 9's original plan) — still useful, now for a narrower purpose

Since the extension already parses and normalizes cache-creation/reasoning
usage before `main.jsonl` (or, per #1, `agent-traces.db`) ever sees it, a
HAR capture of Copilot Chat's own traffic is no longer the best path to
*richer Copilot cache data specifically* — #1 is closer to the source and
far lower friction. The investigation doc's §5c also practically resolves
Phase 9 §13's open caveat: the GitHub-routed response already yields
cache-creation and reasoning figures via an OpenAI-`usage`-detail-shaped
internal type (`APIUsage.prompt_tokens_details`/`completion_tokens_details`,
also used to normalize Anthropic's native fields), so a future mitmproxy
decoder for Copilot traffic specifically would very likely need an
OpenAI-shaped decoder, not a from-scratch reverse-engineering effort — the
one still-unconfirmed detail is the exact raw wire bytes
`api.githubcopilot.com` returns, which only matters if someone actually
builds that decoder.

mitmproxy capture remains valuable for what #1 and #3 structurally can't
address at all: **non-Copilot coding agents** (Claude Code, aider, etc.)
that call vendor APIs directly — the multi-agent part of `vision.md`'s
scope.

No change to Phase 9's existing mitmproxy design is implied by this
investigation; only its relative priority against #1 for the *Copilot*
cache-data gap specifically, and lower risk on the wire-format unknown than
Phase 9 §13 originally flagged.

## Suggested next step

The empirical verification is done (investigation doc §5f) — `agent-traces`
is confirmed as a real, working local data source with the full
input/output/cache-read/cache-write/reasoning breakdown, not a speculative
lead. The next step is implementation: `agent-traces` (not `mitmproxy`)
should be Phase 9's next `LogProvider` after `vscode`, per the TDD sequence
option #1 above lays out — starting with the `LogProvider` contract test
harness against a fixture `agent-traces.db` (a trimmed, redacted copy of
this machine's real capture, following the same fixture-collection
discipline already established for HAR fixtures).

## Decision (2026-08-10)

Accepted, resolving the sequencing question this recommendation raised (was
option #1 above a separate provider id, or folded into the existing VS Code
path?): `agent-traces.db` enrichment is refactored out of `app.ts` and
folded into `VscodeLogProvider` as an internal detail — not its own
`LogProvider` id, and not left as Phase 8.5's direct `app.ts` wiring.
`mitmproxy` is Phase 9's second, and only other, registered provider,
matching this document's #4 finding that mitmproxy stays the right tool for
non-Copilot agents rather than being obsoleted. See
`implementation-plan.md`'s Phase 9 section for the resulting plan updates.
