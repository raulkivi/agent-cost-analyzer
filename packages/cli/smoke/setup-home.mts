// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The mcp-setup smoke's temporary home (mcp-client-setup.md §7, MC7): every
// client "detected" by its folder or by a stub CLI on PATH, three JSON
// configs seeded with another server, and the environment that keeps the
// installed bin, npm and the stubs inside it. Linux only (D13).
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BACKUP_SUFFIX } from "../src/mcp-setup/config-file-store.js";
import type { McpClientId } from "../../server/src/mcp/client-setup/client-setup.js";
import { stubConfigFile, type StubTool } from "./client-stubs.mts";
import { isolatedEnv } from "./processes.mts";

/** Folders that make the clients without a stub CLI detected (Claude Desktop, Cursor, VS Code), and Codex and Gemini as well. */
export const DETECTED_FOLDERS = [".config/Claude", ".cursor", ".config/Code/User", ".codex", ".gemini"] as const;

export const STUB_TOOLS: readonly StubTool[] = ["claude", "codex", "gemini"];

/** Where the AI Credits Analyzer extension would be unpacked (D6: VS Code then needs no entry). */
export const EXTENSION_FOLDER = ".vscode/extensions/raulkivi.ai-credits-analyzer-1.0.0";

export interface SeededConfig {
  client: Extract<McpClientId, "claude-desktop" | "cursor" | "vscode">;
  /** Relative to the home, "/" separators. */
  file: string;
  keyPath: readonly string[];
  text: string;
}

// The format the store keeps (2-space JSON, final newline), so uninstall can
// restore the original bytes.
const seeded = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Each JSON-file client's config with another server and other top-level keys, before the smoke runs. */
export const SEEDED_CONFIGS: readonly SeededConfig[] = [
  {
    client: "claude-desktop",
    file: ".config/Claude/claude_desktop_config.json",
    keyPath: ["mcpServers"],
    text: seeded({
      preferences: { menuBarEnabled: false, quickEntryShortcut: "off" },
      mcpServers: { filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] } },
      globalShortcut: "",
    }),
  },
  {
    client: "cursor",
    file: ".cursor/mcp.json",
    keyPath: ["mcpServers"],
    text: seeded({
      mcpServers: { "other-server": { command: "node", args: ["server.js"], env: { DEBUG: "1" } } },
      otherSetting: true,
    }),
  },
  {
    client: "vscode",
    file: ".config/Code/User/mcp.json",
    keyPath: ["servers"],
    text: seeded({
      inputs: [{ type: "promptString", id: "token", description: "API token", password: true }],
      servers: { github: { type: "http", url: "https://api.githubcopilot.com/mcp/" } },
    }),
  },
];

/** The only home files the setup commands and the stubs may change. */
export function writableInHome(): string[] {
  return [
    ...SEEDED_CONFIGS.flatMap((config) => [config.file, `${config.file}${BACKUP_SUFFIX}`]),
    ...(["claude", "gemini", "codex"] as const).map((tool) => path.posix.relative("/", stubConfigFile(tool, "/"))),
  ];
}

export function seedSetupHome(home: string): void {
  for (const folder of DETECTED_FOLDERS) mkdirSync(path.join(home, folder), { recursive: true });
  for (const config of SEEDED_CONFIGS) writeFileSync(path.join(home, config.file), config.text);
}

/** A stub executable: this Node runs it, and it hands over to a function of client-stubs.mts. */
export function stubScript(node: string, moduleUrl: string, call: string): string {
  // A dynamic import, so the extensionless file works as CommonJS or ESM.
  return `#!${node}\n// A stand-in for the smoke (packages/cli/smoke/client-stubs.mts).\nimport(${JSON.stringify(moduleUrl)}).then((stubs) => stubs.${call});\n`;
}

export function writeStub(dir: string, name: string, script: string): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, script);
  chmodSync(file, 0o755);
  return file;
}

// Would point Codex or Gemini at a folder outside the temporary home.
const CLIENT_HOMES = ["CODEX_HOME", "GEMINI_CLI_HOME"];

/** The serve smoke's isolated environment, without client home overrides, and with `pathFirst` ahead of PATH. */
export function setupSmokeEnv(
  base: Readonly<Record<string, string | undefined>>,
  options: { home: string; npmCache: string; pathFirst: readonly string[] },
): Record<string, string> {
  const env = isolatedEnv(base, { home: options.home, npmCache: options.npmCache, platform: "linux" });
  for (const name of CLIENT_HOMES) delete env[name];
  env.PATH = [...options.pathFirst, ...(env.PATH ?? "").split(path.delimiter).filter(Boolean)].join(path.delimiter);
  return env;
}
