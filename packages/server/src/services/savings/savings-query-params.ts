// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { pricingModeSchema } from "@agent-cost-analyzer/domain";

// Phase 16 SR12 (docs/plans/savings-report.md §5.3, threat-model §11): the
// savings routes' options, shared by HTTP (GET /api/savings), the webview
// RPC and, with SR16, the MCP tool, so all validate the same way and report
// the same messages. There is deliberately no `limit`: the session cap is
// the service's (MAX_ROLLUP_SESSION_LIMIT) and no caller can raise it;
// unknown fields are dropped.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(date: string): boolean {
  const time = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === date;
}

const dateArg = z
  .string()
  .regex(DATE, "must be a calendar date (YYYY-MM-DD)")
  .refine((date) => !DATE.test(date) || isCalendarDate(date), "must be a calendar date (YYYY-MM-DD)");

// "true"/"false" from a query string, or a real boolean from the RPC and MCP.
const flagArg = z.union([z.boolean(), z.enum(["true", "false"]).transform((text) => text === "true")]);

export const savingsQuerySchema = z.object({
  since: dateArg.optional(),
  until: dateArg.optional(),
  providerId: z.string().min(1).optional(),
  pricing: pricingModeSchema.optional(),
  // D5: the cheaper-model replays run only when asked.
  includeSimulated: flagArg.default(false),
});

export type SavingsQuery = z.infer<typeof savingsQuerySchema>;

export type SavingsParseResult = { ok: true; value: SavingsQuery } | { ok: false; error: string };

// Query-string or MCP-argument shaped input: `provider` (HTTP) or
// `providerId` (MCP); empty strings count as absent.
export function parseSavingsQuery(query: Readonly<Record<string, unknown>>): SavingsParseResult {
  const fields: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    fields[name === "provider" ? "providerId" : name] = value;
  }
  const parsed = savingsQuerySchema.safeParse(fields);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "query"}: ${issue.message}`).join("; ") };
}
