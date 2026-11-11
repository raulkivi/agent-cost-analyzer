// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { seedCopilotSessionStore } from "@agent-cost-analyzer/server/src/test-support/copilot-session-store";
import { mcpServerBundleOptions } from "../scripts/esbuild-options.mts";

const VERSION = "9.9.9-test";
const serverFixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/fixtures");

interface JsonRpcMessage {
  jsonrpc: string;
  id?: number;
  result?: {
    serverInfo?: { name: string; version: string };
    tools?: { name: string; outputSchema?: { type: string } }[];
    prompts?: { name: string }[];
  };
}

// Runs the bundle as VS Code would (the extension's McpStdioServerDefinition,
// minus Electron: plain node here), speaks newline-delimited JSON-RPC to it,
// and returns every stdout line once `tools/list` and `prompts/list` are
// answered, plus stderr.
async function initializeAndListTools(bundle: string, userDataDir: string): Promise<{ lines: string[]; stderr: string }> {
  const child = spawn(process.execPath, [bundle, "--user-data-dir", userDataDir], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf-8")));
  const answered = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      const lines = stdout.split("\n");
      if (lines.some((line) => line.includes('"id":2')) && lines.some((line) => line.includes('"id":3'))) resolve();
    });
    child.on("exit", (code) => reject(new Error(`exited with ${code}: ${stderr}`)));
  });
  const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bundle-test", version: "1.0.0" } },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  send({ jsonrpc: "2.0", id: 3, method: "prompts/list", params: {} });
  try {
    await answered;
  } finally {
    child.kill();
  }
  return { lines: stdout.split("\n").filter((line) => line !== ""), stderr };
}

// The built child-process bundle (dist/mcp-stdio.js, step 10.8), laid out
// as in the .vsix: dist/ next to the extension's package.json.
describe("the built MCP server bundle", () => {
  let installDir: string;
  let bundle: string;
  let userDataDir: string;

  beforeAll(async () => {
    installDir = mkdtempSync(path.join(tmpdir(), "ai-credits-analyzer-mcp-"));
    await build({ ...mcpServerBundleOptions(path.join(installDir, "dist")), logLevel: "silent" });
    writeFileSync(path.join(installDir, "package.json"), JSON.stringify({ name: "ai-credits-analyzer", version: VERSION }));
    bundle = path.join(installDir, "dist", "mcp-stdio.js");
    // Step 15.13: the vendor profiles and the bundled price book, in media/ as in the .vsix.
    for (const name of ["vendor-profiles", "price-book"]) {
      cpSync(path.join(serverFixturesDir, name), path.join(installDir, "media", name), { recursive: true });
    }
    userDataDir = path.join(installDir, "user-data");
    seedCopilotSessionStore(
      path.join(userDataDir, "User", "globalStorage", "github.copilot-chat", "session-store.db"),
      new Date().toISOString(),
    );
  }, 60_000);

  afterAll(() => {
    rmSync(installDir, { recursive: true, force: true });
  });

  // Step 15.13 (plan §10.1.6): every tool group but billing (D7); Phase 14 step 14.5 adds replay (D5): 19 tools.
  it("answers initialize, tools/list with the 19 tools and prompts/list with 4 prompts, and writes nothing but JSON-RPC to stdout", async () => {
    const { lines } = await initializeAndListTools(bundle, userDataDir);
    const messages = lines.map((line) => JSON.parse(line) as JsonRpcMessage);

    expect(messages.every((message) => message.jsonrpc === "2.0")).toBe(true);
    expect(messages.find((message) => message.id === 1)?.result?.serverInfo).toEqual(expect.objectContaining({ name: "ai-credits-analyzer", version: VERSION }));
    const tools = messages.find((message) => message.id === 2)?.result?.tools ?? [];
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "compare_costs",
      "compare_models_for_session",
      "explain_cost_change",
      "get_audit_rollup",
      "get_cost_rollup",
      "get_price_book",
      "get_price_changes",
      "get_project_cost",
      "get_repository_cost",
      "get_session_audit",
      "get_session_cost",
      "get_turn",
      "list_findings",
      "list_log_providers",
      "list_projects",
      "list_repositories",
      "list_sessions",
      "list_tool_calls",
      "replay_session",
    ]);
    expect(tools.every((tool) => tool.outputSchema?.type === "object")).toBe(true);
    // The billing prompts (prepare_statement, estimate_work) are left out with their tools.
    const prompts = messages.find((message) => message.id === 3)?.result?.prompts ?? [];
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual(["audit_session", "explain_cost_change", "review_costs", "security_review"]);
  }, 60_000);

  // Phase 12 A13: dist/mcp-apps/views.html next to the bundle, as in the .vsix.
  // Without it (the test above) the server lists its 19 tools and no views.
  it("serves dist/mcp-apps/views.html when it is there: _meta.ui on the thirteen registered view tools and a 20th, app-only, tool", async () => {
    const views = path.join(installDir, "dist", "mcp-apps", "views.html");
    mkdirSync(path.dirname(views), { recursive: true });
    writeFileSync(views, '<!doctype html><html><head><meta name="aca-brand" content=""></head><body>built views</body></html>');
    try {
      const { lines } = await initializeAndListTools(bundle, userDataDir);
      const tools = (lines.map((line) => JSON.parse(line) as JsonRpcMessage).find((message) => message.id === 2)?.result?.tools ?? []) as {
        name: string;
        _meta?: { ui?: { resourceUri?: string } };
      }[];

      expect(tools).toHaveLength(20);
      expect(
        tools
          .filter((tool) => tool._meta?.ui?.resourceUri === "ui://ai-credits-analyzer/views.html")
          .map((tool) => tool.name)
          .sort(),
      ).toEqual([
        "compare_costs",
        "compare_models_for_session",
        "explain_cost_change",
        "get_audit_rollup",
        "get_cost_rollup",
        "get_price_changes",
        "get_project_cost",
        "get_repository_cost",
        "get_session_audit",
        "get_session_cost",
        "list_findings",
        "list_sessions",
        "replay_session",
      ]);
    } finally {
      rmSync(path.dirname(views), { recursive: true, force: true });
    }
  }, 60_000);

  it.each([
    ["no arguments", []],
    ["a relative user-data dir", ["--user-data-dir", "user-data"]],
    ["a path with .. segments", ["--user-data-dir", "/tmp/../etc"]],
    ["an unknown flag", ["--user-data-dir", "/tmp", "--inspect"]],
  ])("refuses %s on stderr with a non-zero exit, and writes nothing to stdout", (_label, args) => {
    const result = spawnSync(process.execPath, [bundle, ...args], { encoding: "utf-8", input: "" });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage: mcp-stdio.js --user-data-dir");
  });

  it("refuses a directory that isn't a VS Code user-data dir", () => {
    const notUserData = path.join(installDir, "not-user-data");
    mkdirSync(notUserData);

    const result = spawnSync(process.execPath, [bundle, "--user-data-dir", notUserData], { encoding: "utf-8", input: "" });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("has no User folder");
  });
});
