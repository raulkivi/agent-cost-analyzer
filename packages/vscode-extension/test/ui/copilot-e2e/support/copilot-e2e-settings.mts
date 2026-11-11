// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What the real-Copilot suite lets the chat do (owner decision D6,
// docs/plans/release-ui-gate.md). VS Code 1.145 asks before an MCP tool call
// only when the tool lacks `readOnlyHint` (every analyzer tool has it), so
// the analyzer's tools need no approval and nothing is auto-approved: no
// global auto approve, no terminal auto approve. The chat runs in a test-only
// agent whose only tools are the analyzer's server, and MCP discovery from
// other apps' configs (Claude Desktop, Copilot CLI, Windsurf, Cursor) is off,
// so the owner's other servers are never offered.

// VS Code names an MCP server's tool set after its label, lower-cased with
// dashes (MCP_SERVER_LABEL "AI Credits Analyzer").
export const ANALYZER_TOOL_SET = "ai-credits-analyzer";
export const COPILOT_E2E_AGENT = "aica-e2e";

export const COPILOT_E2E_SETTINGS = {
  // Local harness chats record token data only with debug logging on.
  "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
  "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
  "aiCreditsAnalyzer.mcp.enabled": true,
  "chat.mcp.discovery.enabled": {
    "claude-desktop": false,
    copilot: false,
    windsurf: false,
    "cursor-global": false,
    "cursor-workspace": false,
  },
  "chat.tools.terminal.enableAutoApprove": false,
  "workbench.startupEditor": "none",
  "extensions.autoCheckUpdates": false,
  "update.mode": "none",
  "telemetry.telemetryLevel": "off",
};

// A custom agent in the profile copy's prompts folder; the specs open the chat in it.
export function copilotE2eAgentFile(): { name: string; content: string } {
  return {
    name: `${COPILOT_E2E_AGENT}.agent.md`,
    content: [
      "---",
      `name: ${COPILOT_E2E_AGENT}`,
      "description: Test-only agent of the AI Credits Analyzer real-Copilot suite. Its only tools are the analyzer's MCP tools.",
      `tools: ['${ANALYZER_TOOL_SET}/*']`,
      "---",
      "Do what the user asks with as few tool calls and words as possible.",
      "",
    ].join("\n"),
  };
}
