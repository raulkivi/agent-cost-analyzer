// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpServer } from "@modelcontextprotocol/server";
import { COST_BASIS_TEXT } from "./cost-tools.js";
import { z } from "zod";
import { copilotHarnessSchema, logProviderStatusSchema, turnViewSchema } from "@agent-cost-analyzer/domain";
import { DEFAULT_MAX_TEXT_CHARS } from "../services/session-view/turn-view-builder.js";
import { limitSchema, turnIndexSchema } from "../services/tool-audit/audit-query-params.js";
import type { McpToolDeps } from "./mcp-server.js";
import { keyMatches } from "../services/cost-attribution/repository-key-privacy.js";
import {
  json,
  projectIdArg,
  providerArg,
  READ_ONLY,
  repositoryArg,
  sessionIdArg,
  sinceArg,
  toolError,
  unknownSession,
  untilArg,
  type Guard,
} from "./tool-helpers.js";

const DEFAULT_SESSION_LIST_LIMIT = 20;

const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  startedAt: z.string().optional(),
  turnCount: z.number(),
  model: z.string(),
  providerId: z.string().optional(),
  copilotHarness: copilotHarnessSchema.optional(),
});

// Step 15.4: with attribution, each session also names its repository (the
// redacted key list_repositories returns; null with the reason when
// Unattributed) and its project (null: none).
const attributedSessionSummarySchema = sessionSummarySchema.extend({
  repositoryKey: z.string().nullable(),
  unattributedReason: z.string().optional(),
  projectId: z.string().nullable(),
});

export function registerSessionTools(server: McpServer, deps: McpToolDeps, guarded: Guard): void {
  server.registerTool(
    "list_log_providers",
    {
      title: "List log providers",
      description: `Lists the local agent-log sources (${deps.identity.logSourcesDescription}), whether each is available and why not, and which one is active. Use it to pick a \`provider\` argument or to explain why a source has no sessions.`,
      outputSchema: logProviderStatusSchema,
      annotations: READ_ONLY,
    },
    () => guarded(async () => json(await deps.getProviderStatus())),
  );

  const { attribution } = deps;
  const baseInput = {
    provider: providerArg(deps.identity),
    query: z.string().min(1).optional().describe("Case-insensitive substring of the session title or id."),
    since: sinceArg,
    until: untilArg,
    limit: limitSchema.optional().describe(`Maximum sessions to return (default ${DEFAULT_SESSION_LIST_LIMIT}).`),
  };
  const attributionInput = {
    repository: repositoryArg.optional().describe("Only sessions in this repository (a key from list_repositories)."),
    projectId: projectIdArg.optional().describe("Only sessions in this project (an id from list_projects)."),
  };
  server.registerTool(
    "list_sessions",
    {
      title: "List sessions",
      description: attribution
        ? "Finds agent sessions of one provider, most recent first: start here to get the session ids every other per-session tool needs. Filter by a title/id substring, a start-date window, a repository and a project; each session names its repository key (null with unattributedReason when it has none) and project. `total` is the number of matches before `limit`, so you can tell whether to narrow the search."
        : "Finds agent sessions of one provider, most recent first: start here to get the session ids every other per-session tool needs. Filter by a title/id substring and a start-date window. `total` is the number of matches before `limit`, so you can tell whether to narrow the search.",
      inputSchema: z.object(attribution ? { ...baseInput, ...attributionInput } : baseInput),
      outputSchema: z.object({ total: z.number(), sessions: z.array(attribution ? attributedSessionSummarySchema : sessionSummarySchema) }),
      annotations: READ_ONLY,
    },
    (args: { provider?: string; query?: string; since?: string; until?: string; limit?: number; repository?: string; projectId?: string }) =>
      guarded(async () => {
        const { provider, query, since, until, limit, repository, projectId } = args;
        const listed = await deps.auditQueries.listSessions({ providerId: provider, query, since, until });
        const attribute = attribution?.sessionAttributions();
        const matches = listed
          .map((session) => ({ session, attributed: attribute?.(session) }))
          .filter(
            ({ attributed }) =>
              (repository === undefined || (attributed?.fullKey != null && keyMatches(attributed.fullKey, repository))) &&
              (projectId === undefined || attributed?.projectId === projectId),
          );
        return json({
          total: matches.length,
          sessions: matches.slice(0, limit ?? DEFAULT_SESSION_LIST_LIMIT).map(({ session, attributed }) => ({
            id: session.id,
            title: session.title,
            ...(session.startedAt ? { startedAt: session.startedAt } : {}),
            turnCount: session.turnCount,
            model: session.model,
            ...(session.providerId ? { providerId: session.providerId } : {}),
            ...(session.copilotHarness ? { copilotHarness: session.copilotHarness } : {}),
            ...(attributed
              ? {
                  repositoryKey: attributed.repositoryKey,
                  ...(attributed.unattributedReason ? { unattributedReason: attributed.unattributedReason } : {}),
                  projectId: attributed.projectId,
                }
              : {}),
          })),
        });
      }),
  );

  server.registerTool(
    "get_turn",
    {
      title: "Get one turn",
      description:
        "Reads one turn of a session: the user prompt and assistant response (secrets redacted, truncated to maxTextChars), its token usage and AI Credits, any triggered event (compaction, model switch, cache expiry, ...) and its tool calls with outcomes. The text and tool calls are unknown, with a reason, for a VS Code Agent Host turn whose Copilot CLI event log is missing, unreadable or has no match. Use it to explain why a turn found by get_session_cost or list_tool_calls was expensive or failed. `cost` gives the turn's billed, reported and priced figures (the priced one names its price version) and `preferredCost` the one totals use. " +
        COST_BASIS_TEXT,
      inputSchema: z.object({
        sessionId: sessionIdArg,
        turnIndex: turnIndexSchema.describe("0-based turn index, e.g. from get_session_cost's topTurns or list_tool_calls."),
        provider: providerArg(deps.identity),
        maxTextChars: z
          .number()
          .int()
          .min(200)
          .max(20_000)
          .optional()
          .describe(`Maximum characters per text field (default ${DEFAULT_MAX_TEXT_CHARS}).`),
      }),
      outputSchema: turnViewSchema,
      annotations: READ_ONLY,
    },
    ({ sessionId, turnIndex, provider, maxTextChars }) =>
      guarded(async () => {
        const result = await deps.analysisQueries.getTurn(sessionId, turnIndex, provider, { maxTextChars });
        if (result.status === "unknown-session") {
          return unknownSession(sessionId, provider);
        }
        if (result.status === "unknown-turn") {
          const range = result.turnCount > 0 ? `valid turn indexes are 0..${result.turnCount - 1}` : "it has no turns";
          return toolError(`Session "${sessionId}" has ${result.turnCount} turn(s); ${range}.`);
        }
        return json(result.view);
      }),
  );
}
