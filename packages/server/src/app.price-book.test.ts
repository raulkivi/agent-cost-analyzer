// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { priceBookListingSchema } from "@agent-cost-analyzer/domain";
import { createApp } from "./app.js";
import { createStandalonePriceBook } from "./composition/create-price-book.js";
import { LogProviderRegistry } from "./data-sources/log-providers/registry.js";
import { createMcpServices } from "./composition/mcp-services.js";
import { createMcpServer } from "./mcp/mcp-server.js";
import { InMemoryAppSettingsStore } from "./test-support/in-memory-app-settings-store.js";

// Phase 15 step 15.5: GET /api/price-book over the real composition (bundled
// book plus the user's versions from projects.json), and the same answer as
// the get_price_book MCP tool (plan §10.1.6).
const tier = { inputUsdPerM: 2.5, cachedInputUsdPerM: 0.25, cacheWriteUsdPerM: 3, outputUsdPerM: 12 };
const projectsFile = {
  version: 1,
  projects: [{ id: "acme", name: "ACME", members: [{ repository: "github.com/acme/web" }] }],
  channels: {
    priceVersions: [
      {
        id: "acme-reseller:claude-sonnet-5.5:2026-07-01",
        channel: "acme-reseller",
        modelId: "claude-sonnet-5.5",
        currency: "USD",
        effectiveFrom: "2026-07-01",
        tiers: [tier],
        kind: "contract",
        scope: { projectId: "acme" },
      },
      {
        id: "mine",
        channel: "github-copilot",
        modelId: "claude-sonnet-5.5",
        currency: "USD",
        effectiveFrom: "2026-10-01",
        tiers: [tier],
        kind: "list",
      },
    ],
  },
};

describe("price book API", () => {
  let dir: string;
  let settingsDir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-price-book-test-"));
    settingsDir = path.join(dir, "settings");
    mkdirSync(settingsDir);
    writeFileSync(path.join(settingsDir, "projects.json"), JSON.stringify(projectsFile));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function buildApp() {
    return createApp({
      sessionStoreDbPath: path.join(dir, "missing.db"),
      debugLogsDirPaths: [],
      vscodeSettingsPath: null,
      agentTracesDbPath: null,
      agentHostUserDataDir: null,
      appSettingsDir: settingsDir,
      mitmproxyCapturesDirPath: null,
      piAgentSessionsDirPath: null,
      systemPromptLogPath: null,
      claudeCodeProjectsDirPath: null,
    });
  }

  it("GET /api/price-book lists the bundled versions and the user's, with the user's clashes as problems", async () => {
    const response = await request(buildApp()).get("/api/price-book");

    expect(response.status).toBe(200);
    const listing = priceBookListingSchema.parse(response.body);
    expect(listing.channels).toEqual(expect.arrayContaining(["acme-reseller", "github-copilot"]));
    expect(listing.versions.find((version) => version.origin === "user")).toMatchObject({ kind: "contract", scope: { projectId: "acme" } });
    expect(listing.versions.some((version) => version.id === "mine")).toBe(false);
    expect(listing.problems).toEqual([{ path: "channels.priceVersions[1]", message: expect.stringMatching(/"mine" overlaps/) }]);
  });

  it("filters by channel, model and at", async () => {
    const response = await request(buildApp())
      .get("/api/price-book")
      .query({ channel: "github-copilot", model: "claude-sonnet-5.5", at: "2026-11-05" });

    expect(response.body.versions.map((version: { id: string }) => version.id)).toEqual(["github-copilot:claude-sonnet-5.5:2026-10-07"]);
  });

  it("answers 400 for an `at` that isn't an ISO date", async () => {
    const response = await request(buildApp()).get("/api/price-book").query({ at: "soon" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/at/);
  });

  it("returns what the get_price_book MCP tool returns", async () => {
    const query = { channel: "github-copilot", model: "gemini-4-argon", at: "2026-11-30" };
    const http = await request(buildApp()).get("/api/price-book").query(query);

    const registry = new LogProviderRegistry([], new InMemoryAppSettingsStore());
    const server = createMcpServer({ ...createMcpServices(registry, "0.0.0-test"), priceBook: createStandalonePriceBook(settingsDir) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const mcp = await client.callTool({ name: "get_price_book", arguments: query });
    await client.close();

    expect(mcp.structuredContent).toEqual(http.body);
    expect(http.body.versions).toHaveLength(1);
  });
});
