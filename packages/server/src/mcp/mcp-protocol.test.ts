// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { composeCostFixture, connectCostFixture } from "../test-support/cost-analysis-fixture.js";
import { InMemoryViewSource } from "./apps/view-source.js";
import { createMcpServer, MAX_TOOL_INPUT_ELEMENTS, type McpServerDeps } from "./mcp-server.js";

// docs/plans/mcp-sdk-2-migration.md M2: the protocol behaviour the move to
// MCP SDK 2 changes or adds, beyond the tool list (tool-list-contract.test.ts)
// and the stdio entry (stdio.test.ts).

const appViews = { source: new InMemoryViewSource('<!doctype html><html><head><meta name="aca-brand" content=""></head><body>views</body></html>') };
const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const INVALID_PARAMS = -32602;

describe("MCP protocol behaviour on SDK 2", () => {
  let client: Client | undefined;
  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  // D2: SDK 2 answers a call to a tool the server doesn't have with a
  // JSON-RPC error instead of an isError result.
  it.each([
    ["a tool no product has", "no_such_tool", {}],
    ["the app-only tool, when the server has no views", "get_turn_series", { sessionId: "cp-1" }],
  ])("answers a call to %s with JSON-RPC error -32602", async (_label, name, args) => {
    ({ client } = await connectCostFixture());

    await expect(client.callTool({ name, arguments: args })).rejects.toMatchObject({ code: INVALID_PARAMS });
  });

  it("still answers an unknown argument value with an isError result the model can act on", async () => {
    ({ client } = await connectCostFixture());

    const result = await client.callTool({ name: "list_tool_calls", arguments: { sessionId: "cp-1", status: ["bogus"] } });

    expect(result.isError).toBe(true);
  });

  it("advertises every input and output schema in JSON Schema 2020-12", async () => {
    ({ client } = await connectCostFixture({ appViews }));
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect((tool.inputSchema as { $schema?: string }).$schema ?? JSON_SCHEMA_2020_12, tool.name).toBe(JSON_SCHEMA_2020_12);
      expect((tool.outputSchema as { $schema?: string } | undefined)?.$schema ?? JSON_SCHEMA_2020_12, tool.name).toBe(JSON_SCHEMA_2020_12);
    }
  });
});

// The most array elements and object members a legitimate call to a tool
// can send: every property given, an array at its maxItems, or, for an
// array of an enum without one, every enum value once. An unbounded array
// of anything else has no legitimate maximum, so it fails the test and
// asks for a decision.
function maxLegitimateElements(schema: Record<string, unknown>, where: string): number {
  const options = (schema.anyOf ?? schema.oneOf) as Record<string, unknown>[] | undefined;
  if (options) return Math.max(...options.map((option) => maxLegitimateElements(option, where)));
  if (schema.type === "object") {
    return Object.entries((schema.properties ?? {}) as Record<string, Record<string, unknown>>).reduce(
      (sum, [key, property]) => sum + 1 + maxLegitimateElements(property, `${where}.${key}`),
      0,
    );
  }
  if (schema.type === "array") {
    const items = (schema.items ?? {}) as Record<string, unknown>;
    const length = (schema.maxItems as number | undefined) ?? (items.enum as unknown[] | undefined)?.length;
    if (length === undefined) throw new Error(`${where} is an unbounded array`);
    return length * (1 + maxLegitimateElements(items, `${where}[]`));
  }
  return 0;
}

// SDK 2.3.0's maxToolInputElements: a cheap guard on a tools/call's
// arguments before they are validated or the tool runs.
describe("maxToolInputElements", () => {
  let client: Client | undefined;
  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it("is at least four times the largest legitimate argument of any tool, and still a few hundred at most", async () => {
    ({ client } = await connectCostFixture({ appViews }));
    const { tools } = await client.listTools();

    const largest = Math.max(...tools.map((tool) => maxLegitimateElements(tool.inputSchema as Record<string, unknown>, tool.name)));

    expect(MAX_TOOL_INPUT_ELEMENTS).toBe(256);
    expect(largest * 4).toBeLessThanOrEqual(MAX_TOOL_INPUT_ELEMENTS);
  });

  it("answers a call over the limit with an isError result naming the limit, before the tool runs", async () => {
    ({ client } = await connectCostFixture());
    // sessionId and status, plus 255 status values: 257 elements.
    const status = Array.from({ length: MAX_TOOL_INPUT_ELEMENTS - 1 }, () => "error");

    const result = await client.callTool({ name: "list_tool_calls", arguments: { sessionId: "cp-1", status } });

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toBe(
      `Invalid arguments for tool list_tool_calls: arguments contain more than the maximum of ${MAX_TOOL_INPUT_ELEMENTS} elements`,
    );
  });

  it("lets a call at the limit through to the tool", async () => {
    ({ client } = await connectCostFixture());
    // sessionId and status, plus 254 status values: 256 elements.
    const status = Array.from({ length: MAX_TOOL_INPUT_ELEMENTS - 2 }, () => "error");

    const result = await client.callTool({ name: "list_tool_calls", arguments: { sessionId: "cp-1", status } });

    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  });
});

// serveStdio calls the server factory once per connection and once more for
// a server/discover probe it may discard (plan §9b), so building a server
// must not touch the services, the views file or the process's output.
describe("createMcpServer as serveStdio's factory", () => {
  function recording<T>(value: T, path: string, calls: string[]): T {
    if (typeof value === "function") {
      return ((...args: unknown[]) => {
        calls.push(path);
        return (value as (...a: unknown[]) => unknown)(...args);
      }) as T;
    }
    if (value === null || typeof value !== "object") return value;
    return new Proxy(value as object, {
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver) as unknown;
        if (typeof member === "function") {
          return (...args: unknown[]) => {
            calls.push(`${path}.${String(property)}`);
            return Reflect.apply(member as (...a: unknown[]) => unknown, target, args);
          };
        }
        return recording(member, `${path}.${String(property)}`, calls);
      },
    }) as T;
  }

  it("has no side effects when called twice over the same deps, and each call builds its own server", async () => {
    const { deps } = composeCostFixture({ appViews: { source: new InMemoryViewSource("<!doctype html><html></html>") } });
    const calls: string[] = [];
    const watched = Object.fromEntries(Object.entries(deps).map(([key, value]) => [key, recording(value, key, calls)])) as McpServerDeps;
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write");

    try {
      const first = createMcpServer(watched);
      const second = createMcpServer(watched);

      expect(calls).toEqual([]);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      expect(second).not.toBe(first);
      const listed = await Promise.all(
        [first, second].map(async (server) => {
          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
          const peer = new Client({ name: "test-client", version: "1.0.0" });
          await Promise.all([server.connect(serverTransport), peer.connect(clientTransport)]);
          const { tools } = await peer.listTools();
          await peer.close();
          return tools.length;
        }),
      );
      expect(listed).toEqual([22, 22]);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
