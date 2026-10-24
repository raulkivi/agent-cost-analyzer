import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { seedCopilotSessionStore } from "@copilot-cost-analyzer/server/src/test-support/copilot-session-store";
import { mcpServerBundleOptions } from "../scripts/esbuild-options.mts";

const VERSION = "9.9.9-test";

interface JsonRpcMessage {
  jsonrpc: string;
  id?: number;
  result?: { serverInfo?: { name: string; version: string }; tools?: { name: string; outputSchema?: { type: string } }[] };
}

// Runs the bundle as VS Code would (the extension's McpStdioServerDefinition,
// minus Electron: plain node here), speaks newline-delimited JSON-RPC to it,
// and returns every stdout line once `tools/list` is answered, plus stderr.
async function initializeAndListTools(bundle: string, userDataDir: string): Promise<{ lines: string[]; stderr: string }> {
  const child = spawn(process.execPath, [bundle, "--user-data-dir", userDataDir], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf-8")));
  const answered = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      if (stdout.split("\n").some((line) => line.includes('"id":2'))) resolve();
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
    userDataDir = path.join(installDir, "user-data");
    seedCopilotSessionStore(
      path.join(userDataDir, "User", "globalStorage", "github.copilot-chat", "session-store.db"),
      new Date().toISOString(),
    );
  }, 60_000);

  afterAll(() => {
    rmSync(installDir, { recursive: true, force: true });
  });

  it("answers initialize and tools/list with the 9 tools, and writes nothing but JSON-RPC to stdout", async () => {
    const { lines } = await initializeAndListTools(bundle, userDataDir);
    const messages = lines.map((line) => JSON.parse(line) as JsonRpcMessage);

    expect(messages.every((message) => message.jsonrpc === "2.0")).toBe(true);
    expect(messages.find((message) => message.id === 1)?.result?.serverInfo).toEqual(expect.objectContaining({ name: "ai-credits-analyzer", version: VERSION }));
    const tools = messages.find((message) => message.id === 2)?.result?.tools ?? [];
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "get_audit_rollup",
      "get_cost_rollup",
      "get_session_audit",
      "get_session_cost",
      "get_turn",
      "list_findings",
      "list_log_providers",
      "list_sessions",
      "list_tool_calls",
    ]);
    expect(tools.every((tool) => tool.outputSchema?.type === "object")).toBe(true);
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
