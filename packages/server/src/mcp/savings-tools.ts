// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { pricingModeSchema } from "@agent-cost-analyzer/domain";
import { InvalidSavingsWindowError } from "../services/savings/savings-window.js";
import { dateArg, parseSavingsQuery } from "../services/savings/savings-query-params.js";
import type { SavingsQueries } from "../services/savings/savings-service.js";
import type { McpToolDeps } from "./mcp-server.js";
import {
  DEFAULT_SAVINGS_TOOL_OPPORTUNITIES,
  MAX_SAVINGS_TOOL_OPPORTUNITIES,
  savingsReportText,
  savingsToolOutput,
  savingsToolOutputSchema,
} from "./savings-tool-output.js";
import { providerArg, READ_ONLY, toolError, type Guard } from "./tool-helpers.js";

// Phase 16 SR19 (docs/plans/savings-report.md §8): the savings report for the
// model, in both products. Read-only: the report is computed on request by
// the same service the Savings tab reads (SavingsQueries), so the ranked
// opportunities are the tab's. Arguments are validated by the schema below
// and again by parseSavingsQuery, the module the HTTP route and the webview
// RPC use, so every caller gets the same messages.

export function registerSavingsTools(server: McpServer, deps: McpToolDeps, savings: SavingsQueries, guarded: Guard): void {
  server.registerTool(
    "get_savings_report",
    {
      title: "Get the savings report",
      description:
        "Use first to answer \"how can I spend less\": the ranked list of changes that would have cost less over a window (default the last 30 days), the same list as the app's Savings tab. " +
        "Each row has a kind (unused tools, idle cache expiry, unexplained cache break, model switch, failed tool calls), an amount per week and over the window as a range or an upper bound (\"up to\"), priced from the price book and not billed, " +
        "its coverage (sessions analyzed of those in the window, and why the rest were not), the price version ids, up to 10 session ids, each with its start and its own saving over the window (not per week), and a fixed action text; an unknown amount carries its reason, never 0. " +
        "An unused-tools row also lists up to 20 of its tools with estimated definition tokens per request (toolsTotal says how many it has). " +
        "Rows are ranked by the high end; `limit` (default 10, at most 20) cuts the list and opportunitiesTotal says how many there are. " +
        "Cheaper-model rows are replays on another model (Simulated, assuming the same conversation) and run only with includeSimulated true; they are listed apart and never ranked with the others. " +
        "To look into a row, call get_session_cost or replay_session with its session ids.",
      inputSchema: z.object({
        since: dateArg.optional().describe('First day of the window, inclusive: "YYYY-MM-DD". Default: 30 days before until.'),
        until: dateArg.optional().describe('Last day of the window, inclusive: "YYYY-MM-DD". Default: today.'),
        provider: providerArg(deps.identity),
        pricing: pricingModeSchema.optional().describe('How priced figures are priced: "as-of-use" (default: the price in force when each turn ran) or "today".'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SAVINGS_TOOL_OPPORTUNITIES)
          .optional()
          .describe(`How many opportunities to return, best first (default ${DEFAULT_SAVINGS_TOOL_OPPORTUNITIES}, max ${MAX_SAVINGS_TOOL_OPPORTUNITIES}).`),
        includeSimulated: z.boolean().optional().describe("Also run the cheaper-model replays and list them as Simulated (default false: a replay per session is slow)."),
      }),
      outputSchema: savingsToolOutputSchema,
      annotations: READ_ONLY,
    },
    ({ limit, ...query }) =>
      guarded(async () => {
        const parsed = parseSavingsQuery(query);
        if (!parsed.ok) return toolError(parsed.error);
        const { since, until, providerId, pricing, includeSimulated } = parsed.value;
        try {
          const report = await savings.report(
            { ...(providerId !== undefined ? { providerId } : {}), ...(since !== undefined ? { since } : {}), ...(until !== undefined ? { until } : {}) },
            { ...(pricing !== undefined ? { pricing } : {}), includeSimulated },
          );
          const output = savingsToolOutput(report, { limit: limit ?? DEFAULT_SAVINGS_TOOL_OPPORTUNITIES, includeSimulated });
          return { content: [{ type: "text", text: savingsReportText(output) }], structuredContent: output };
        } catch (error) {
          if (error instanceof InvalidSavingsWindowError) return toolError(error.message);
          throw error;
        }
      }),
  );
}
