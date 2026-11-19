// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// server.json is the MCP Registry entry (mcp-client-setup.md §5.7). It is not
// shipped in the tarball; release-app.yml publishes it after the npm publish.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name: string) => JSON.parse(readFileSync(join(cliDir, name), "utf-8"));
const manifest = readJson("package.json");
const server = readJson("server.json");

describe("packages/cli/server.json", () => {
  it("uses the 2025-12-11 schema", () => {
    expect(server.$schema).toBe("https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
  });

  it("is named by the package's mcpName, which the registry checks on npm", () => {
    expect(server.name).toBe(manifest.mcpName);
  });

  it("carries the package version twice, so a release can't list a version npm lacks", () => {
    expect(server.version).toBe(manifest.version);
    expect(server.packages).toHaveLength(1);
    expect(server.packages[0].version).toBe(manifest.version);
  });

  it("lists the npm package over stdio, started with the mcp subcommand", () => {
    expect(server.packages[0]).toMatchObject({
      registryType: "npm",
      identifier: manifest.name,
      transport: { type: "stdio" },
    });
    expect(server.packages[0].packageArguments).toEqual([{ type: "positional", value: "mcp" }]);
  });

  it("has a description within the schema's 100 characters", () => {
    expect(server.description.length).toBeGreaterThan(0);
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it("points at this repository's packages/cli", () => {
    expect(server.repository).toEqual({
      url: "https://github.com/raulkivi/agent-cost-analyzer",
      source: "github",
      subfolder: "packages/cli",
    });
  });

  it("stays out of the tarball", () => {
    expect(manifest.files).not.toContain("server.json");
  });
});
