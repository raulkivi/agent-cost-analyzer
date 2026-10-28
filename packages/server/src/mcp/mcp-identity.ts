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
}

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
  ].join("\n\n"),
  logSourcesDescription: "VS Code Copilot Chat, Claude Code CLI, pi, mitmproxy captures",
  providerArgDescription:
    'Log provider id, e.g. "claude-code", "vscode", "pi-agent", "mitmproxy" (see list_log_providers). Defaults to the provider active in the web app.',
};
