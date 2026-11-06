# Learn simulation: calibration findings (step 13.5a)

The simulator (Phase 13) was replayed against real request logs from past
sessions on the owner's machine. The captures hold numbers only: per request,
the gap since the previous request and the provider's cache read, cache write,
uncached input and output counts. No prompt, response, tool or path text is
stored. Fixtures: `packages/server/fixtures/learn-calibration/`; test:
`packages/server/src/services/learn-simulation/calibration/calibration.test.ts`.

Method: for each capture, the simulator is fed a script derived from the
capture's token totals and gaps, and every request after the first must match
the recorded hit/miss and read within 5% of the recorded cache read (D12). The
first request is excluded: it reads the tools and system prompt that earlier
sessions left in the shared cache.

## Result

| Source | Sessions | Requests compared | Disagreements |
|---|---|---|---|
| Claude Code (Opus 5.5, Sonnet 5.5), main chain only | 188 (17 more skipped, see below) | 15,320 | 35 (0.2%) |
| Copilot Chat, local harness, `claude-sonnet-5` | 1 (the one with clean per-request data) | 39 | 0 |

155 of the 188 Claude Code sessions match completely. The committed fixtures
are four Claude Code sessions and one Copilot session. Two of the Claude Code
ones are pinned as known disagreements (below); the rest must match fully.

## Findings that changed what we believe

1. **Claude Code writes its cache with the 1-hour lifetime.** 186 of 188
   sessions have every cache write recorded as 1-hour, and 643 requests came
   after a gap over 5 minutes and still read the cache. The simulator
   reproduces all of them once a script uses the `extended-ttl` event, and
   misses them with the 5-minute default (`replay.test.ts` pins this).
   **Consequence for the product:** scenarios that teach a 5-minute lapse
   (for example the smoke-break scenario) describe a Claude Code user on a
   5-minute lifetime, which these logs show is not what Claude Code does on
   this machine. Whether that holds for every user (for example API-key
   users) isn't known. **Open decision for the owner:** keep the scenarios
   as a general lesson with a note, or apply the 1-hour lifetime on the
   Claude Code harness.
2. **The conversation cache grows exactly as the rules say.** Each request
   reads the whole previous prompt and writes only the new tokens (the
   previous output plus new content). S2 and S3 hold on real data.
3. **Thinking tokens are not carried forward.** The simulator's accounting
   (reasoning is billed as output but not added to the next prompt) matched
   the recorded totals; no request needed a correction.
4. **The Copilot local harness shows the same read pattern** (each read is the
   previous input to within 2 tokens). Its store records no cache writes, so
   only reads and hit/miss are compared. Its largest gap is 2 minutes, so it
   says nothing about Copilot's lifetime. A Copilot Agent Host log with
   `cacheTtlSeconds` would test the 5-minute assumption directly; none with a
   Claude model exists on this machine.

## Disagreements the rules can't explain

| Pattern | Seen | What happens | Status |
|---|---|---|---|
| Prompt changed before the last messages | about 1 request in 440 overall (35 of 15,320, together with the cross-session case) | Only part of the cache is read, with no event in the log to say why (an edited earlier message or attachment). | Pinned in the test (`claude-code-39e87ae3`, request 14). No rule can predict it. |
| Cache shared across sessions | after gaps over an hour | The conversation expired, but the tools and system prompt were still warm from another session, so the read was partial, not a miss. | Pinned (`claude-code-2e4ad1d9`, request 20). Not modelled: the simulator treats every scenario as a cold start. |
| Prompt shrinks | 17 sessions | Compaction or clear removes tokens; a script can't express a negative delta from totals alone, so these sessions were skipped, not matched. | Out of scope for calibration; covered by the compaction and clear rules' own tests. |

## Not calibrated

- Other vendors (OpenAI, Google, xAI): no real logs on this machine.
- The cache-write price: logs record counts, not charges.
- Copilot's breakpoint placement and lifetime (see 4).
