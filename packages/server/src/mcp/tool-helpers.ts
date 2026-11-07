// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { LogProviderStatus } from "@agent-cost-analyzer/domain";
import { UnknownLogProviderIdError } from "../data-sources/log-providers/registry.js";
import type { McpIdentity } from "./mcp-identity.js";
import { isoDateBoundSchema, limitSchema } from "../services/tool-audit/audit-query-params.js";
import {
  comparePeriodArg as comparePeriodSchema,
  costBasisArg,
  costBucketArg,
  costCurrencyArg,
  costDateArg,
  costIdSchema,
  costPricingArg,
  MAX_COST_IDS,
} from "../services/cost-analysis/cost-query-params.js";

// Shared building blocks for the MCP tool groups (docs/plans/mcp-tools-v2.md
// §3/§5): result envelopes, actionable errors, and argument schemas reused
// across tools so every tool describes the same argument the same way.

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const MAX_ROLLUP_SESSIONS = 500;

// The one argument whose wording names log sources, so it follows the
// product's identity (mcp-identity.ts).
export function providerArg(identity: McpIdentity) {
  return z.string().optional().describe(identity.providerArgDescription);
}

export const sessionIdArg = z.string().min(1).describe("Session id from list_sessions.");

// Phase 15 step 15.4 (plan §10.1.4): a repository key as list_repositories
// returns it, and a project id from list_projects.
export const repositoryArg = z
  .string()
  .min(1)
  .max(2048)
  .describe("Repository key from list_repositories, e.g. github.com/org/app or local:<folder name>.");

export const projectIdArg = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
  .describe("Project id from list_projects.");

export const sinceArg = isoDateBoundSchema
  .optional()
  .describe('Earliest session start, inclusive: "YYYY-MM-DD" or an ISO timestamp.');

export const untilArg = isoDateBoundSchema
  .optional()
  .describe('Latest session start, inclusive: "YYYY-MM-DD" or an ISO timestamp.');

export function sessionsPerProviderArg(defaultLimit: number) {
  return limitSchema
    .max(MAX_ROLLUP_SESSIONS)
    .optional()
    .describe(`How many of the most recent sessions to read per provider (default ${defaultLimit}, max ${MAX_ROLLUP_SESSIONS}).`);
}

export function json(value: object): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function unknownSession(sessionId: string, provider: string | undefined): CallToolResult {
  const scope = provider ? `provider "${provider}"` : "the active provider";
  return toolError(
    `Unknown session id "${sessionId}" for ${scope}. Call list_sessions${provider ? ` with provider "${provider}"` : ""} to find valid ids.`,
  );
}

export type Guard = (run: () => Promise<CallToolResult>) => Promise<CallToolResult>;

// Turns any thrown error into a tool error the model can act on; an unknown
// provider id lists the valid ones.
export function createGuard(getProviderStatus: () => Promise<LogProviderStatus>): Guard {
  return async (run) => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof UnknownLogProviderIdError) {
        const known = await getProviderStatus()
          .then((status) => status.providers.map((provider) => provider.id).join(", "))
          .catch(() => "");
        return toolError(`${error.message}.${known ? ` Known providers: ${known}.` : ""} Call list_log_providers for availability.`);
      }
      return toolError((error as Error).message);
    }
  };
}

// Phase 15 step 15.7 (plan §10.1.4): the cost analyses' options, the same
// schemas GET /api/cost/timeseries and /api/cost/compare parse their
// query parameters with (services/cost-analysis/cost-query-params.ts).
export const bucketArg = costBucketArg.optional().describe('Bucket size: "day", "week" (ISO weeks) or "month" (default), in UTC.');

export const basisArg = costBasisArg
  .optional()
  .describe('Which cost basis the figures use: "preferred" (default: billed, else reported, else priced per turn), or only "billed", "reported" or "priced".');

export const pricingArg = costPricingArg
  .optional()
  .describe('How priced figures are priced: "as-of-use" (default: the price in force when each turn ran) or "today" (every turn at today\'s prices, for comparing and estimating).');

export const currencyArg = costCurrencyArg
  .optional()
  .describe('"native" (default): each figure in its own unit (AI Credits or USD), totals per currency. "usd": everything in USD at 1 AI Credit = $0.01, the only conversion used.');

export const costSinceArg = costDateArg.optional().describe('First day, inclusive: "YYYY-MM-DD" (UTC). Sessions started earlier are not read.');
export const costUntilArg = costDateArg.optional().describe('Last day, inclusive: "YYYY-MM-DD" (UTC).');

export const comparePeriodArg = comparePeriodSchema
  .optional()
  .describe('What the change is measured against: "previous" (default: the same number of days just before) or "last-year" (the same dates a year earlier).');

export const costIdsArg = z
  .array(costIdSchema)
  .min(2)
  .max(MAX_COST_IDS)
  .describe(`The ${2} to ${MAX_COST_IDS} repository keys (from list_repositories) or project ids (from list_projects) to compare.`);
