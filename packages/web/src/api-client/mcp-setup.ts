// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mcpSetupResponseSchema, type McpSetupResponse } from "@agent-cost-analyzer/domain";
import { ApiRequestError } from "./api-request-error.js";

// GET /api/mcp/setup (mcp-client-setup.md §5.6): read-only, standalone app
// only, so it reads the route directly: the extension host has no such route
// and the domain's ApiMethod registry (which its allow-list shares) stays
// without it.
const URL_PATH = "/api/mcp/setup";

async function errorMessageOf(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    const message = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
    return typeof message === "string" && message.length > 0 ? message : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchMcpSetup(signal?: AbortSignal): Promise<McpSetupResponse> {
  const response = await (signal ? fetch(URL_PATH, { signal }) : fetch(URL_PATH));
  if (!response.ok) throw new ApiRequestError(URL_PATH, response.status, await errorMessageOf(response));
  // A server that drifts fails here, not as a half-drawn panel.
  return mcpSetupResponseSchema.parse(await response.json());
}
