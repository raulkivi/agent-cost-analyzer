// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { configCommand } from "../../src/mcp-setup/config-command.js";
import type { RegistrationStatus } from "../../src/mcp-setup/mcp-client-target.js";
import { statusCommand } from "../../src/mcp-setup/status-command.js";
import { fakeTarget, harness } from "./fake-setup-deps.js";

const joined = (lines: string[]) => lines.join("");

function withStatus(id: "claude-code" | "cursor", status: RegistrationStatus) {
  const target = fakeTarget(id, {
    label: id === "cursor" ? "Cursor" : "Claude Code",
  });
  target.status = async () => status;
  return target;
}

describe("status", () => {
  it("prints one line per known client", async () => {
    const h = harness([
      withStatus("claude-code", {
        kind: "registered",
        launch: { pinned: "1.0.0" },
        matches: false,
      }),
      withStatus("cursor", { kind: "not-detected" }),
    ]);
    expect(
      await statusCommand({ kind: "mcp-status", scope: "user" }, h.deps),
    ).toBe(0);
    const lines = joined(h.out).split("\n").filter(Boolean);
    expect(lines).toHaveLength(7);
    expect(lines[0]).toMatch(/^Claude Code\s+registered \(pinned 1\.0\.0\)$/);
    expect(lines[2]).toMatch(/^Cursor\s+not detected$/);
    expect(lines[3]).toMatch(/^vscode\s+not supported yet$/);
    expect(lines[4]).toMatch(/^vscode-insiders\s+not supported yet$/);
  });

  it.each([
    [
      { kind: "registered", launch: "latest", matches: true },
      "registered (latest)",
    ],
    [
      { kind: "registered", launch: "custom", matches: false },
      "registered (differs)",
    ],
    [{ kind: "not-registered" }, "not registered"],
    [{ kind: "unreadable", message: "bad" }, "unreadable: bad"],
    [
      { kind: "provided-by-extension" },
      "provided by the AI Credits Analyzer extension",
    ],
    [{ kind: "registered-unverified" }, "registered, launch unknown"],
    [{ kind: "something-new" }, "something-new"],
  ] as [RegistrationStatus, string][])(
    "words %j as %s",
    async (status, words) => {
      const h = harness([withStatus("cursor", status)]);
      await statusCommand({ kind: "mcp-status", scope: "user" }, h.deps);
      expect(joined(h.out)).toContain(`Cursor`);
      expect(joined(h.out)).toContain(words);
    },
  );

  it("marks clients without the requested scope", async () => {
    const h = harness([withStatus("cursor", { kind: "not-registered" })]);
    await statusCommand({ kind: "mcp-status", scope: "local" }, h.deps);
    expect(joined(h.out)).toMatch(/Cursor\s+no local scope/);
  });

  it("exits 1 when a status read throws", async () => {
    const t = fakeTarget("cursor");
    t.status = async () => {
      throw new Error("EACCES");
    };
    const h = harness([t]);
    expect(
      await statusCommand({ kind: "mcp-status", scope: "user" }, h.deps),
    ).toBe(1);
    expect(joined(h.out)).toContain("error: EACCES");
  });
});

describe("config", () => {
  const config = (client: "claude-code" | "cursor" | "codex" | "vscode") => ({
    kind: "mcp-config" as const,
    client,
    scope: "user" as const,
    pin: false,
    projectBillingDetails: false,
  });

  it("prints the command for Claude Code", async () => {
    const h = harness([]);
    expect(configCommand(config("claude-code"), h.deps)).toBe(0);
    expect(joined(h.out)).toContain(
      "claude mcp add --scope user agent-cost-analyzer -- npx -y --prefer-offline agent-cost-analyzer mcp",
    );
  });

  it("prints the whole JSON file shape and the install link for Cursor", async () => {
    const h = harness([]);
    configCommand(config("cursor"), h.deps);
    const out = joined(h.out);
    const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
    expect(JSON.parse(json)).toEqual({
      mcpServers: {
        "agent-cost-analyzer": {
          command: "npx",
          args: ["-y", "--prefer-offline", "agent-cost-analyzer", "mcp"],
        },
      },
    });
    expect(out).toContain("cursor://anysphere.cursor-deeplink/mcp/install");
  });

  it("prints the TOML table for Codex and quotes the VS Code JSON argument", async () => {
    const h = harness([]);
    configCommand(config("codex"), h.deps);
    expect(joined(h.out)).toContain("[mcp_servers.agent-cost-analyzer]");
    const v = harness([]);
    configCommand(config("vscode"), v.deps);
    expect(joined(v.out)).toContain("code --add-mcp '{");
    expect(joined(v.out)).toContain('"servers"');
  });

  it("honors --pin with the running version", async () => {
    const h = harness([]);
    configCommand({ ...config("claude-code"), pin: true }, h.deps);
    expect(joined(h.out)).toContain("agent-cost-analyzer@1.2.3");
  });

  it("exits 1 when pinning a non-semver version", async () => {
    const h = harness([]);
    h.deps.version = "dev";
    expect(configCommand({ ...config("claude-code"), pin: true }, h.deps)).toBe(
      1,
    );
    expect(joined(h.err)).toContain("Cannot pin");
  });
});
