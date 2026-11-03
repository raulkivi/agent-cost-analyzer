# Scenario 5: Changing MCP Tools Mid-Session

> Extracted from [docs/agentic-coding-explained.md](../agentic-coding-explained.md#12-how-changing-mcp-tools-mid-session-affects-tokens-cache-and-ai-credits), Section 12.

The list of available tools (including MCP server tools) — their names,
descriptions, and JSON schemas — is sent to the model as part of the request on
every turn, usually near the top of the prompt (close to the system prompt). If
the enabled toolset changes mid-session (a user enables/disables an MCP server,
or a custom agent swaps its tools) starting at turn 3, that block of the prefix
changes.

What this does to tokens/cache/AI Credits:

- **Full cache invalidation**: the tool definitions are the first block of the prefix, and Anthropic documents that modifying them "invalidates the entire cache" ([Anthropic: what invalidates the cache](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#what-invalidates-the-cache)) — the system prompt and all of the prior conversation — even though the model and
  its rates stay exactly the same.
- **No rate change**: unlike a model switch, the per-token prices don't change —
  the extra AI Credits spend comes purely from losing the cache, not from a pricier model.
- **A new cache rebuilds** from the tool-change turn forward, under the new
  toolset, the same way a fresh session would.

This example changes the enabled MCP tools starting at turn 3 (same model/rates
throughout as [Scenario 1](01-cache-basics-8-turn-session.md)'s Model A: cache
write 0.00625 AI Credits, cache read 0.0005 AI Credits, uncached input/tool 0.005 AI Credits,
reasoning/output 0.015 AI Credits per 1K tokens):

| Turn | What happens | Cache write | Cache read | Cache size after | Uncached input | Tool | Reasoning | Output text | **Turn total** | **Turn AI Credits** |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Normal turn; writes static prefix (incl. old toolset) + own content | 3500 | 0 | 3500 | 500 | 0 | 150 | 150 | **4300** | **0.0289 AI Credits** |
| 2 | Normal turn; reads/extends the cache | 600 | 3500 | 4100 | 200 | 100 | 120 | 180 | **4700** | **0.0115 AI Credits** |
| 3 | **MCP toolset changes**: new tool schemas alter the early prefix; the prior 4100-token cache no longer matches and must be resent uncached; a new cache is written under the new toolset | 4770 | 0 | 4770 | 4350 | 0 | 200 | 220 | **9540** | **0.0579 AI Credits** |
| 4 | Normal turn; uses one of the newly enabled tools | 800 | 4770 | 5570 | 110 | 400 | 130 | 160 | **6370** | **0.0143 AI Credits** |
| 5 | Normal turn; cache continues building under the new toolset | 240 | 5570 | 5810 | 70 | 0 | 70 | 100 | **6050** | **0.0072 AI Credits** |

Turn 3 (**0.0579 AI Credits**) is about 5x a normal turn — a real spike, but far
smaller than the ~10x spike from a model switch ([Scenario 4](04-model-switch.md)),
because the model and its rates didn't change, only the cache. This is the general
pattern: **model switches invalidate the cache *and* change the price per token**,
while **tool/instruction changes invalidate the cache but keep the same price per
token** — both use more AI Credits on the turn of the change, but a model switch usually
hurts more.

**Sources** (checked 2026-11-03):

- [Anthropic: what invalidates the cache](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#what-invalidates-the-cache): tool definitions come first; changing them invalidates the entire cache
- [Claude Code: actions that invalidate the cache](https://code.claude.com/docs/en/prompt-caching#actions-that-invalidate-the-cache): Claude Code's tool search keeps the cache on MCP changes
- [VS Code: tools](https://code.visualstudio.com/docs/agents/run/tools): enabling/disabling tools; 128-tool limit

Fact-check: see [learn-scenarios-fact-check.md](../learn-scenarios-fact-check.md#per-scenario-verdicts). Open findings for this scenario: F-07, R-01.
