import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Canned workflows (docs/plans/tool-call-audit.md §10, mcp-tools-v2.md §4.2).

function scope(since?: string, provider?: string): string {
  return [since ? ` since ${since}` : "", provider ? ` for provider "${provider}"` : ""].join("");
}

function args(since?: string, provider?: string): string {
  const parts = [since ? `since "${since}"` : "", provider ? `provider "${provider}"` : ""].filter(Boolean);
  return parts.length ? ` (with ${parts.join(" and ")})` : "";
}

function userMessage(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "audit_session",
    {
      title: "Audit a session's tool calls",
      description: "Explain why an agent session's tool calls failed and how to avoid it next time.",
      argsSchema: { sessionId: z.string(), provider: z.string().optional() },
    },
    ({ sessionId, provider }) =>
      userMessage(
        `Audit the tool calls of session "${sessionId}"${provider ? ` (provider "${provider}")` : ""}. ` +
          "Call get_session_audit first, then list_tool_calls with status [\"error\",\"interrupted\",\"denied\"] for the evidence. " +
          "Group the failures by category (missing utility, wrong directory, bad arguments, missing dependency, git state, ...), " +
          "name the commands and turns involved, point out retried commands and the tokens spent in affected turns, " +
          "and give concrete fixes (e.g. install a tool, run from the right directory, correct a flag, add a CLAUDE.md hint). " +
          "Say explicitly when outcome coverage is incomplete.",
      ),
  );

  server.registerPrompt(
    "review_costs",
    {
      title: "Review what drives my AI spend",
      description: "Find the sessions, turns and habits that drive token and AI Credits spend, and suggest savings.",
      argsSchema: { since: z.string().optional(), provider: z.string().optional() },
    },
    ({ since, provider }) =>
      userMessage(
        `Review my AI coding-agent spend${scope(since, provider)}. ` +
          `Call get_cost_rollup${args(since, provider)} first, then get_session_cost on the top 3 sessions and get_turn on their most expensive turns. ` +
          "Explain what drives the spend: cache misses (low cache hit ratio, cache-expiry events), large or growing context, compactions, " +
          "model switches, expensive models used for simple turns, unused tools inflating every request, retries after failed tool calls. " +
          "Give concrete, prioritised savings with the evidence (session, turn, figures). " +
          "Treat null figures as unknown, never as zero, and say where coverage is partial.",
      ),
  );

  server.registerPrompt(
    "security_review",
    {
      title: "Review what my agents did that was risky",
      description: "Review security findings: what happened, when, why it matters, and which guardrails would prevent it.",
      argsSchema: { since: z.string().optional(), provider: z.string().optional() },
    },
    ({ since, provider }) =>
      userMessage(
        `Review what my AI coding agents did that could be risky${scope(since, provider)}. ` +
          `Call list_findings${args(since, provider)} with kind ["security"] and minSeverity "medium", then get_turn on the most severe findings for context. ` +
          "For each, say what happened, when, in which session, and whether it looks expected (e.g. installing a declared dependency) or risky " +
          "(credential access, piping a download into a shell, force-pushing, uploading data). " +
          "Then call list_findings with kind [\"behavior-change\",\"anomaly\"] to spot new programs, tools or outlier sessions. " +
          "Finish with concrete guardrails: permission rules to add, commands to deny, CLAUDE.md guidance.",
      ),
  );
}
