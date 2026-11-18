// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  MCP_CLIENT_IDS,
  clientSetup,
  supportedScopes,
  type McpClientId,
  type McpScope,
} from "./client-setup.js";
import { MCP_SERVER_NAME } from "./launch-spec.js";

const NAME = MCP_SERVER_NAME;
const opts = (o: Partial<Parameters<typeof clientSetup>[1]> = {}) => ({
  version: "1.0.0",
  pin: false,
  projectBillingDetails: false,
  platform: "linux" as NodeJS.Platform,
  scope: "user" as McpScope,
  ...o,
});
const plain = ["-y", "--prefer-offline", "agent-cost-analyzer", "mcp"];
const ALL_SCOPES = ["user", "project", "local"] as const;

describe("client ids and scopes", () => {
  it("lists clients in order", () => {
    expect(MCP_CLIENT_IDS).toEqual([
      "claude-code",
      "claude-desktop",
      "cursor",
      "vscode",
      "codex",
      "gemini",
    ]);
  });

  it.each<[McpClientId, McpScope[]]>([
    ["claude-code", ["user", "project", "local"]],
    ["cursor", ["user", "project"]],
    ["gemini", ["user", "project"]],
    ["claude-desktop", ["user"]],
    ["vscode", ["user"]],
    ["codex", ["user"]],
  ])("%s supports %j", (client, scopes) => {
    expect(supportedScopes(client)).toEqual(scopes);
  });

  it.each(MCP_CLIENT_IDS.flatMap((c) => ALL_SCOPES.map((s) => [c, s] as const)))(
    "%s with scope %s throws only when unsupported",
    (client, scope) => {
      const call = () => clientSetup(client, opts({ scope }));
      if (supportedScopes(client).includes(scope)) expect(call).not.toThrow();
      else expect(call).toThrow(/scope/i);
    },
  );
});

describe("claude-code", () => {
  it.each(ALL_SCOPES)("builds add/remove argv for %s", (scope) => {
    const s = clientSetup("claude-code", opts({ scope }));
    expect(s.command).toEqual(["claude", "mcp", "add", "--scope", scope, NAME, "--", "npx", ...plain]);
    expect(s.remove).toEqual(["claude", "mcp", "remove", "--scope", scope, NAME]);
  });

  it("emits .mcp.json shape for project scope only", () => {
    expect(clientSetup("claude-code", opts({ scope: "project" })).json).toEqual({
      keyPath: ["mcpServers"],
      name: NAME,
      entry: { type: "stdio", command: "npx", args: plain, env: {} },
    });
    expect(clientSetup("claude-code", opts({ scope: "user" })).json).toBeUndefined();
  });

  it("wraps with cmd /c on win32", () => {
    const s = clientSetup(
      "claude-code",
      opts({ platform: "win32", pin: true, projectBillingDetails: true }),
    );
    expect(s.launch.command).toBe("cmd");
    expect(s.command).toEqual([
      "claude", "mcp", "add", "--scope", "user", NAME, "--",
      "cmd", "/c", "npx", "-y", "--prefer-offline", "agent-cost-analyzer@1.0.0", "mcp",
      "--project-billing-details",
    ]);
  });
});

describe("other clients never wrap on win32", () => {
  it.each(MCP_CLIENT_IDS.filter((c) => c !== "claude-code"))("%s", (client) => {
    expect(clientSetup(client, opts({ platform: "win32" })).launch.command).toBe("npx");
  });
});

describe("claude-desktop", () => {
  it("merges into mcpServers", () => {
    const s = clientSetup("claude-desktop", opts());
    expect(s.json).toEqual({ keyPath: ["mcpServers"], name: NAME, entry: { command: "npx", args: plain } });
    expect(s.command).toBeUndefined();
  });
});

describe("cursor", () => {
  it.each(["user", "project"] as const)("merges into mcpServers (%s)", (scope) => {
    const s = clientSetup("cursor", opts({ scope }));
    expect(s.json).toEqual({ keyPath: ["mcpServers"], name: NAME, entry: { command: "npx", args: plain } });
  });

  it("builds an install link that round-trips", () => {
    const s = clientSetup("cursor", opts({ pin: true, projectBillingDetails: true }));
    const prefix = `cursor://anysphere.cursor-deeplink/mcp/install?name=${NAME}&config=`;
    expect(s.installLink?.startsWith(prefix)).toBe(true);
    const b64 = decodeURIComponent(s.installLink!.slice(prefix.length));
    expect(JSON.parse(Buffer.from(b64, "base64").toString("utf8"))).toEqual({
      command: "npx",
      args: ["-y", "--prefer-offline", "agent-cost-analyzer@1.0.0", "mcp", "--project-billing-details"],
    });
  });

  it("percent-encodes base64 padding and plus signs", () => {
    const link = clientSetup("cursor", opts()).installLink!;
    expect(link.slice(link.indexOf("config=") + 7)).not.toMatch(/[+/=]/);
  });
});

describe("vscode", () => {
  it("uses --add-mcp and the servers key", () => {
    const s = clientSetup("vscode", opts());
    expect(s.command).toEqual([
      "code",
      "--add-mcp",
      JSON.stringify({ name: NAME, type: "stdio", command: "npx", args: plain }),
    ]);
    expect(s.json).toEqual({
      keyPath: ["servers"],
      name: NAME,
      entry: { type: "stdio", command: "npx", args: plain },
    });
    expect(s.installLink).toBeUndefined();
  });
});

describe("codex", () => {
  it("builds add argv and a TOML table, with no remove", () => {
    const s = clientSetup("codex", opts());
    expect(s.command).toEqual(["codex", "mcp", "add", NAME, "--", "npx", ...plain]);
    expect(s.remove).toBeUndefined();
    expect(s.toml).toBe(
      `[mcp_servers.${NAME}]\ncommand = "npx"\nargs = [${plain.map((a) => `"${a}"`).join(", ")}]\n`,
    );
  });
});

describe("gemini", () => {
  it.each(["user", "project"] as const)("builds argv for %s", (scope) => {
    const s = clientSetup("gemini", opts({ scope }));
    expect(s.command).toEqual(["gemini", "mcp", "add", "-s", scope, NAME, "npx", ...plain]);
    expect(s.remove).toEqual(["gemini", "mcp", "remove", "-s", scope, NAME]);
  });
});

describe("flag combinations", () => {
  const combos = MCP_CLIENT_IDS.flatMap((c) =>
    [false, true].flatMap((pin) => [false, true].map((b) => [c, pin, b] as const)),
  );
  it.each(combos)("%s pin=%s billing=%s reaches launch", (client, pin, projectBillingDetails) => {
    const s = clientSetup(client, opts({ pin, projectBillingDetails }));
    expect(s.client).toBe(client);
    expect(s.scope).toBe("user");
    expect(s.launch.args.includes("agent-cost-analyzer@1.0.0")).toBe(pin);
    expect(s.launch.args.includes("--project-billing-details")).toBe(projectBillingDetails);
  });
});
