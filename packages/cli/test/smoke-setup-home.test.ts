// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The mcp-setup smoke's temporary home (mcp-client-setup.md §7, MC7): where
// each client is "detected", the seeded configs, the stub scripts and the
// environment the installed bin runs in.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClientEnv } from "../src/mcp-setup/client-env.js";
import { createClientTargets } from "../src/mcp-setup/client-targets.js";
import { createConfigFileStore } from "../src/mcp-setup/config-file-store.js";
import { DETECTED_FOLDERS, SEEDED_CONFIGS, seedSetupHome, setupSmokeEnv, stubScript, writableInHome } from "../smoke/setup-home.mts";

describe("SEEDED_CONFIGS", () => {
  it("seeds the four JSON-file clients with another server and other top-level keys, as 2-space JSON with a final newline", () => {
    expect(SEEDED_CONFIGS.map((config) => [config.client, config.file, config.keyPath])).toEqual([
      ["claude-desktop", ".config/Claude/claude_desktop_config.json", ["mcpServers"]],
      ["cursor", ".cursor/mcp.json", ["mcpServers"]],
      ["vscode", ".config/Code/User/mcp.json", ["servers"]],
      ["vscode-insiders", ".config/Code - Insiders/User/mcp.json", ["servers"]],
    ]);
    for (const config of SEEDED_CONFIGS) {
      const value = JSON.parse(config.text) as Record<string, Record<string, unknown>>;
      expect(config.text).toBe(`${JSON.stringify(value, null, 2)}\n`);
      expect(Object.keys(value).length, config.file).toBeGreaterThan(1);
      expect(Object.keys(value[config.keyPath[0]!]!).length, config.file).toBeGreaterThan(0);
      expect(value[config.keyPath[0]!]!["agent-cost-analyzer"]).toBeUndefined();
    }
  });
});

describe("writableInHome", () => {
  it("is the seeded files, their backups and the files the stubs write", () => {
    expect(writableInHome()).toEqual([
      ".config/Claude/claude_desktop_config.json",
      ".config/Claude/claude_desktop_config.json.agent-cost-analyzer.bak",
      ".cursor/mcp.json",
      ".cursor/mcp.json.agent-cost-analyzer.bak",
      ".config/Code/User/mcp.json",
      ".config/Code/User/mcp.json.agent-cost-analyzer.bak",
      ".config/Code - Insiders/User/mcp.json",
      ".config/Code - Insiders/User/mcp.json.agent-cost-analyzer.bak",
      ".claude.json",
      ".gemini/settings.json",
      ".codex/config.toml",
    ]);
  });
});

describe("stubScript", () => {
  it("is a script for this Node that imports the stub module and calls it", () => {
    expect(stubScript("/opt/node/bin/node", "file:///r/client-stubs.mts", { name: "clientStubMain", args: ["claude", "/l/claude.jsonl"] })).toBe(
      '#!/opt/node/bin/node\n// A stand-in for the smoke (packages/cli/smoke/client-stubs.mts).\nimport("file:///r/client-stubs.mts").then((stubs) => stubs.clientStubMain("claude", "/l/claude.jsonl"));\n',
    );
  });

  it("passes object arguments as literals", () => {
    expect(stubScript("/n", "file:///s.mts", { name: "npxStubMain", args: [{ logFile: "/l/npx.log", bin: "/b", version: "1.0.0" }] })).toContain(
      'stubs.npxStubMain({"logFile":"/l/npx.log","bin":"/b","version":"1.0.0"}));\n',
    );
  });

  it("escapes characters that could end the literal or the line in the module URL and arguments", () => {
    const script = stubScript("/n", "file:///a</script>\u2028.mts", { name: "clientStubMain", args: ["x\u2029", "/l/<b>"] });
    expect(script).toContain('import("file:///a\\u003C/script\\u003E\\u2028.mts")');
    expect(script).toContain('stubs.clientStubMain("x\\u2029", "/l/\\u003Cb\\u003E")');
    expect(script.split("\n")).toHaveLength(4);
  });

  it("rejects a Node path that would break the shebang line", () => {
    expect(() => stubScript("/n\nprocess.exit()", "file:///s.mts", { name: "clientStubMain", args: [] })).toThrow(/Node path/);
  });
});

describe("setupSmokeEnv", () => {
  const base = { PATH: "/usr/bin", HOME: "/real", CODEX_HOME: "/real/.codex", GEMINI_CLI_HOME: "/real", npm_config_x: "1", KEEP: "yes" };

  it("puts the home in the temporary folder, the stubs first on PATH, and drops variables that point a client elsewhere", () => {
    const env = setupSmokeEnv(base, { home: "/t/home", npmCache: "/t/cache", pathFirst: ["/t/bin"] });
    expect(env).toMatchObject({ HOME: "/t/home", XDG_CONFIG_HOME: "/t/home/.config", PATH: "/t/bin:/usr/bin", KEEP: "yes", npm_config_cache: "/t/cache" });
    expect(env.CODEX_HOME).toBeUndefined();
    expect(env.GEMINI_CLI_HOME).toBeUndefined();
    expect(env.npm_config_x).toBeUndefined();
  });
});

describe("seedSetupHome", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "aca-setup-home-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("makes every client detected by its folder and writes the seeded bytes", async () => {
    seedSetupHome(home);
    for (const folder of DETECTED_FOLDERS) expect(statSync(path.join(home, folder)).isDirectory(), folder).toBe(true);
    for (const config of SEEDED_CONFIGS) expect(readFileSync(path.join(home, config.file), "utf8")).toBe(config.text);
    // The product's own detection agrees (with no CLI on PATH).
    const env = createClientEnv({ platform: "linux", home, cwd: home, env: { PATH: "", XDG_CONFIG_HOME: path.join(home, ".config") } });
    const detected = [];
    for (const target of createClientTargets({ store: createConfigFileStore() })) if (await target.detect(env)) detected.push(target.id);
    expect(detected).toEqual(["claude-desktop", "cursor", "vscode", "vscode-insiders", "codex", "gemini"]);
  });
});
