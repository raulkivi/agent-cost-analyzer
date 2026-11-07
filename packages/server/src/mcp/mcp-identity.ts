// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What differs between the products that serve the MCP tools
// (vscode-extension.md step 10.9): the server's name, title and description
// and the texts that name log sources. Tool names, schemas and prompts are the same for every
// product, so this holds only those texts; createMcpServer takes it as an
// option and the standalone server's wording is the default.

export interface McpIdentity {
  // The MCP server's name, as clients list it.
  name: string;
  // The product name clients display in place of `name`.
  title: string;
  // One line for the user, with the author: MCP has no author field.
  description: string;
  // What the model reads on connect: scope, workflow, units.
  instructions: string;
  // The sources `list_log_providers` says it lists, without the brackets
  // ("VS Code Copilot Chat, Claude Code CLI, ...").
  logSourcesDescription: string;
  // The description of every tool's `provider` argument.
  providerArgDescription: string;
  // The URI scheme and publisher.name that opens the product's own UI
  // (MCP Apps views link back with it); left out where there is none.
  deepLinkBase?: string;
}

// Phase 15 step 15.13 (plan §10.1.4): what a cost figure means, the same
// for both products.
export const COST_BASIS_INSTRUCTIONS = [
  "Cost bases: billed is what the vendor billed (GitHub Copilot's AI Credits); reported is a cost the log itself records; priced is tokens × the price book's price for that model, channel and date (get_price_book lists the versions and their sources). The preferred basis takes billed, then reported, then priced; every total says how many turns it covers.",
  'Prices: "as of use" (the default) prices each turn at the prices in force when it ran; "today\'s prices" reprices every turn at today\'s, to compare usage without price changes.',
  "Conversion: 1 AI Credit = $0.01 (GitHub's documented rate); no other exchange rate is used.",
].join("\n\n");

// Phase 14 step 14.5 (analyze-session-replay.md §9, D7): replays, the same
// for both products.
export const REPLAY_INSTRUCTIONS =
  "Replay on another model: replay_session (one model, per turn) and compare_models_for_session (several, totals) run a session's own request trace through another model's caching rules and prices. Their figures are Simulated, assuming the same conversation and token counts: say \"would have cost about\". Check selfCheck (the replay on the session's own model against its log) and coverage (turns not replayed, with reasons) before relying on them.";

export const STANDALONE_MCP_IDENTITY: McpIdentity = {
  name: "agent-cost-analyzer",
  title: "Agent Cost Analyzer",
  description: "Token, AI Credits and tool-call analysis of your local AI coding-agent sessions, by Raul Kivi.",
  instructions: [
    "Read-only analyzer of local AI coding-agent logs (GitHub Copilot Chat in VS Code, Claude Code CLI, pi, mitmproxy captures). It never writes, executes or reaches the network.",
    "Workflow: find a session with list_sessions (query/since/until), then drill in with get_session_cost (spend), get_session_audit and list_tool_calls (tool-call failures), and get_turn (one turn's prompt, response, usage and calls). For trends use get_cost_rollup, get_audit_rollup and list_findings (security, anomalies, behaviour changes).",
    "Scope: per-session tools and get_audit_rollup read one provider, the `provider` argument or else the one active in the web app (list_log_providers shows activeProviderId). get_cost_rollup and list_findings read every available provider unless `provider` is given.",
    "Units: token counts are tokens; AI Credits are GitHub Copilot's billing unit and only VS Code sessions record them. A null figure is unknown, never zero: check knownTurns vs turns and unavailableReasons before comparing. `estimated` marks local-tokenizer estimates.",
    "Dates are ISO (YYYY-MM-DD or a timestamp), inclusive, compared against each session's start.",
    "Cost by repository and project: list_repositories and list_projects first, then get_project_cost or get_repository_cost (over time, by vendor and model) or compare_costs (several side by side), then explain_cost_change (usage, price and mix effects) and get_price_changes for the price changes behind it.",
    COST_BASIS_INSTRUCTIONS,
    REPLAY_INSTRUCTIONS,
    "Billing: get_statement reads a project's statement for a period; statements are issued only in the app, never by a tool. estimate_cost gives the cost of planned work as a p50–p90 range at today's prices, never one number; with `model`, on that model, simulated by replaying the project's sessions.",
  ].join("\n\n"),
  logSourcesDescription: "VS Code Copilot Chat, Claude Code CLI, pi, mitmproxy captures",
  providerArgDescription:
    'Log provider id, e.g. "claude-code", "vscode", "pi-agent", "mitmproxy" (see list_log_providers). Defaults to the provider active in the web app.',
};
