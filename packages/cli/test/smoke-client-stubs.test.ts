// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The mcp-setup smoke's stand-ins for the claude, gemini and codex CLIs and
// for npx (mcp-client-setup.md §7, MC7): what each one does to its config
// file, in the formats MC0 recorded (§3.2).
import { describe, expect, it } from "vitest";
import { findCodexServerTable } from "../src/mcp-setup/codex-config.js";
import { npxForward, runClientStub, stubConfigFile } from "../smoke/client-stubs.mts";

const NAME = "agent-cost-analyzer";
const LAUNCH = ["npx", "-y", "--prefer-offline", NAME, "mcp"];
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe("stubConfigFile", () => {
  it("is the file each real CLI keeps its user-scope servers in", () => {
    expect(stubConfigFile("claude", "/h")).toBe("/h/.claude.json");
    expect(stubConfigFile("gemini", "/h")).toBe("/h/.gemini/settings.json");
    expect(stubConfigFile("codex", "/h")).toBe("/h/.codex/config.toml");
  });
});

describe("runClientStub claude", () => {
  const add = ["mcp", "add", "--scope", "user", NAME, "--", ...LAUNCH];
  const remove = ["mcp", "remove", "--scope", "user", NAME];

  it("adds a stdio entry under the top-level mcpServers, creating the file", () => {
    expect(runClientStub("claude", add, undefined)).toEqual({
      code: 0,
      stderr: "",
      text: json({ mcpServers: { [NAME]: { type: "stdio", command: "npx", args: LAUNCH.slice(1), env: {} } } }),
    });
  });

  it("keeps the other keys and servers", () => {
    const before = json({ numStartups: 3, mcpServers: { other: { type: "stdio", command: "x", args: [], env: {} } } });
    const after = JSON.parse(runClientStub("claude", add, before).text ?? "");
    expect(Object.keys(after)).toEqual(["numStartups", "mcpServers"]);
    expect(Object.keys(after.mcpServers)).toEqual(["other", NAME]);
  });

  it("refuses a name that exists, as the real CLI does", () => {
    const once = runClientStub("claude", add, undefined).text;
    expect(runClientStub("claude", add, once)).toEqual({ code: 1, stderr: expect.stringMatching(/already exists/), text: undefined });
  });

  it("removes the entry and leaves mcpServers empty", () => {
    const once = runClientStub("claude", add, undefined).text;
    expect(runClientStub("claude", remove, once)).toEqual({ code: 0, stderr: "", text: json({ mcpServers: {} }) });
  });

  it("fails to remove a name that is not there", () => {
    expect(runClientStub("claude", remove, undefined)).toEqual({ code: 1, stderr: expect.stringMatching(/No MCP server named "agent-cost-analyzer"/), text: undefined });
  });

  it("rejects any other argv, so an unexpected call fails the smoke", () => {
    for (const argv of [["mcp", "add", NAME, "--", ...LAUNCH], ["mcp", "get", NAME], ["mcp", "add", "--scope", "user", NAME, ...LAUNCH], []]) {
      expect(runClientStub("claude", argv, undefined), argv.join(" ")).toEqual({ code: 2, stderr: expect.stringMatching(/stub/), text: undefined });
    }
  });
});

describe("runClientStub gemini", () => {
  const add = ["mcp", "add", "-s", "user", NAME, ...LAUNCH];
  const remove = ["mcp", "remove", "-s", "user", NAME];

  it("adds {command, args} under mcpServers in settings.json, keeping other keys", () => {
    const before = json({ theme: "Default" });
    expect(runClientStub("gemini", add, before).text).toBe(json({ theme: "Default", mcpServers: { [NAME]: { command: "npx", args: LAUNCH.slice(1) } } }));
  });

  it("removes the entry, and fails when it is absent", () => {
    const once = runClientStub("gemini", add, undefined).text;
    expect(runClientStub("gemini", remove, once)).toEqual({ code: 0, stderr: "", text: json({ mcpServers: {} }) });
    expect(runClientStub("gemini", remove, undefined)).toMatchObject({ code: 1, text: undefined });
  });

  it("rejects argv without -s", () => {
    expect(runClientStub("gemini", ["mcp", "add", NAME, ...LAUNCH], undefined)).toMatchObject({ code: 2, text: undefined });
  });
});

describe("runClientStub codex", () => {
  const add = ["mcp", "add", NAME, "--", ...LAUNCH];
  const table = `[mcp_servers.${NAME}]\ncommand = "npx"\nargs = ["-y", "--prefer-offline", "${NAME}", "mcp"]\n`;

  it("writes a [mcp_servers.<name>] table with one-line command and args", () => {
    expect(runClientStub("codex", add, undefined)).toEqual({ code: 0, stderr: "", text: table });
  });

  it("appends after the existing tables, which the adapter's reader then finds", () => {
    const text = runClientStub("codex", add, 'model = "o3"\n').text ?? "";
    expect(text).toBe(`model = "o3"\n\n${table}`);
    expect(findCodexServerTable(text)).toEqual({ command: "npx", args: LAUNCH.slice(1) });
  });

  it("refuses a table that exists, and has no remove command", () => {
    expect(runClientStub("codex", add, table)).toMatchObject({ code: 1, text: undefined });
    expect(runClientStub("codex", ["mcp", "remove", NAME], table)).toMatchObject({ code: 2, text: undefined });
  });
});

describe("npxForward", () => {
  it("passes on what follows the package name, for the latest or the pinned version", () => {
    expect(npxForward(["-y", "--prefer-offline", NAME, "mcp"], "1.2.3")).toEqual({ ok: true, args: ["mcp"] });
    expect(npxForward(["-y", "--prefer-offline", `${NAME}@1.2.3`, "mcp", "--project-billing-details"], "1.2.3")).toEqual({
      ok: true,
      args: ["mcp", "--project-billing-details"],
    });
  });

  it("refuses anything else, so a launch spec that would reach the registry differently fails", () => {
    for (const argv of [
      ["--prefer-offline", NAME, "mcp"],
      ["-y", NAME, "mcp"],
      ["-y", "--prefer-offline", `${NAME}@9.9.9`, "mcp"],
      ["-y", "--prefer-offline", "other-package", "mcp"],
      ["-y", "--prefer-offline", NAME],
      ["-y", "--prefer-offline", NAME, "serve"],
    ]) {
      expect(npxForward(argv, "1.2.3"), argv.join(" ")).toEqual({ ok: false, message: expect.stringContaining("npx stub") });
    }
  });
});
