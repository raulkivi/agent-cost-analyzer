// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { priceBookListingSchema, priceChangeListSchema } from "@agent-cost-analyzer/domain";
import type { CostAnalysisQueries } from "../services/cost-analysis/cost-analysis-service.js";
import { costDateArg, priceChangeKindArg } from "../services/cost-analysis/cost-query-params.js";
import type { PriceBookReader } from "../services/pricing/price-book.js";
import { isoDateBoundSchema } from "../services/tool-audit/audit-query-params.js";
import { json, READ_ONLY, type Guard } from "./tool-helpers.js";

// Phase 15 step 15.5 (docs/plans/cost-by-repository-and-project.md §10.1):
// the price book the priced cost figures depend on. Step 15.10:
// get_price_changes, with the cost analyses (observed changes read turns).

export function registerPricingTools(server: McpServer, priceBook: PriceBookReader, guarded: Guard, analysis?: CostAnalysisQueries): void {
  server.registerTool(
    "get_price_book",
    {
      title: "Get the price book",
      description:
        'Use to see which per-token prices the analyzer prices tokens with: each price version of a model on a channel ("github-copilot", "anthropic-api", ... or a user channel), its USD tiers per 1M tokens, the dates it is in force ([effectiveFrom, effectiveTo), UTC), its kind (list, promo, or the user\'s contract) and its cited sources with checkedAt. Default: every version on every channel. With `at`, only the versions in force then. A channel or model with no price is listed under `unknown` with the reason; it is unknown, never zero. Gaps between versions are listed under `gaps`, and user versions left out of the book under `problems`.',
      inputSchema: {
        channel: z.string().min(1).optional().describe('Only this channel, e.g. "github-copilot".'),
        model: z.string().min(1).optional().describe('Only this model, by its price-table id, e.g. "claude-sonnet-5.5".'),
        at: isoDateBoundSchema.optional().describe('Only the versions in force at this time: "YYYY-MM-DD" (UTC midnight) or an ISO timestamp.'),
      },
      outputSchema: priceBookListingSchema,
      annotations: READ_ONLY,
    },
    ({ channel, model, at }) => guarded(async () => json(priceBook.list({ channel, model, at }))),
  );

  if (!analysis) return;
  server.registerTool(
    "get_price_changes",
    {
      title: "Get price changes",
      description:
        "Use to see when a model's price changed. Two kinds, kept apart: documented (a boundary between two price-book versions: date, old and new USD per 1M tokens per token type, percentage, and the cited sources) and observed (GitHub Copilot only: billed AI Credits more than 5% above or below the price book for the same turns, the same way, 2 ISO weeks in a row with at least 20 such turns each; confidence \"inferred\", with the weeks as evidence: a prompt to check the price book, not a price). " +
        "Oldest first. Observed changes read the sessions of every available provider (or one, with `provider`); documented ones read only the price book.",
      inputSchema: {
        since: costDateArg.optional().describe('Changes from this day, inclusive: "YYYY-MM-DD" (UTC).'),
        until: costDateArg.optional().describe('Changes up to this day, inclusive: "YYYY-MM-DD" (UTC).'),
        channel: z.string().min(1).optional().describe('Only this channel, e.g. "github-copilot".'),
        model: z.string().min(1).optional().describe("Only this model: a price-table id for documented changes, the logged model for observed ones."),
        kind: priceChangeKindArg.optional().describe('"documented" or "observed"; default both.'),
        provider: z.string().min(1).optional().describe("Restrict observed changes to one log provider id (see list_log_providers)."),
      },
      outputSchema: priceChangeListSchema,
      annotations: READ_ONLY,
    },
    ({ provider, ...args }) => guarded(async () => json(await analysis.getPriceChanges({ ...args, ...(provider !== undefined ? { providerId: provider } : {}) }))),
  );
}
