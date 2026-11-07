// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import {
  comparePeriodSchema,
  costBasisChoiceSchema,
  costBucketSchema,
  costCompareGroupBySchema,
  costCurrencyChoiceSchema,
  costSeriesGroupBySchema,
  isoCalendarDateSchema,
  pricingModeSchema,
} from "@agent-cost-analyzer/domain";
import { limitSchema } from "../tool-audit/audit-query-params.js";
import { MAX_ROLLUP_SESSION_LIMIT } from "../tool-audit/audit-query-service.js";

// Phase 15 step 15.7 (docs/plans/cost-by-repository-and-project.md §10,
// §10.1.4): the options of the cost analyses. The MCP tools' argument
// schemas (mcp/tool-helpers.ts) are these same schemas with descriptions,
// so HTTP and MCP validate the same way.

export const MAX_COST_IDS = 20;

export const costDateArg = isoCalendarDateSchema;
export const costBucketArg = costBucketSchema;
export const costBasisArg = costBasisChoiceSchema;
export const costPricingArg = pricingModeSchema;
export const costCurrencyArg = costCurrencyChoiceSchema;
export const comparePeriodArg = comparePeriodSchema;
export const costIdSchema = z.string().min(1).max(2048);

const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;

const viewShape = {
  providerId: z.string().min(1).optional(),
  limit: limitSchema.max(MAX_ROLLUP_SESSION_LIMIT).optional(),
  basis: costBasisArg.default("preferred"),
  pricing: costPricingArg.default("as-of-use"),
  currency: costCurrencyArg.default("native"),
};

const ordered = (value: { since?: string; until?: string }) => value.since === undefined || value.until === undefined || value.since <= value.until;
const ORDER_MESSAGE = { message: "since must not be after until", path: ["since"] };

export const costSeriesRequestSchema = z
  .object({
    ...viewShape,
    since: costDateArg.optional(),
    until: costDateArg.optional(),
    bucket: costBucketArg.default("month"),
    groupBy: costSeriesGroupBySchema.optional(),
    ids: z.array(costIdSchema).min(1).max(MAX_COST_IDS).refine(unique, "ids must not repeat").optional(),
  })
  .refine(ordered, ORDER_MESSAGE)
  .refine((value) => value.ids === undefined || value.groupBy !== undefined, { message: "ids need a groupBy", path: ["ids"] });

export const costCompareRequestSchema = z
  .object({
    ...viewShape,
    groupBy: costCompareGroupBySchema,
    ids: z.array(costIdSchema).min(2).max(MAX_COST_IDS).refine(unique, "ids must not repeat"),
    since: costDateArg,
    until: costDateArg,
    comparePeriod: comparePeriodArg.default("previous"),
  })
  .refine(ordered, ORDER_MESSAGE);

export type CostSeriesRequest = z.infer<typeof costSeriesRequestSchema>;
export type CostCompareRequest = z.infer<typeof costCompareRequestSchema>;

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
type Query = Readonly<Record<string, unknown>>;

const PARAMS: Readonly<Record<string, string>> = { provider: "providerId" };
const LISTS = new Set(["ids"]);
const INTEGERS = new Set(["limit"]);

// Query strings → the request's fields: a repeated parameter (an array) is
// passed on as-is so the schema rejects it; ids are comma-separated.
function fromQuery(query: Query, names: readonly string[]): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const name of names) {
    const value = query[name];
    if (value === undefined || value === "") continue;
    const field = PARAMS[name] ?? name;
    if (typeof value !== "string") fields[field] = value;
    else if (LISTS.has(name)) fields[field] = value.split(",").map((item) => item.trim()).filter(Boolean);
    else if (INTEGERS.has(name)) fields[field] = /^\d+$/.test(value) ? Number(value) : value;
    else fields[field] = value;
  }
  return fields;
}

function toResult<T>(parsed: z.ZodSafeParseResult<T>): ParseResult<T> {
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "query"}: ${issue.message}`).join("; ") };
}

const SERIES_PARAMS = ["provider", "limit", "since", "until", "bucket", "basis", "pricing", "currency", "groupBy", "ids"];
const COMPARE_PARAMS = ["provider", "limit", "since", "until", "basis", "pricing", "currency", "groupBy", "ids", "comparePeriod"];

export function parseCostSeriesQuery(query: Query): ParseResult<CostSeriesRequest> {
  return toResult(costSeriesRequestSchema.safeParse(fromQuery(query, SERIES_PARAMS)));
}

export function parseCostCompareQuery(query: Query): ParseResult<CostCompareRequest> {
  return toResult(costCompareRequestSchema.safeParse(fromQuery(query, COMPARE_PARAMS)));
}
