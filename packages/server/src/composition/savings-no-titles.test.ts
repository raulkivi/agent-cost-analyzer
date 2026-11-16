// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// V29 (savings-increment-3.md §5, §9, D19, D24): titles stay in the browser.
// mcp/security.test.ts checks the same boundary over the cost fixture, whose
// savings report has no row, so no session reference could carry a title
// there. This runs the standalone composition over SR13's Claude Code
// savings session, which gives two rows, and searches every answer for the
// session's title.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadVendorProfiles } from "../data-sources/vendor-profiles/loader.js";
import { createMcpServer } from "../mcp/mcp-server.js";
import type { SavingsToolOutput } from "../mcp/savings-tool-output.js";
import { writeSavingsClaudeCodeSession } from "../test-support/savings-fixtures.js";
import { FIXTURE_VENDOR_PROFILES_DIR } from "../test-support/vendor-profiles-dir.js";
import { composeLogProviders } from "./compose-log-providers.js";
import { createStandaloneApiService } from "./create-standalone-api-service.js";
import { createStandalonePriceBook } from "./create-price-book.js";
import { createStandaloneAttribution } from "./create-standalone-attribution.js";
import { createTurnPricer } from "./create-turn-pricer.js";
import { createMcpServices } from "./mcp-services.js";

const WINDOW = { since: "2026-10-15", until: "2026-11-13" };
let root: string;
let projectsDir: string;
let appSettingsDir: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "savings-no-titles-"));
  projectsDir = path.join(root, "projects");
  appSettingsDir = path.join(root, "settings");
  mkdirSync(appSettingsDir, { recursive: true });
  writeSavingsClaudeCodeSession(projectsDir, "/home/dev/scratch", "2026-10-30");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const paths = () => ({
  appSettingsDir,
  sessionStoreDbPath: path.join(root, "missing.db"),
  debugLogsDirPaths: [],
  vscodeSettingsPath: null,
  agentTracesDbPath: null,
  agentHostUserDataDir: null,
  copilotHome: null,
  claudeCodeProjectsDirPath: projectsDir,
  mitmproxyCapturesDirPath: null,
  piAgentSessionsDirPath: null,
  systemPromptLogPath: null,
});

async function connect(): Promise<Client> {
  const { registry, resolvedAppSettingsDir } = composeLogProviders(paths());
  const profiles = loadVendorProfiles(FIXTURE_VENDOR_PROFILES_DIR);
  const attribution = createStandaloneAttribution(registry, resolvedAppSettingsDir, profiles);
  const priceBook = createStandalonePriceBook(resolvedAppSettingsDir, attribution.catalog);
  const server = createMcpServer({ ...createMcpServices(registry, "0.0.0-test", undefined, attribution, createTurnPricer(priceBook), priceBook, undefined, { profiles, priceBook }), priceBook });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("session titles and the savings report over a session it lists", () => {
  it("leave no title in get_savings_report (structured and text) or in the Savings tab's report, though each row lists the session", async () => {
    const client = await connect();
    try {
      const listed = await client.callTool({ name: "list_sessions", arguments: { provider: "claude-code", ...WINDOW } });
      const sessions = (listed.structuredContent as { sessions: { id: string; title: string }[] }).sessions;
      const titles = sessions.map((session) => session.title).filter((title) => title.trim().length > 0);
      expect(titles).toHaveLength(1);

      const tool = await client.callTool({ name: "get_savings_report", arguments: { provider: "claude-code", ...WINDOW, limit: 20 } });
      expect(tool.isError, JSON.stringify(tool.content)).not.toBe(true);
      const rows = (tool.structuredContent as unknown as SavingsToolOutput).opportunities;
      expect(rows.map((row) => row.kind).sort()).toEqual(["idle-cache-expiry", "model-switch"]);
      expect(rows.every((row) => row.sessions.some((ref) => ref.sessionId === sessions[0]!.id))).toBe(true);

      const app = createStandaloneApiService({ ...paths(), vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR, appVersion: "0.0.0-test", learnScriptsDir: path.join(FIXTURE_VENDOR_PROFILES_DIR, "..", "learn-scripts") });
      const tab = await app.getSavingsReport({ provider: "claude-code", ...WINDOW });
      expect(tab.opportunities.length).toBe(rows.length);

      for (const answer of [JSON.stringify(tool), JSON.stringify(tab)]) {
        for (const title of titles) expect(answer).not.toContain(JSON.stringify(title).slice(1, -1));
      }
    } finally {
      await client.close();
    }
  });
});
