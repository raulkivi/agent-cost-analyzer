import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { LogProviderStatus } from "@copilot-cost-analyzer/domain";
import { UnknownLogProviderIdError } from "../data-sources/log-providers/registry.js";
import { isoDateBoundSchema, limitSchema } from "../services/tool-audit/audit-query-params.js";

// Shared building blocks for the MCP tool groups (docs/plans/mcp-tools-v2.md
// §3/§5): result envelopes, actionable errors, and argument schemas reused
// across tools so every tool describes the same argument the same way.

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const MAX_ROLLUP_SESSIONS = 500;

export const providerArg = z
  .string()
  .optional()
  .describe(
    'Log provider id, e.g. "claude-code", "vscode", "pi-agent", "mitmproxy" (see list_log_providers). Defaults to the provider active in the web app.',
  );

export const sessionIdArg = z.string().min(1).describe("Session id from list_sessions.");

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
