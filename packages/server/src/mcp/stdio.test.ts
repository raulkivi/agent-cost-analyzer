// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  initializeLegacy,
  MODERN_PROTOCOL_VERSION,
  modernEnvelope,
  spawnJsonRpcStdio,
  type JsonRpcStdioPeer,
} from "../test-support/json-rpc-stdio.js";
import { costRollupSchema, priceBookListingSchema, projectListSchema, repositoryListSchema, sessionCostSchema, sessionReplaySchema } from "@agent-cost-analyzer/domain";

// End-to-end: spawns the real stdio entry point (what `claude mcp add`
// runs) against a temporary HOME holding the real-capture Claude Code
// fixture. Also proves nothing else writes to stdout, which would corrupt
// the JSON-RPC stream.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const fixtureProjectDir = path.resolve(here, "../../fixtures/claude-code-audit/-home-dev-project");

describe("stdio MCP entry point", () => {
  let home: string;
  let client: Client;

  beforeAll(async () => {
    home = mkdtempSync(path.join(tmpdir(), "mcp-stdio-home-"));
    cpSync(fixtureProjectDir, path.join(home, ".claude", "projects", "-home-dev-project"), { recursive: true });
    client = new Client({ name: "stdio-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: path.join(repoRoot, "node_modules", ".bin", "tsx"),
        args: [path.join(here, "stdio.ts")],
        env: { PATH: process.env.PATH ?? "", HOME: home },
        stderr: "ignore",
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    rmSync(home, { recursive: true, force: true });
  });

  it("audits the fixture session through the claude-code provider", async () => {
    const sessions = await client.callTool({ name: "list_sessions", arguments: { provider: "claude-code" } });
    const [session] = (sessions.structuredContent as { sessions: { id: string }[] }).sessions;

    const audit = await client.callTool({ name: "get_session_audit", arguments: { sessionId: session.id, provider: "claude-code" } });

    expect(audit.isError).toBeFalsy();
    expect((audit.structuredContent as { totals: { failed: number } }).totals.failed).toBe(10);
  }, 60_000);

  it("reports the fixture session's real token totals and keeps its AI Credits unknown, not 0", async () => {
    const sessions = await client.callTool({ name: "list_sessions", arguments: { provider: "claude-code" } });
    const [session] = (sessions.structuredContent as { sessions: { id: string }[] }).sessions;

    const result = await client.callTool({ name: "get_session_cost", arguments: { sessionId: session.id, provider: "claude-code" } });
    const cost = sessionCostSchema.parse(result.structuredContent);

    expect(cost.totals.output.knownTurns).toBe(cost.turnCount);
    expect(cost.totals.output.value).toBeGreaterThan(0);
    expect(cost.totals.inputTokens.value).toBeGreaterThan(0);
    expect(cost.totals.aiCredits.value).toBeNull();
    expect(cost.unavailableReasons.length).toBeGreaterThan(0);
  }, 60_000);

  it("rolls up cost and lists findings across every provider", async () => {
    const rollup = await client.callTool({ name: "get_cost_rollup", arguments: {} });
    expect(rollup.isError).toBeFalsy();
    expect(costRollupSchema.parse(rollup.structuredContent).byProvider.map((p) => p.providerId)).toContain("claude-code");

    const findings = await client.callTool({ name: "list_findings", arguments: {} });
    expect(findings.isError).toBeFalsy();
  }, 60_000);

  // Phase 14 step 14.5 (D7): 21 tools and 6 prompts, the replay group among
  // them, and replay_session over the real-capture Claude Code fixture.
  it("lists 21 read-only tools and 6 prompts, and replays the fixture session on another model, labelled simulated", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(21);
    expect((await client.listPrompts()).prompts).toHaveLength(6);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);

    const sessions = await client.callTool({ name: "list_sessions", arguments: { provider: "claude-code" } });
    const [session] = (sessions.structuredContent as { sessions: { id: string }[] }).sessions;
    const result = await client.callTool({ name: "replay_session", arguments: { sessionId: session.id, provider: "claude-code", model: "claude-haiku-5.5" } });

    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    expect(sessionReplaySchema.parse(result.structuredContent)).toMatchObject({ simulated: true, model: "claude-haiku-5.5", sessionId: session.id });
    expect(JSON.stringify(result)).not.toContain(home);
  }, 60_000);

  // Phase 15 step 15.5: the standalone server serves the bundled price book.
  it("returns the price book in force at a date", async () => {
    const result = await client.callTool({ name: "get_price_book", arguments: { channel: "github-copilot", model: "claude-sonnet-5.5", at: "2026-11-05" } });

    expect(result.isError).toBeFalsy();
    expect(priceBookListingSchema.parse(result.structuredContent).versions.map((version) => version.id)).toEqual([
      "github-copilot:claude-sonnet-5.5:2026-10-07",
    ]);
  }, 60_000);

  it("lists the fixture session's repository and the (missing) projects file without local paths (step 15.4)", async () => {
    const repositories = await client.callTool({ name: "list_repositories", arguments: { provider: "claude-code" } });
    const projects = await client.callTool({ name: "list_projects", arguments: {} });

    expect(repositoryListSchema.parse(repositories.structuredContent).repositories.length + repositoryListSchema.parse(repositories.structuredContent).unattributed.length).toBeGreaterThan(0);
    expect(projectListSchema.parse(projects.structuredContent)).toMatchObject({ status: "missing", projects: [] });
    expect(JSON.stringify([repositories, projects])).not.toContain(home);
  }, 60_000);
});

// Phase 12 A13 (docs/plans/mcp-apps.md §7): the real entry point with the
// built views file serves the resource and tags the three tools; with the
// file missing it starts normally without them.
describe("stdio MCP entry point, app views", () => {
  let home: string;
  const clients: Client[] = [];

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), "mcp-stdio-views-home-"));
    cpSync(fixtureProjectDir, path.join(home, ".claude", "projects", "-home-dev-project"), { recursive: true });
  });

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    rmSync(home, { recursive: true, force: true });
  });

  async function connect(extraArgs: string[]): Promise<Client> {
    const client = new Client({ name: "stdio-views-test", version: "1.0.0" });
    clients.push(client);
    await client.connect(
      new StdioClientTransport({
        command: path.join(repoRoot, "node_modules", ".bin", "tsx"),
        args: [path.join(here, "stdio.ts"), ...extraArgs],
        env: { PATH: process.env.PATH ?? "", HOME: home },
        stderr: "ignore",
      }),
    );
    return client;
  }

  it("serves the views file as text/html;profile=mcp-app and tags the seven view tools with _meta.ui", async () => {
    const file = path.join(home, "views.html");
    writeFileSync(file, '<!doctype html><html><head><meta name="aca-brand" content=""></head><body>built views</body></html>');
    const client = await connect(["--app-views-html", file]);

    const { tools } = await client.listTools();
    const uri = "ui://agent-cost-analyzer/views.html";
    for (const name of ["get_session_cost", "get_cost_rollup", "list_findings"]) {
      expect(tools.find((tool) => tool.name === name)!._meta).toMatchObject({ ui: { resourceUri: uri } });
    }
    const { contents } = await client.readResource({ uri });
    expect(contents[0]).toMatchObject({ uri, mimeType: "text/html;profile=mcp-app" });
    expect((contents[0] as { text: string }).text).toContain("built views");
  }, 60_000);

  it("starts normally with its 21 tools and no views when the file is missing", async () => {
    const client = await connect(["--app-views-html", path.join(home, "missing", "views.html")]);

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(21);
    expect(tools.some((tool) => tool._meta !== undefined)).toBe(false);
    const result = await client.callTool({ name: "list_sessions", arguments: { provider: "claude-code" } });
    expect(result.isError).toBeFalsy();
  }, 60_000);
});

// docs/plans/mcp-sdk-2-migration.md D1: the entry point serves 2025-era
// clients (an `initialize` at 2025-06-18 or 2025-11-25) and 2026-07-28
// clients (`server/discover`, then requests carrying the `_meta`
// envelope) from one process; D4: the views resource answers a 2026-07-28
// read with `ttlMs: 0`, so a host never keeps views older than the server.
describe("stdio MCP entry point, protocol revisions (MCP SDK 2, D1, D4)", () => {
  let home: string;
  let viewsFile: string;
  const peers: JsonRpcStdioPeer[] = [];
  const VIEWS_URI = "ui://agent-cost-analyzer/views.html";

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), "mcp-stdio-revisions-home-"));
    cpSync(fixtureProjectDir, path.join(home, ".claude", "projects", "-home-dev-project"), { recursive: true });
    viewsFile = path.join(home, "views.html");
    writeFileSync(viewsFile, '<!doctype html><html><head><meta name="aca-brand" content=""></head><body>built views</body></html>');
  });

  afterAll(async () => {
    await Promise.all(peers.map((peer) => peer.close()));
    rmSync(home, { recursive: true, force: true });
  });

  function start(): JsonRpcStdioPeer {
    const peer = spawnJsonRpcStdio(
      path.join(repoRoot, "node_modules", ".bin", "tsx"),
      [path.join(here, "stdio.ts"), "--app-views-html", viewsFile],
      { PATH: process.env.PATH ?? "", HOME: home },
    );
    peers.push(peer);
    return peer;
  }

  it.each(["2025-06-18", "2025-11-25"])("answers a 2025-era initialize at %s with that version and lists its 22 tools", async (protocolVersion) => {
    const peer = start();

    const initialized = await initializeLegacy(peer, protocolVersion);
    const listed = await peer.request("tools/list");

    expect(initialized.result).toMatchObject({ protocolVersion, serverInfo: { name: "agent-cost-analyzer" } });
    expect((listed.result?.tools as unknown[]).length).toBe(22);
  }, 60_000);

  it("answers server/discover with 2026-07-28 and serves 2026-07-28 requests on the same connection", async () => {
    const peer = start();

    const discovered = await peer.request("server/discover", { _meta: modernEnvelope() });
    const listed = await peer.request("tools/list", { _meta: modernEnvelope() });

    expect(discovered.error).toBeUndefined();
    expect(discovered.result?.supportedVersions).toContain(MODERN_PROTOCOL_VERSION);
    expect(discovered.result?.capabilities).toMatchObject({ tools: {}, resources: {}, prompts: {} });
    expect((listed.result?.tools as unknown[]).length).toBe(22);
  }, 60_000);

  it("answers a 2026-07-28 read of the views resource with ttlMs 0, and a 2025-era one without cache hints", async () => {
    const modern = start();
    const legacy = start();
    await initializeLegacy(legacy, "2025-11-25");

    const modernRead = await modern.request("resources/read", { uri: VIEWS_URI, _meta: modernEnvelope() });
    const legacyRead = await legacy.request("resources/read", { uri: VIEWS_URI });

    expect(modernRead.error).toBeUndefined();
    expect(modernRead.result).toMatchObject({ ttlMs: 0, contents: [{ uri: VIEWS_URI, mimeType: "text/html;profile=mcp-app" }] });
    expect(legacyRead.result).toMatchObject({ contents: [{ uri: VIEWS_URI }] });
    expect(legacyRead.result).not.toHaveProperty("ttlMs");
  }, 60_000);
});
