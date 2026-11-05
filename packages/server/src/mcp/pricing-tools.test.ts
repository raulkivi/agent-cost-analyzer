import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { priceBookListingSchema, type LogProviderStatus, type PriceBookEntry } from "@agent-cost-analyzer/domain";
import { AnalysisQueryService } from "../services/analysis/analysis-query-service.js";
import { InsightsService } from "../services/insights/insights-service.js";
import { BundledPriceBookSource } from "../services/pricing/bundled-price-book-source.js";
import { CompositePriceBookSource } from "../services/pricing/composite-price-book-source.js";
import { PriceBook } from "../services/pricing/price-book.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { FakeProvider, lookup } from "../test-support/audit-fakes.js";
import { createMcpServer } from "./mcp-server.js";

// Phase 15 step 15.5 (plan §10.1.1, §10.1.6): get_price_book over the
// bundled price book plus a user contract version.
const providerStatus: LogProviderStatus = { activeProviderId: "fake", providers: [{ id: "fake", label: "Fake", available: true }] };

const contract: PriceBookEntry = {
  id: "acme-reseller:claude-sonnet-5.5:2026-07-01",
  channel: "acme-reseller",
  modelId: "claude-sonnet-5.5",
  currency: "USD",
  effectiveFrom: "2026-07-01",
  tiers: [{ inputUsdPerM: 2.5, cachedInputUsdPerM: 0.25, cacheWriteUsdPerM: 3, outputUsdPerM: 12 }],
  kind: "contract",
  scope: { projectId: "acme" },
  sourceIds: [],
  origin: "user",
};

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
const textOf = (result: ToolResult): string => (result.content as { text: string }[])[0]!.text;

async function connect(withPriceBook: boolean): Promise<Client> {
  const provider = new FakeProvider("fake", []);
  const providers = lookup(provider);
  const priceBook = new PriceBook(
    new CompositePriceBookSource([new BundledPriceBookSource(), { load: () => ({ versions: [contract], sources: [], problems: [] }) }]),
  );
  const server = createMcpServer({
    auditQueries: new AuditQueryService(providers),
    analysisQueries: new AnalysisQueryService(providers, new InsightsService({ listProviders: () => [provider] }, [])),
    getProviderStatus: async () => providerStatus,
    version: "0.0.0-test",
    ...(withPriceBook ? { priceBook } : {}),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("get_price_book", () => {
  let client: Client;

  beforeEach(async () => {
    client = await connect(true);
  });

  afterEach(async () => {
    await client.close();
  });

  async function call(args: Record<string, unknown>) {
    const result = await client.callTool({ name: "get_price_book", arguments: args });
    expect(result.isError, textOf(result)).toBeFalsy();
    const listing = priceBookListingSchema.parse(JSON.parse(textOf(result)));
    expect(result.structuredContent).toEqual(listing);
    return listing;
  }

  it("is listed read-only, with a when-to-use description and the domain schema as its output schema", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === "get_price_book");

    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false, destructiveHint: false });
    expect(tool?.description).toMatch(/^Use /);
    expect(tool?.outputSchema?.type).toBe("object");
    expect(Object.keys(tool?.outputSchema?.properties ?? {}).sort()).toEqual(["channels", "gaps", "problems", "sources", "unknown", "versions"]);
  });

  it("lists every version with its sources and checkedAt, the user's contract marked as such", async () => {
    const listing = await call({});

    expect(listing.channels).toEqual(["acme-reseller", "github-copilot"]);
    expect(listing.versions.length).toBeGreaterThan(20);
    expect(listing.sources.every((source) => /^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt))).toBe(true);
    expect(listing.versions.find((version) => version.origin === "user")).toMatchObject({ kind: "contract", id: contract.id });
  });

  it("filters by channel and model, and with `at` returns the version in force then", async () => {
    const listing = await call({ channel: "github-copilot", model: "claude-sonnet-5.5", at: "2026-11-05" });

    expect(listing.versions.map((version) => version.id)).toEqual(["github-copilot:claude-sonnet-5.5:2026-10-07"]);
    expect(listing.sources.map((source) => source.id)).toContain("gh-pricing-table");
  });

  it("says why a price is unknown instead of returning zero", async () => {
    const before = await call({ channel: "github-copilot", model: "claude-sonnet-5.5", at: "2026-03-01" });
    expect(before.versions).toEqual([]);
    expect(before.unknown).toEqual([
      { channel: "github-copilot", modelId: "claude-sonnet-5.5", reason: "no price for claude-sonnet-5.5 on github-copilot before 2026-10-01" },
    ]);

    const noChannel = await call({ channel: "openai-api", model: "gpt-6-sol" });
    expect(noChannel.unknown).toEqual([{ channel: "openai-api", modelId: "gpt-6-sol", reason: "no price book for channel openai-api" }]);
  });

  it("rejects an `at` that isn't an ISO date", async () => {
    const result = await client.callTool({ name: "get_price_book", arguments: { at: "last week" } });
    expect(result.isError).toBe(true);
  });
});

describe("get_price_book without a price book", () => {
  it("isn't registered", async () => {
    const client = await connect(false);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain("get_price_book");
    await client.close();
  });
});
