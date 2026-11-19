// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./api-request-error.js";
import { fetchMcpSetup } from "./mcp-setup.js";

const answer = { version: "1.1.0", clients: [] };

afterEach(() => vi.unstubAllGlobals());

describe("fetchMcpSetup", () => {
  it("reads GET /api/mcp/setup", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer)));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(fetchMcpSetup(signal)).resolves.toEqual(answer);

    expect(fetchMock).toHaveBeenCalledWith("/api/mcp/setup", { signal });
  });

  it("rejects with the status and the server's message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Host not allowed." }), { status: 403 })));

    const error = await fetchMcpSetup().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 403, detail: "Host not allowed." });
  });

  it("rejects when the body is not a setup answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ nope: true }))));

    await expect(fetchMcpSetup()).rejects.toThrow(/setup/i);
  });
});
