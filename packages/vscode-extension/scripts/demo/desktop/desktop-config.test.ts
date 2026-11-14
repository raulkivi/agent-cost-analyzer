// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { buildDesktopConfig } from "./desktop-config.mts";

const opts = { serverScript: "/repo/scripts/mcp-server.sh", home: "/tmp/h", now: "2026-11-06T12:00:00.000Z" };

describe("buildDesktopConfig", () => {
  it("creates the config when none exists", () => {
    expect(buildDesktopConfig(undefined, opts)).toEqual({
      mcpServers: {
        "ai-credits-analyzer": {
          command: "/repo/scripts/mcp-server.sh",
          env: {
            HOME: "/tmp/h",
            USERPROFILE: "/tmp/h",
            XDG_CONFIG_HOME: "/tmp/h/.config",
            AGENT_COST_ANALYZER_NOW: "2026-11-06T12:00:00.000Z",
          },
        },
      },
    });
  });
  it("drops every other MCP server and keeps every other key", () => {
    const existing = {
      theme: "light",
      preferences: { a: 1 },
      mcpServers: { github: { command: "gh" }, "ai-credits-analyzer": { command: "old" } },
    };
    const out = buildDesktopConfig(existing, opts);
    expect(Object.keys(out.mcpServers as object)).toEqual(["ai-credits-analyzer"]);
    expect(out.theme).toBe("light");
    expect(out.preferences).toEqual({ a: 1 });
    expect((out.mcpServers as Record<string, { command: string }>)["ai-credits-analyzer"].command).toBe(opts.serverScript);
  });
  it("does not mutate its input", () => {
    const existing = { mcpServers: { x: { command: "x" } } };
    buildDesktopConfig(existing, opts);
    expect(existing).toEqual({ mcpServers: { x: { command: "x" } } });
  });
});
