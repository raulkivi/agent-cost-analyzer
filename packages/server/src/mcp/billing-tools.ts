import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { statementAnswerSchema } from "@agent-cost-analyzer/domain";
import type { StatementQueries } from "../services/billing/statement-service.js";
import { AlreadyIssuedError, PeriodNotEndedError, UnknownStatementPeriodError } from "../services/billing/statement-service.js";
import { json, READ_ONLY, toolError, type Guard } from "./tool-helpers.js";

// Phase 15 step 15.11 (docs/plans/cost-by-repository-and-project.md §10.1.1,
// §10.1.4): billing statements. Read-only: issuing writes a file and stays a
// UI action, so no tool here issues. estimate_cost joins in step 15.12.

export function registerBillingTools(server: McpServer, statements: StatementQueries, guarded: Guard): void {
  server.registerTool(
    "get_statement",
    {
      title: "Get a project's billing statement",
      description:
        "Use to see what one project (id from list_projects) costs for a period: the frozen statement if the period is issued, with the re-run beside it and the exact diff (late logs, a price-book change), else the draft and whether it can be issued (only an ended period can). " +
        "Lines per basis, currency, channel, model and price version with tokens and unit prices; turns with unknown cost listed with their reason, never counted as 0; subscription (API-equivalent) use left off unless the project includes it; the project's markup, fixed lines and own currency at its fixed rate; totals per currency; coverage; provenance (app version, price book, projects file, session ids). " +
        "Months are calendar months in the statement's time zone. This tool never issues a statement: issuing is done in the app.",
      inputSchema: {
        projectId: z.string().min(1).describe("The project id, from list_projects."),
        period: z.string().min(1).describe('A month "YYYY-MM", or a range "YYYY-MM-DD..YYYY-MM-DD".'),
        includeLines: z.boolean().optional().describe("Include the lines (default true); totals, unknown lines and provenance are always there."),
      },
      outputSchema: statementAnswerSchema,
      annotations: READ_ONLY,
    },
    ({ projectId, period, includeLines }) =>
      guarded(async () => {
        try {
          const answer = await statements.get({ projectId, period });
          if (answer === null) return toolError(`Unknown project id "${projectId}". Call list_projects to find valid ids.`);
          if (includeLines !== false) return json(answer);
          const strip = <T extends { lines: unknown[] }>(statement: T): T => ({ ...statement, lines: [] });
          return json({ ...answer, statement: strip(answer.statement), ...(answer.rerun ? { rerun: strip(answer.rerun) } : {}) });
        } catch (error) {
          if (error instanceof UnknownStatementPeriodError || error instanceof PeriodNotEndedError || error instanceof AlreadyIssuedError) return toolError(error.message);
          throw error;
        }
      }),
  );
}
