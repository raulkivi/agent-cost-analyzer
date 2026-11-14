// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MAX_COMPARED_MODELS, sessionReplayComparisonSchema, sessionReplaySchema } from "@agent-cost-analyzer/domain";
import { replayModelArg, replayPricingArg } from "../services/session-replay/replay-query-params.js";
import { TooManyComparedModelsError, type ReplayResult, type SessionReplayQueries } from "../services/session-replay/session-replay-service.js";
import type { McpToolDeps } from "./mcp-server.js";
import { json, providerArg, READ_ONLY, sessionIdArg, toolError, unknownSession, type Guard } from "./tool-helpers.js";

// Phase 14 step 14.5 (docs/plans/analyze-session-replay.md §9, D5, D7): a
// real session replayed on another model, in both products. Read-only:
// a replay is computed on request and never stored. The answers are numbers,
// model ids and turn indexes only (no prompt or response text, no paths),
// labelled simulated; the limits are the HTTP routes' (replay-query-params.ts:
// a model id of at most 100 characters, at most MAX_COMPARED_MODELS models),
// and whether a model is one a vendor profile lists is the service's check.

const SIMULATED_NOTE =
  "Every figure is Simulated, not measured: it assumes the same conversation (A1: the other model gets the same prompts and answers with as many tokens, which it wouldn't) and the same token counts (A2); the answer lists every assumption. Say \"would have cost about\", never \"would have cost\".";

const modelArg = replayModelArg.describe('A model id a vendor profile lists, e.g. "claude-haiku-5.5" or "gpt-6.1-sol" (log spellings such as "claude-opus-5-5-20261001" resolve too).');

const pricingArg = replayPricingArg
  .optional()
  .describe('Which prices the simulated requests are priced at: "session-channel" (default: a Copilot session at Copilot prices in AI Credits, any other at the target vendor\'s API price in USD, as of the session\'s dates), "copilot" or "api".');

const modelsArg = z
  .array(replayModelArg)
  .min(1)
  .max(MAX_COMPARED_MODELS)
  .describe(`1 to ${MAX_COMPARED_MODELS} model ids a vendor profile lists. The session's own model is added first when a profile lists it, and counts toward the ${MAX_COMPARED_MODELS}.`);

// A result the service couldn't give, as a tool error with its reason.
function failure(result: Exclude<ReplayResult<unknown>, { status: "ok" }>, sessionId: string, provider: string | undefined) {
  return result.status === "unknown-session" ? unknownSession(sessionId, provider) : toolError(result.reason);
}

export function registerReplayTools(server: McpServer, deps: McpToolDeps, replays: SessionReplayQueries, guarded: Guard): void {
  server.registerTool(
    "replay_session",
    {
      title: "Replay a session on another model",
      description:
        "Use to see what one session (id from list_sessions) would have cost on another model: the session's own request trace (token counts only) is run through that model's vendor caching rules and priced, turn by turn beside what the session really cost. " +
        `${SIMULATED_NOTE} ` +
        "The self-check (selfCheck) is the same replay on the session's own model compared with its log (cache read within 5%): if it didn't pass, trust the figures less; null when the own model has no vendor profile; models lists every model it ran when the session switched. " +
        "Totals compare like with like (the turns replayed with a known measured and simulated cost); coverage gives the turns and requests not replayed with their reasons, and an unknown figure is null with a reason, never 0. " +
        "A session whose provider's logs can't be replayed yet answers with the reason.",
      inputSchema: z.object({ sessionId: sessionIdArg, model: modelArg, pricing: pricingArg, provider: providerArg(deps.identity) }),
      outputSchema: sessionReplaySchema,
      annotations: READ_ONLY,
    },
    ({ sessionId, model, pricing, provider }) =>
      guarded(async () => {
        const result = await replays.replay({ sessionId, model, ...(pricing ? { pricing } : {}), ...(provider ? { providerId: provider } : {}) });
        return result.status === "ok" ? json(result.value) : failure(result, sessionId, provider);
      }),
  );

  server.registerTool(
    "compare_models_for_session",
    {
      title: "Compare models for a session",
      description:
        "Use to compare what one session (id from list_sessions) would have cost on several models: each model's simulated total and replayed turns beside the session's measured total, in one currency. " +
        `${SIMULATED_NOTE} ` +
        "For the per-turn figures, the coverage reasons and the self-check, call replay_session with one model. A model no vendor profile lists refuses the whole comparison, with the reason. measuredModels lists the models the session used, in order; when it switched models, the first entry (isMixedSessionModel) is the whole session replayed on its first model, not a measured model.",
      inputSchema: z.object({ sessionId: sessionIdArg, models: modelsArg, pricing: pricingArg, provider: providerArg(deps.identity) }),
      outputSchema: sessionReplayComparisonSchema,
      annotations: READ_ONLY,
    },
    ({ sessionId, models, pricing, provider }) =>
      guarded(async () => {
        try {
          const result = await replays.compare({ sessionId, models, ...(pricing ? { pricing } : {}), ...(provider ? { providerId: provider } : {}) });
          return result.status === "ok" ? json(result.value) : failure(result, sessionId, provider);
        } catch (error) {
          if (error instanceof TooManyComparedModelsError) return toolError(error.message);
          throw error;
        }
      }),
  );
}
