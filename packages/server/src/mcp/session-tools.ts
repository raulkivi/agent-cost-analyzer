import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logProviderStatusSchema, turnViewSchema } from "@copilot-cost-analyzer/domain";
import { DEFAULT_MAX_TEXT_CHARS } from "../services/session-view/turn-view-builder.js";
import { limitSchema, turnIndexSchema } from "../services/tool-audit/audit-query-params.js";
import type { McpServerDeps } from "./mcp-server.js";
import { json, providerArg, READ_ONLY, sessionIdArg, sinceArg, toolError, unknownSession, untilArg, type Guard } from "./tool-helpers.js";

const DEFAULT_SESSION_LIST_LIMIT = 20;

const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  startedAt: z.string().optional(),
  turnCount: z.number(),
  model: z.string(),
  providerId: z.string().optional(),
});

export function registerSessionTools(server: McpServer, deps: McpServerDeps, guarded: Guard): void {
  server.registerTool(
    "list_log_providers",
    {
      title: "List log providers",
      description:
        "Lists the local agent-log sources (VS Code Copilot Chat, Claude Code CLI, pi, mitmproxy captures), whether each is available and why not, and which one is active. Use it to pick a `provider` argument or to explain why a source has no sessions.",
      outputSchema: logProviderStatusSchema,
      annotations: READ_ONLY,
    },
    () => guarded(async () => json(await deps.getProviderStatus())),
  );

  server.registerTool(
    "list_sessions",
    {
      title: "List sessions",
      description:
        "Finds agent sessions of one provider, most recent first: start here to get the session ids every other per-session tool needs. Filter by a title/id substring and a start-date window. `total` is the number of matches before `limit`, so you can tell whether to narrow the search.",
      inputSchema: {
        provider: providerArg,
        query: z.string().min(1).optional().describe("Case-insensitive substring of the session title or id."),
        since: sinceArg,
        until: untilArg,
        limit: limitSchema.optional().describe(`Maximum sessions to return (default ${DEFAULT_SESSION_LIST_LIMIT}).`),
      },
      outputSchema: z.object({ total: z.number(), sessions: z.array(sessionSummarySchema) }),
      annotations: READ_ONLY,
    },
    ({ provider, query, since, until, limit }) =>
      guarded(async () => {
        const matches = await deps.auditQueries.listSessions({ providerId: provider, query, since, until });
        return json({
          total: matches.length,
          sessions: matches.slice(0, limit ?? DEFAULT_SESSION_LIST_LIMIT).map((session) => ({
            id: session.id,
            title: session.title,
            ...(session.startedAt ? { startedAt: session.startedAt } : {}),
            turnCount: session.turnCount,
            model: session.model,
            ...(session.providerId ? { providerId: session.providerId } : {}),
          })),
        });
      }),
  );

  server.registerTool(
    "get_turn",
    {
      title: "Get one turn",
      description:
        "Reads one turn of a session: the user prompt and assistant response (secrets redacted, truncated to maxTextChars), its token usage and AI Credits, any triggered event (compaction, model switch, cache expiry, ...) and its tool calls with outcomes. Use it to explain why a turn found by get_session_cost or list_tool_calls was expensive or failed.",
      inputSchema: {
        sessionId: sessionIdArg,
        turnIndex: turnIndexSchema.describe("0-based turn index, e.g. from get_session_cost's topTurns or list_tool_calls."),
        provider: providerArg,
        maxTextChars: z
          .number()
          .int()
          .min(200)
          .max(20_000)
          .optional()
          .describe(`Maximum characters per text field (default ${DEFAULT_MAX_TEXT_CHARS}).`),
      },
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
