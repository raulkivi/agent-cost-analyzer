// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { priceBookListingSchema } from "@agent-cost-analyzer/domain";
import type { PriceBookReader } from "../services/pricing/price-book.js";
import { isoDateBoundSchema } from "../services/tool-audit/audit-query-params.js";
import { json, READ_ONLY, type Guard } from "./tool-helpers.js";

// Phase 15 step 15.5 (docs/plans/cost-by-repository-and-project.md §10.1):
// the price book the priced cost figures depend on. get_price_changes joins
// this group in step 15.10.

export function registerPricingTools(server: McpServer, priceBook: PriceBookReader, guarded: Guard): void {
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
}
