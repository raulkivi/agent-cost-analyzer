// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { priceBookListingSchema } from "@agent-cost-analyzer/domain";
import { isolatedLogProviders } from "../test-support/isolated-log-providers.js";
import { TEMP_LAYOUT, writeTempPackageLayout, type TempPackageLayout } from "../test-support/temp-package-layout.js";
import { createStandaloneMcpServerFactory, type StandaloneMcpServerOptions } from "./standalone-mcp-server.js";

const VIEWS_URI = "ui://agent-cost-analyzer/views.html";
const SERVER_PACKAGE_VERSION = (
  JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf-8")) as { version: string }
).version;

// npm-package.md §4.2 "Paths" and §4.6, task NP3: the standalone MCP
// composition root reads its version, views and data from a package layout
// when given one. The temp layout's files differ from this package's own,
// so each answer shows which file was read.
describe("createStandaloneMcpServerFactory", () => {
  let temp: TempPackageLayout;
  let settings: string;
  const clients: Client[] = [];

  beforeEach(() => {
    temp = writeTempPackageLayout();
    settings = mkdtempSync(path.join(tmpdir(), "standalone-mcp-"));
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    temp.remove();
    rmSync(settings, { recursive: true, force: true });
  });

  async function connect(options: Omit<StandaloneMcpServerOptions, keyof ReturnType<typeof isolatedLogProviders>>): Promise<{ client: Client; version: string }> {
    const { createServer, version } = createStandaloneMcpServerFactory({ ...isolatedLogProviders(settings), log: () => undefined, ...options });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "standalone-mcp-test", version: "1.0.0" });
    clients.push(client);
    await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
    return { client, version };
  }

  it("reports the version of the layout's package.json", async () => {
    const { client, version } = await connect({ layout: temp.layout });

    expect(version).toBe(TEMP_LAYOUT.version);
    expect(client.getServerVersion()).toMatchObject({ name: "agent-cost-analyzer", version: TEMP_LAYOUT.version });
  });

  it("serves the layout's views file as the MCP App views", async () => {
    const { client } = await connect({ layout: temp.layout });

    const { contents } = await client.readResource({ uri: VIEWS_URI });

    expect((contents[0] as { text: string }).text).toContain(TEMP_LAYOUT.viewsMarker);
  });

  it("lets --app-views-html replace the layout's views file", async () => {
    const own = path.join(settings, "own-views.html");
    writeFileSync(own, '<!doctype html><html><head><meta name="aca-brand" content=""></head><body>the caller\'s own views</body></html>');
    const { client } = await connect({ layout: temp.layout, appViewsHtml: own });

    const { contents } = await client.readResource({ uri: VIEWS_URI });

    expect((contents[0] as { text: string }).text).toContain("the caller's own views");
  });

  it("reads the price book from the layout", async () => {
    const { client } = await connect({ layout: temp.layout });

    const result = await client.callTool({ name: "get_price_book", arguments: {} });

    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    expect(priceBookListingSchema.parse(result.structuredContent).channels).toEqual(TEMP_LAYOUT.priceBookChannels);
  });

  it("reads the vendor profiles from the layout", () => {
    // This package's own profiles are valid, so the error can only come from the layout's.
    writeFileSync(path.join(temp.layout.vendorProfilesDir, "zz-broken.json"), "{}");

    expect(() => createStandaloneMcpServerFactory({ ...isolatedLogProviders(settings), layout: temp.layout, log: () => undefined })).toThrow(
      /Vendor profile "zz-broken.json" is invalid/,
    );
  });

  // Dev defaults unchanged: no layout means this package's own files, and
  // views only from --app-views-html (scripts/mcp-server.sh).
  it("without a layout, reports the server package's version, serves no views and reads this package's price book", async () => {
    const { client, version } = await connect({});

    const { tools } = await client.listTools();
    const priceBook = await client.callTool({ name: "get_price_book", arguments: {} });

    expect(version).toBe(SERVER_PACKAGE_VERSION);
    expect(tools.some((tool) => tool._meta !== undefined)).toBe(false);
    expect(priceBookListingSchema.parse(priceBook.structuredContent).channels).toEqual(["anthropic-api", "github-copilot", "google-api", "openai-api"]);
  });

  it("says on its log, never on stdout, when the views file is missing, and starts without views", async () => {
    const lines: string[] = [];
    const missing = path.join(settings, "missing", "views.html");
    const { createServer } = createStandaloneMcpServerFactory({ ...isolatedLogProviders(settings), appViewsHtml: missing, log: (line) => lines.push(line) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "standalone-mcp-test", version: "1.0.0" });
    clients.push(client);
    await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();

    expect(lines).toEqual([`agent-cost-analyzer MCP server: no app views at ${missing}; starting without them (run npm run build).`]);
    expect(tools.some((tool) => tool._meta !== undefined)).toBe(false);
  });
});
