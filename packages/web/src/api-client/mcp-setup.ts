// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpSetupResponse } from "../lib/mcp-setup/types.js";
import { ApiRequestError } from "./api-request-error.js";

// GET /api/mcp/setup (mcp-client-setup.md §5.6): read-only, standalone app
// only. It reads the route directly because the route has no ApiMethod yet;
// once MC11 adds the schema to packages/domain this goes through the
// transport and parses with the schema, like the other endpoints.
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

function isSetupResponse(body: unknown): body is McpSetupResponse {
  if (typeof body !== "object" || body === null) return false;
  const { version, clients } = body as Partial<McpSetupResponse>;
  return typeof version === "string" && Array.isArray(clients);
}

export async function fetchMcpSetup(signal?: AbortSignal): Promise<McpSetupResponse> {
  const response = await (signal ? fetch(URL_PATH, { signal }) : fetch(URL_PATH));
  if (!response.ok) throw new ApiRequestError(URL_PATH, response.status, await errorMessageOf(response));
  const body: unknown = await response.json();
  if (!isSetupResponse(body)) throw new Error("The MCP setup answer was not in the expected shape.");
  return body;
}
