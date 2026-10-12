# MCP tools v2: cost, security and turn drill-down, plus a UX pass

Status: **complete (Phase 9.12)**. This plan extends the read-only stdio MCP
server from Phase 9.10 ([tool-call-audit.md](tool-call-audit.md) §10).

## 1. Context

The Phase 9.10 MCP server answers one question well: *why did my agent's
tool calls fail?* The product is a **cost** analyzer, though, and Phase 9.11
added security, anomaly and behaviour-change findings. Neither is reachable
over MCP. The user asked for three things:

1. A critical assessment of the existing tools.
2. A proposal for new tools that cover cost, security and tool usage.
3. An improved set of tool names, parameters and descriptions that gets
   the most out of the agent's UX, followed by the implementation.

## 2. Assessment of the v1 tools

| Tool | Strengths | Problems |
|---|---|---|
| `list_log_providers` | Cheap, clear. | Doesn't say which provider the defaulting tools use, or that the dashboard-style tools read every provider. |
| `list_sessions` | Date window, most recent first. | No title search, so an agent has to page through ids to find "the session about X". It doesn't report how many sessions matched in total, so the model can't tell whether `limit` cut the list. It has no cost or model column, so it can't help pick which session to look into. |
| `get_session_audit` | Compact by default (`includeCalls`), good coverage reporting. | Fine as is. |
| `list_tool_calls` | Rich filters. | No `offset`, so once `total > limit` the remaining calls can't be reached. No `kind` filter (shell, file-write, web, mcp, subagent, ...), which is the natural way to ask "what did it do on the network?". |
| `get_audit_rollup` | Good aggregates. | Only covers one provider, unlike the dashboard. That's acceptable, but the description has to say so. |
| Errors | Returned as `isError` results, not crashes. | Not actionable: "Unknown session id" doesn't tell the model what to do next, and an unknown provider doesn't list the valid ids. |
| Server | | No server `instructions`, so the client model has no map of the workflow, its units, or the "unknown is never 0" rule. No `outputSchema`, so clients can't validate or introspect `structuredContent`. |
| Prompts | `audit_session` works. | No canned workflows for the other two questions the product exists for: cost and security. |

**Coverage gaps (the important finding):**

- **Cost.** No tool returns token or AI Credits figures at all, even
  though every `Session` carries per-turn `TurnUsage` and the dashboard
  already flattens it. An agent can't answer "what drove my spend?" or
  "why was this session expensive?".
- **Security and behaviour.** The Phase 9.11 detectors (credential access,
  pipe-to-shell, force-push, exfiltration, cost outliers, first use of a
  new program, ...) are only visible in the web Dashboard. Insights plan
  §8 lists `list_security_findings` as a follow-up.
- **Drill-down.** There is no way to read what happened in one turn
  (prompt, response, usage, calls), so the agent can't explain why an
  expensive or failing turn happened.

### 2.1 Naming

The v1 names (`verb_noun`, snake_case) are consistent and already
registered in users' MCP configs, so **none are renamed**. The new tools
follow the same pattern and pair up with the v1 ones:
`get_session_audit` / `get_session_cost`, `get_audit_rollup` /
`get_cost_rollup`. The planned `list_security_findings` becomes
**`list_findings`** with a `kind` filter. All three detector kinds share
one shape, and one tool is easier for a model to choose than three.

## 3. Changes to the v1 tools

| Tool | Change |
|---|---|
| server | Adds `instructions`: the workflow (find a session, then drill down), which tools cover one provider and which cover all, units (tokens, AI Credits), and the rule that `null` means unknown. |
| all | Every description starts with *when to use it*, then states defaults. Each tool declares an `outputSchema` (a domain zod schema), so the SDK validates `structuredContent`. |
| `list_sessions` | Adds `query` (case-insensitive substring of the title or id). The response adds `total` (the number of matches before `limit`) and `model`. |
| `list_tool_calls` | Adds `kind` (a list of tool kinds) and `offset`. The response echoes `offset`. `offset` is also accepted by `GET /api/sessions/:id/tool-calls`, because both surfaces share the filter schema. |
| errors | An unknown session returns `Unknown session id "x" for provider "y". Call list_sessions to find valid ids.` An unknown provider lists the known ids. |

## 4. New tools

All are read-only, return JSON plus `structuredContent`, and validate
their output against a domain schema.

| Tool | Input | Returns |
|---|---|---|
| `get_session_cost` | `sessionId`, `provider?`, `topTurns?` (default 5, max 50) | `SessionCost`: per-measure totals with coverage (uncached input, cache write, cache read, reasoning, output, AI Credits), cache hit ratio, a per-model breakdown, the most expensive turns, cost-relevant events (compaction, cache expiry, model switch, ...), and context overhead (system-prompt components and tool inventory, including tools defined but never invoked). |
| `get_cost_rollup` | `provider?`, `since?`, `until?`, `limit?` (sessions per provider, default 50, max 500), `topSessions?` (default 10) | `CostRollup` across **every** provider by default: totals with coverage, cache hit ratio, and breakdowns by provider, model and day, plus the top sessions. |
| `list_findings` | `provider?`, `since?`, `until?`, `limit?`, `kind?[]`, `minSeverity?`, `category?`, `sessionId?`, `maxResults?` (default 50) | `{ total, bySeverity, providers, findings }`: security, anomaly and behaviour-change findings, most severe first, each with its session title, provider, turn, what, when, why, and redacted evidence. |
| `get_turn` | `sessionId`, `turnIndex`, `provider?`, `maxTextChars?` (default 2000, max 20000) | One turn: the user message and assistant response (redacted, then truncated, with flags saying whether they were truncated), its `TurnUsage`, the triggered event, the explanation, and compact tool calls (name, kind, status, failure category, command excerpt). |

### 4.1 Cost semantics (constraint 6)

- A measure total is `{ value: number | null, knownTurns, turns, estimated }`.
  `value` sums only known turns and is `null` when no turn is known. It is
  never `0` for unknown data. `knownTurns < turns` signals partial coverage.
- "Input tokens" for ranking is uncached input + cache write + cache read.
  This matches `SessionAudit.failureRecoveryCost`. Turns rank by AI Credits
  when the session has AI Credits for every turn, otherwise by input
  tokens. `rankedBy` states which one was used.
- The cache hit ratio is cache read ÷ input tokens, over turns where all
  three input measures are known. It is `null` when there are none.
- The cost rollup is built from the same `InsightsDataset` the dashboard
  uses. MCP and the UI therefore agree, and a provider that is unavailable
  or fails shows up in `providers[]`, never as missing spend.

### 4.2 New prompts

- `review_costs` (`since?`, `provider?`): call `get_cost_rollup`, then
  `get_session_cost` on the top sessions and `get_turn` on their top turns,
  and recommend concrete savings (cache-friendly prompts, trimming unused
  tools, avoiding model switches, cheaper models for simple turns).
- `security_review` (`since?`, `provider?`): call `list_findings` with
  `kind: ["security"]` and `minSeverity: "medium"`, read the evidence,
  separate expected activity from risky activity, and suggest guardrails
  (permission rules, CLAUDE.md hints).

## 5. Design (SOLID)

- **Pure builders** with no I/O, each with its own tests:
  - `services/cost/session-cost-builder.ts` (`Session` → `SessionCost`)
  - `services/cost/cost-rollup-builder.ts` (`InsightsDataset` → `CostRollup`)
  - `services/insights/findings-query.ts` (`InsightsDataset` + filter → findings result)
  - `services/session-view/turn-view-builder.ts` (`Turn` → bounded, redacted `TurnView`)
- **Domain shapes** live in `packages/domain/src/cost.ts` and
  `turn-view.ts` (zod), plus `findingsQueryResultSchema` in `insights.ts`.
  They are reused as the MCP `outputSchema`s.
- **`AnalysisQueryService`** (`services/analysis/analysis-query-service.ts`)
  composes the builders over the narrow `ProviderLookup` (one provider)
  and an `InsightsSource` (`getDataset`, all providers). This follows DIP:
  the MCP layer depends on interfaces, not on the registry.
- **MCP layer.** `audit-mcp-server.ts` is renamed to `mcp-server.ts` and
  becomes a thin `createMcpServer` that sets the server instructions and
  registers tool groups from separate modules: `session-tools.ts`
  (`list_log_providers`, `list_sessions`, `get_turn`), `audit-tools.ts`,
  `cost-tools.ts`, `finding-tools.ts` and `prompts.ts`. Adding a group
  doesn't touch the others (OCP). Shared helpers (`json`, `toolError`,
  `unknownSession`, `createGuard`, argument schemas) live in
  `mcp/tool-helpers.ts`. `stdio.ts` is the only caller.
- **Composition.** `composition/create-insights-service.ts` wires the
  three Phase 9.11 detectors once, for both `app.ts` and `stdio.ts`, so
  the HTTP Dashboard and MCP `list_findings` report the same findings.

## 6. Security

Everything an MCP tool returns enters the client model's context, which
is usually a hosted model. So:

- `get_turn` passes the user message, the assistant response and the
  explanation through `redactSecrets` and truncates them to
  `maxTextChars`. Tool calls carry only the existing bounded, redacted
  command excerpts.
- Findings carry only the detector's already-redacted `evidence`.
- No tool writes, executes, or reaches the network. The server stays
  stdio-only (constraint 1, §11.2).

## 7. Exit criterion

- `tools/list` returns 9 tools: the 5 from v1 plus `get_session_cost`,
  `get_cost_rollup`, `list_findings` and `get_turn`. Every tool is
  annotated read-only and has an `outputSchema`.
- `prompts/list` returns `audit_session`, `review_costs` and
  `security_review`.
- For the real-capture Claude Code fixture over stdio, `get_session_cost`
  reports token totals with full coverage and AI Credits as unknown
  (`value: null`), never as 0.
- Every builder has unit tests, including partial-coverage and all-unknown
  cases.

## 8. Out of scope (follow-ups)

- HTTP endpoints for `SessionCost` and `CostRollup`. The UI already
  derives these client-side from `Session` and `InsightsDataset`.
- An audit rollup across all providers, which would change `get_audit_rollup`'s
  default and so its behaviour.
- `get_turn_detail` (raw request/response rounds). They are unbounded and
  can contain whole files, so they need a separate size and redaction
  design.
