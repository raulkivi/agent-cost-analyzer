// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpServer } from "@modelcontextprotocol/server";
import { monthlyAllowanceAnswerSchema } from "@agent-cost-analyzer/domain";
import type { MonthlyAllowanceQueries } from "../services/monthly-allowance/monthly-allowance-service.js";
import { monthlyAllowanceText } from "./allowance-tool-output.js";
import { READ_ONLY, type Guard } from "./tool-helpers.js";

// MS9 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/monthly-allowance-standalone.md §6, D7): the monthly allowance for the
// model, standalone only. Read-only and without arguments: the allowance is
// the user's own number, set in the app, and the answer is the one
// GET /api/monthly-allowance gives (the same service).

export function registerAllowanceTools(server: McpServer, allowance: Pick<MonthlyAllowanceQueries, "get">, guarded: Guard): void {
  server.registerTool(
    "get_monthly_allowance",
    {
      title: "Get the monthly AI Credits allowance",
      description:
        "Use to answer \"how much of my monthly allowance is left?\": the AI Credits used so far in the current billing period against the allowance the user set in the app, the same answer as the app's header. " +
        "The allowance is the user's own number, not a plan lookup. " +
        "Figures are billed AI Credits of the VS Code Copilot sessions on this machine, whichever provider is active; Claude Code and pi sessions are not counted. " +
        "Sessions without cost data are left out, so when some are missing the total is a lower bound (atLeast true, \"at least\") and remaining is an upper bound (\"up to\"); coverage says how many sessions have cost data. " +
        "Unknown is never 0: with no cost data at all there is no used figure, only the session counts. " +
        "state says which case it is (not-set, no-source, no-sessions, unknown, known). There is no projection or run rate. " +
        "It cannot change the allowance.",
      outputSchema: monthlyAllowanceAnswerSchema,
      annotations: READ_ONLY,
    },
    () =>
      guarded(async () => {
        const answer = await allowance.get();
        return { content: [{ type: "text", text: monthlyAllowanceText(answer) }], structuredContent: answer };
      }),
  );
}
