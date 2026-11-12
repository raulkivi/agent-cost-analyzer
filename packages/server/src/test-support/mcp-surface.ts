// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// What a host sees of an MCP server before calling anything: its identity,
// capabilities, instructions, tools, resources and prompts. The tool-list
// contract tests snapshot it (docs/plans/mcp-sdk-2-migration.md M2), so a
// change of SDK can't silently change what a host reads.
//
// Structural client type: the same helper reads an SDK 1 and an SDK 2
// client, so the snapshot taken on SDK 1 pins SDK 2.

type Json = Record<string, unknown>;

export interface McpSurfaceClient {
  getServerVersion(): Json | undefined;
  getServerCapabilities(): Json | undefined;
  getInstructions(): string | undefined;
  listTools(): Promise<{ tools: Json[] }>;
  listPrompts(): Promise<{ prompts: Json[] }>;
  listResources(): Promise<{ resources: Json[] }>;
}

// The JSON Schema keywords that differ between the dialect SDK 1 advertised
// (draft-07) and SDK 2's (2020-12), mapped to one spelling so a schema
// compares by meaning. `$schema` names the dialect itself and is dropped;
// the dialect is asserted on its own (inputSchemaDialects).
export function normaliseSchemaDialect(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(normaliseSchemaDialect);
  if (schema === null || typeof schema !== "object") return schema;
  const out: Json = {};
  for (const [key, value] of Object.entries(schema as Json)) {
    if (key === "$schema") continue;
    if (key === "$defs" || key === "definitions") out.definitions = normaliseSchemaDialect(value);
    else if (key === "$ref" && typeof value === "string") out.$ref = value.replace("#/$defs/", "#/definitions/");
    else out[key] = normaliseSchemaDialect(value);
  }
  return out;
}

const byName = (a: Json, b: Json) => String(a.name).localeCompare(String(b.name));

// Everything but the server's version (the products pass their own) and the
// order of tools (compared order-independent, sorted by name).
export async function readMcpSurface(client: McpSurfaceClient): Promise<Json> {
  const serverInfo = { ...client.getServerVersion() };
  delete serverInfo.version;
  const capabilities = client.getServerCapabilities() ?? {};
  const { tools } = await client.listTools();
  const { prompts } = await client.listPrompts();
  const resources = capabilities.resources ? (await client.listResources()).resources : [];
  return {
    serverInfo,
    capabilities,
    instructions: client.getInstructions(),
    tools: [...tools].sort(byName).map((tool) => ({
      ...tool,
      inputSchema: normaliseSchemaDialect(tool.inputSchema),
      outputSchema: normaliseSchemaDialect(tool.outputSchema),
    })),
    resources: [...resources].sort(byName),
    prompts: [...prompts].sort(byName),
  };
}

// The snapshot file of one product's variants (with and without views):
// each tool's schemas once, one line per tool, since they are the bulk of
// the surface and the same in every variant; the rest pretty-printed.
export function surfaceFixture(variants: Record<string, Json>): string {
  const schemas = new Map<string, string>();
  const slim = Object.fromEntries(
    Object.entries(variants).map(([variant, surface]) => [
      variant,
      {
        ...surface,
        tools: (surface.tools as Json[]).map(({ inputSchema, outputSchema, ...tool }) => {
          const line = JSON.stringify({ inputSchema, outputSchema });
          const seen = schemas.get(String(tool.name));
          if (seen !== undefined && seen !== line) throw new Error(`${String(tool.name)}'s schemas differ between variants`);
          schemas.set(String(tool.name), line);
          return tool;
        }),
      },
    ]),
  );
  const lines = [...schemas].sort(([a], [b]) => a.localeCompare(b)).map(([name, line]) => `    ${JSON.stringify(name)}: ${line}`);
  return `${JSON.stringify({ ...slim, schemas: "__SCHEMAS__" }, null, 2).replace('"__SCHEMAS__"', `{\n${lines.join(",\n")}\n  }`)}\n`;
}

// The `$schema` each tool's advertised schemas name.
export async function schemaDialects(client: McpSurfaceClient): Promise<Set<unknown>> {
  const { tools } = await client.listTools();
  return new Set(
    tools.flatMap((tool) => [(tool.inputSchema as Json | undefined)?.$schema, (tool.outputSchema as Json | undefined)?.$schema]),
  );
}
