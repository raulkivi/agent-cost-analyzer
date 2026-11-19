// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { mcpSetupResponseSchema } from "@agent-cost-analyzer/domain";
import { MCP_CLIENT_IDS } from "./client-setup.js";
import { displayConfigPath, mcpSetupResponse } from "./setup-response.js";

const linux = { platform: "linux" as const, home: "/home/alice", env: {} };
const build = (o: Partial<Parameters<typeof mcpSetupResponse>[0]> = {}) =>
  mcpSetupResponse({ version: "1.2.3", ...linux, ...o });
const client = (id: string, o: Parameters<typeof build>[0] = {}) =>
  build(o).clients.find((c) => c.id === id)!;

const ENTRY = { command: "npx", args: ["-y", "--prefer-offline", "agent-cost-analyzer", "mcp"] };

describe("mcpSetupResponse", () => {
  it("is schema-valid, in client order, with the version", () => {
    const response = build();
    expect(mcpSetupResponseSchema.parse(response)).toEqual(response);
    expect(response.version).toBe("1.2.3");
    expect(response.clients.map((c) => c.id)).toEqual([...MCP_CLIENT_IDS]);
  });

  it("labels and gives the install command per client", () => {
    expect(build().clients.map((c) => [c.label, c.installCommand])).toEqual([
      ["Claude Code", "npx agent-cost-analyzer mcp install --client claude-code"],
      ["Claude Desktop", "npx agent-cost-analyzer mcp install --client claude-desktop"],
      ["Cursor", "npx agent-cost-analyzer mcp install --client cursor"],
      ["VS Code", "npx agent-cost-analyzer mcp install --client vscode"],
      ["VS Code Insiders", "npx agent-cost-analyzer mcp install --client vscode-insiders"],
      ["Codex CLI", "npx agent-cost-analyzer mcp install --client codex"],
      ["Gemini CLI", "npx agent-cost-analyzer mcp install --client gemini"],
    ]);
  });

  it("is unpinned: no version in the launch", () => {
    expect(JSON.stringify(build({ version: "9.9.9" }).clients)).not.toContain("9.9.9");
  });

  it("prints a one-line user-scope command for the CLI clients", () => {
    expect(client("claude-code").manual).toEqual({
      kind: "command",
      command: "claude mcp add --scope user agent-cost-analyzer -- npx -y --prefer-offline agent-cost-analyzer mcp",
    });
    expect(client("codex").manual).toEqual({
      kind: "command",
      command: "codex mcp add agent-cost-analyzer -- npx -y --prefer-offline agent-cost-analyzer mcp",
    });
    expect(client("gemini").manual).toEqual({
      kind: "command",
      command: "gemini mcp add -s user agent-cost-analyzer npx -y --prefer-offline agent-cost-analyzer mcp",
    });
  });

  it("wraps npx in cmd /c for Claude Code on Windows only", () => {
    const win = { platform: "win32" as const, home: "C:\\Users\\alice", env: {} };
    expect((client("claude-code", win).manual as { command: string }).command).toContain("cmd /c npx");
    expect((client("codex", win).manual as { command: string }).command).not.toContain("cmd");
  });

  it("prints the whole file as 2-space JSON for the file clients", () => {
    const manual = client("claude-desktop").manual;
    expect(manual).toEqual({
      kind: "json",
      path: "~/.config/Claude/claude_desktop_config.json",
      json: JSON.stringify({ mcpServers: { "agent-cost-analyzer": ENTRY } }, null, 2),
    });
    expect((manual as { json: string }).json).toContain('\n  "mcpServers": {');
  });

  it("uses the servers key and a stdio type for VS Code", () => {
    const manual = client("vscode").manual as { json: string; path: string };
    expect(JSON.parse(manual.json)).toEqual({
      servers: { "agent-cost-analyzer": { type: "stdio", ...ENTRY } },
    });
    expect(manual.path).toBe("~/.config/Code/User/mcp.json");
    expect((client("vscode-insiders").manual as { path: string }).path).toBe(
      "~/.config/Code - Insiders/User/mcp.json",
    );
  });

  it("gives an install link for Cursor only", () => {
    expect(client("cursor").installLink).toMatch(/^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=agent-cost-analyzer&config=/);
    expect(client("cursor").manual).toMatchObject({ kind: "json", path: "~/.cursor/mcp.json" });
    expect(build().clients.filter((c) => c.installLink).map((c) => c.id)).toEqual(["cursor"]);
  });

  it.each([
    ["linux", "/home/alice", "/home/alice"],
    ["darwin", "/Users/alice", "/Users/alice"],
    ["win32", "C:\\Users\\alice", "alice"],
  ] as const)("never contains the home path or user name on %s", (platform, home, secret) => {
    const env = { XDG_CONFIG_HOME: `${home}/cfg`, APPDATA: `${home}\\AppData\\Roaming`, CODEX_HOME: `${home}/.codex` };
    const text = JSON.stringify(build({ platform, home, env }));
    expect(text).not.toContain(secret);
    expect(text).not.toContain(secret.replaceAll("\\", "\\\\"));
  });
});

describe("displayConfigPath", () => {
  const path = (platform: NodeJS.Platform, id: "claude-desktop" | "cursor" | "vscode", env = {}, home = "/home/alice") =>
    displayConfigPath(id, { platform, home, env });

  it("shows macOS paths under Library/Application Support", () => {
    expect(path("darwin", "claude-desktop", {}, "/Users/alice")).toBe(
      "~/Library/Application Support/Claude/claude_desktop_config.json",
    );
    expect(path("darwin", "vscode", {}, "/Users/alice")).toBe("~/Library/Application Support/Code/User/mcp.json");
  });

  it("shows Windows paths with %APPDATA% and %USERPROFILE%, whatever APPDATA is", () => {
    const home = "C:\\Users\\alice";
    expect(path("win32", "claude-desktop", { APPDATA: "D:\\Roam" }, home)).toBe(
      "%APPDATA%\\Claude\\claude_desktop_config.json",
    );
    expect(path("win32", "vscode", {}, home)).toBe("%APPDATA%\\Code\\User\\mcp.json");
    expect(path("win32", "cursor", {}, home)).toBe("%USERPROFILE%\\.cursor\\mcp.json");
  });

  it("honors XDG_CONFIG_HOME inside home, shown with ~", () => {
    expect(path("linux", "claude-desktop", { XDG_CONFIG_HOME: "/home/alice/cfg" })).toBe(
      "~/cfg/Claude/claude_desktop_config.json",
    );
    expect(path("linux", "vscode", { XDG_CONFIG_HOME: "/home/alice" })).toBe("~/Code/User/mcp.json");
  });

  it("ignores XDG_CONFIG_HOME outside home, relative or a sibling prefix", () => {
    for (const xdg of ["/etc/xdg", "relative/dir", "/home/alice2/cfg", "/home/alice/../bob"])
      expect(path("linux", "vscode", { XDG_CONFIG_HOME: xdg })).toBe("~/.config/Code/User/mcp.json");
  });
});
