import { z } from "zod";
import {
  MAX_COMPARED_MODELS,
  MAX_REPLAY_MODEL_ID_LENGTH,
} from "@agent-cost-analyzer/domain";

// Phase 14 step 14.5 (docs/plans/analyze-session-replay.md §9,
// threat-model.md §4): the replay routes' options, shared by HTTP
// (GET /api/sessions/:id/replay and /replay/compare), the webview RPC and
// the MCP tools, so all three validate the same way and report the same
// messages. Whether a model id is one a vendor profile lists is the
// service's check (its allow-list); this only bounds the input.

// The bound on a model id is the domain's, shared with the RPC schema.
export { MAX_REPLAY_MODEL_ID_LENGTH };

export const replayModelArg = z
  .string()
  .trim()
  .min(1, "a model id is required")
  .max(MAX_REPLAY_MODEL_ID_LENGTH);

// D2: the session's own channel by default, or Copilot's or the API's.
export const replayPricingArg = z.enum(["session-channel", "copilot", "api"]);

const distinct = (ids: readonly string[]) => [...new Set(ids)];

// The models to compare: blanks dropped, repeats removed, then capped
// (the session's own model is added by the service, which checks the cap
// again with it).
export const replayModelsArg = z
  .array(z.string())
  .transform((ids) => distinct(ids.map((id) => id.trim()).filter(Boolean)))
  .pipe(
    z
      .array(z.string().max(MAX_REPLAY_MODEL_ID_LENGTH))
      .min(1, "at least one model id is required")
      .max(
        MAX_COMPARED_MODELS,
        `at most ${MAX_COMPARED_MODELS} models can be compared`,
      ),
  );

const providerIdArg = z.string().min(1);

export const replayQuerySchema = z.object({
  providerId: providerIdArg.optional(),
  model: replayModelArg,
  pricing: replayPricingArg.optional(),
});

export const compareQuerySchema = z.object({
  providerId: providerIdArg.optional(),
  models: replayModelsArg,
  pricing: replayPricingArg.optional(),
});

export type ReplayQuery = z.infer<typeof replayQuerySchema>;
export type CompareQuery = z.infer<typeof compareQuerySchema>;

export type ReplayParseResult<T> =
  { ok: true; value: T } | { ok: false; error: string };

type Query = Readonly<Record<string, unknown>>;

// Query-string or MCP-argument shaped input → the request's fields:
// `provider` (HTTP) or `providerId` (MCP); `models` comma-separated (HTTP)
// or an array (RPC, MCP). Empty strings count as absent.
function fieldsOf(query: Query, listName?: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    const field = name === "provider" ? "providerId" : name;
    fields[field] =
      name === listName && typeof value === "string" ? value.split(",") : value;
  }
  return fields;
}

function toResult<T>(parsed: z.ZodSafeParseResult<T>): ReplayParseResult<T> {
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: parsed.error.issues
          .map(
            (issue) => `${issue.path.join(".") || "query"}: ${issue.message}`,
          )
          .join("; "),
      };
}

export function parseReplayQuery(query: Query): ReplayParseResult<ReplayQuery> {
  return toResult(replayQuerySchema.safeParse(fieldsOf(query)));
}

export function parseCompareQuery(
  query: Query,
): ReplayParseResult<CompareQuery> {
  return toResult(compareQuerySchema.safeParse(fieldsOf(query, "models")));
}
