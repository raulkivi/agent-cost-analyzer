// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/args.js";

const parse = (...argv: string[]) => parseCliArgs(["mcp", ...argv]);

describe("mcp setup subcommands", () => {
  it("keeps bare mcp and its flags as the server", () => {
    expect(parse()).toEqual({ kind: "mcp", projectBillingDetails: false });
  });

  it("still rejects unknown flags after mcp", () => {
    expect(parse("--bogus").kind).toBe("error");
    expect(parse("remove").kind).toBe("error");
  });

  it("parses install defaults: detected clients, user scope", () => {
    expect(parse("install")).toEqual({
      kind: "mcp-install",
      clients: { kind: "detected" },
      scope: "user",
      pin: false,
      projectBillingDetails: false,
      dryRun: false,
      yes: false,
    });
  });

  it("parses install with every flag", () => {
    expect(
      parse(
        "install",
        "--client",
        "cursor,claude-code",
        "--scope",
        "project",
        "--pin",
        "--project-billing-details",
        "--dry-run",
      ),
    ).toEqual({
      kind: "mcp-install",
      clients: { kind: "ids", ids: ["cursor", "claude-code"] },
      scope: "project",
      pin: true,
      projectBillingDetails: true,
      dryRun: true,
      yes: false,
    });
  });

  it("parses --client all and --yes", () => {
    expect(parse("install", "--client=all", "--yes")).toMatchObject({
      clients: { kind: "all" },
      yes: true,
    });
  });

  it("parses uninstall and status", () => {
    expect(
      parse("uninstall", "--client", "gemini", "--scope", "local"),
    ).toMatchObject({ kind: "error" });
    expect(
      parse("uninstall", "--client", "claude-code", "--scope", "local"),
    ).toMatchObject({ kind: "mcp-uninstall", scope: "local" });
    expect(parse("status")).toEqual({ kind: "mcp-status", scope: "user" });
    expect(parse("status", "--scope", "project")).toEqual({
      kind: "mcp-status",
      scope: "project",
    });
  });

  it("parses config with exactly one client", () => {
    expect(parse("config", "--client", "codex", "--pin")).toEqual({
      kind: "mcp-config",
      client: "codex",
      scope: "user",
      pin: true,
      projectBillingDetails: false,
    });
  });

  it.each([
    ["config"],
    ["config", "--client", "cursor,codex"],
    ["config", "--client", "all"],
    ["install", "--client", "nope"],
    ["install", "--client", "cursor,"],
    ["install", "--scope", "global"],
    ["install", "--yes", "--dry-run"],
    ["install", "--client", "cursor", "--scope", "local"],
    ["install", "--bogus"],
    ["install", "extra"],
    ["uninstall", "--pin"],
    ["status", "--client", "cursor"],
  ])("rejects %j", (...argv) => {
    expect(parse(...argv).kind).toBe("error");
  });
});
