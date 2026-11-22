// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// V29 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/savings-increment-3.md §8 R16, §9): since V27 a forked pi file's
// branches reach get_savings_report as `<hash>__branch__<leaf id>`. The model
// must be able to pass such an id on to get_session_cost unchanged. V28 was to
// test this with the pi trace; V28 moved after 1.0, V27's pi rows did not.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterAll, describe, expect, it } from "vitest";
import { loadVendorProfiles } from "../data-sources/vendor-profiles/loader.js";
import { createMcpServer } from "../mcp/mcp-server.js";
import type { SavingsToolOutput } from "../mcp/savings-tool-output.js";
import { FIXTURE_VENDOR_PROFILES_DIR } from "../test-support/vendor-profiles-dir.js";
import { composeLogProviders } from "./compose-log-providers.js";
import { createStandalonePriceBook } from "./create-price-book.js";
import { createStandaloneAttribution } from "./create-standalone-attribution.js";
import { createTurnPricer } from "./create-turn-pricer.js";
import { createMcpServices } from "./mcp-services.js";

const root = mkdtempSync(path.join(tmpdir(), "pi-branch-ids-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Line = Record<string, unknown>;
const at = (n: number) => `2026-11-14T10:00:${String(n).padStart(2, "0")}.000Z`;
const tool = (name: string) => ({ name, description: `${name} tool`, parameters: { type: "object", properties: {} } });
const usage = { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 };
const header: Line = { type: "session", version: 3, id: "22222222-2222-2222-2222-222222222222", timestamp: at(0), cwd: "/work" };
const system = (id: string, parentId: string | null, message: Record<string, unknown>): Line => ({ type: "message", id, parentId, timestamp: at(1), message: { role: "system", content: "", timestamp: 1, ...message } });
const user = (id: string, parentId: string): Line => ({ type: "message", id, parentId, timestamp: at(2), message: { role: "user", content: `prompt ${id}` } });
const assistant = (id: string, parentId: string): Line => ({ type: "message", id, parentId, timestamp: at(3), message: { role: "assistant", model: "local-model", content: [{ type: "text", text: "ok" }], usage } });

// Two leaves with requests of their own; neither calls a tool, so both declared tools are unused.
const forked: Line[] = [
  header,
  system("s0", null, { toolsAdded: [tool("read"), tool("write")] }),
  user("u1", "s0"),
  assistant("a1", "u1"),
  user("u2a", "a1"),
  assistant("a2a", "u2a"),
  user("u2b", "a1"),
  assistant("a2b", "u2b"),
];

async function connect(): Promise<Client> {
  const sessionsDir = path.join(root, "sessions", "--work--");
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(path.join(sessionsDir, "2026-11-14T10-00-00_session.jsonl"), `${forked.map((line) => JSON.stringify(line)).join("\n")}\n`);
  const appSettingsDir = path.join(root, "settings");
  mkdirSync(appSettingsDir, { recursive: true });
  // The standalone stdio server's composition over pi only.
  const { registry, resolvedAppSettingsDir } = composeLogProviders({
    appSettingsDir,
    sessionStoreDbPath: path.join(root, "missing.db"),
    debugLogsDirPaths: [],
    vscodeSettingsPath: null,
    agentTracesDbPath: null,
    agentHostUserDataDir: null,
    copilotHome: null,
    claudeCodeProjectsDirPath: null,
    mitmproxyCapturesDirPath: null,
    piAgentSessionsDirPath: path.join(root, "sessions"),
    systemPromptLogPath: null,
  });
  const profiles = loadVendorProfiles(FIXTURE_VENDOR_PROFILES_DIR);
  const attribution = createStandaloneAttribution(registry, resolvedAppSettingsDir, profiles);
  const priceBook = createStandalonePriceBook(resolvedAppSettingsDir, attribution.catalog);
  const server = createMcpServer({ ...createMcpServices(registry, "0.0.0-test", undefined, attribution, createTurnPricer(priceBook), priceBook, undefined, { profiles, priceBook }), priceBook });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("a forked pi file's branch ids in get_savings_report (R16)", () => {
  it("round-trip unchanged to get_session_cost", async () => {
    const client = await connect();
    try {
      const report = await client.callTool({ name: "get_savings_report", arguments: { provider: "pi-agent", since: "2026-11-01", until: "2026-11-30", limit: 20 } });
      expect(report.isError, JSON.stringify(report.content)).not.toBe(true);
      const rows = (report.structuredContent as unknown as SavingsToolOutput).opportunities.filter((row) => row.kind === "unused-tools");
      const ids = [...new Set(rows.flatMap((row) => row.sessions.map((session) => session.sessionId)))].sort();

      expect(rows.map((row) => row.subject).sort()).toEqual(["read", "write"]);
      expect(ids).toHaveLength(2);
      expect(ids.map((id) => id.replace(/^[0-9a-f]{16}/, "<hash>"))).toEqual(["<hash>__branch__a2a", "<hash>__branch__a2b"]);
      for (const sessionId of ids) {
        const cost = await client.callTool({ name: "get_session_cost", arguments: { provider: "pi-agent", sessionId } });
        expect(cost.isError, JSON.stringify(cost.content)).not.toBe(true);
        expect((cost.structuredContent as { sessionId: string }).sessionId).toBe(sessionId);
      }
    } finally {
      await client.close();
    }
  });
});
