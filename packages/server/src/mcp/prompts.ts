// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
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

export function registerPrompts(server: McpServer, options: { costAnalysis?: boolean; statements?: boolean; estimates?: boolean } = {}): void {
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
          // Phase 15 step 15.7 (cost-by-repository-and-project.md §10.1.3): the project step.
          "If the list_projects tool is available and returns projects, also call compare_costs with groupBy \"project\" over those project ids (2 to 20) for the period, " +
          "and get_project_cost on the most expensive one; then group your findings and savings by project, with work outside any project last. " +
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

  // Phase 15 step 15.11 (§10.1.3): with statements only.
  if (options.statements) {
    server.registerPrompt(
      "prepare_statement",
      {
        title: "Prepare a client statement",
        description: "Summarise a project's statement for a period and draft a short note to the client.",
        argsSchema: { projectId: z.string(), period: z.string() },
      },
      ({ projectId, period }) =>
        userMessage(
          `Prepare the statement for project "${projectId}", period ${period}. ` +
            `Call get_statement with projectId "${projectId}" and period "${period}". ` +
            "Summarise the totals per currency (and in the project's own currency if it has one, with its rate), the markup and fixed lines, " +
            "the turns with unknown cost and why (they are not in the totals: say so, never count them as zero), subscription use left off, and the coverage. " +
            "If the statement is issued and the re-run differs, explain the diff line by line (late logs, a price-book change). " +
            "Then draft a short, plain note to the client. Remind me that issuing (freezing) the statement is done in the app's Billing tab, not here.",
        ),
    );
  }
  // Phase 15 step 15.12 (§10.1.3): with estimates only.
  if (options.estimates) {
    server.registerPrompt(
      "estimate_work",
      {
        title: "Estimate planned work",
        description: "Give a cost range for planned work on a project, its inputs and the main uncertainty.",
        argsSchema: { projectId: z.string(), activeDays: z.string() },
      },
      ({ projectId, activeDays }) =>
        userMessage(
          `Estimate what ${activeDays} more active days of work on project "${projectId}" will cost. ` +
            `Call estimate_cost with projectId "${projectId}" and activeDays ${activeDays} (and again with historyWeeks 4 to see the recent trend), then get_project_cost for the same project over the last 12 weeks. ` +
            "Give the p50–p90 range in USD at today's prices, never a single number, with the history it rests on (window, known days, coverage). " +
            "Name the main uncertainty: a recent model switch or price change, a few very expensive days, days left out for unknown cost, or a short history. " +
            "If there is no range, say why and what would make one possible.",
        ),
    );
  }
  // Phase 15 step 15.10 (cost-by-repository-and-project.md §10.1.3): with the cost analyses only.
  if (!options.costAnalysis) return;
  server.registerPrompt(
    "explain_cost_change",
    {
      title: "Explain why a cost changed",
      description: "Say whether more work, a price change or a model change drove a repository's or project's cost between two periods, and what to do about each.",
      argsSchema: { groupBy: z.enum(["repository", "project"]), id: z.string(), periodA: z.string(), periodB: z.string() },
    },
    ({ groupBy, id, periodA, periodB }) =>
      userMessage(
        `Explain why the cost of ${groupBy} "${id}" changed from ${periodA} to ${periodB}. ` +
          `Call compare_costs with groupBy "${groupBy}" for the period of ${periodB} if it helps to see the totals with coverage (it needs 2 ids, so add another ${groupBy} or skip it), ` +
          `then the explain_cost_change tool with groupBy "${groupBy}", id "${id}", periodA "${periodA}" and periodB "${periodB}", ` +
          "then get_price_changes for the models with the largest price effect over the same dates. " +
          "Say whether usage, price or mix drove the change, with the figures per currency and per model. " +
          "For each driver say what to do: for usage, which work grew; for price, which documented or observed change and whether the price book needs checking; for mix, which models the work moved between and whether a cheaper model would do. " +
          "Name turns that are not explained (no priced figure) and treat unknown figures as unknown, never as zero.",
      ),
  );
}
