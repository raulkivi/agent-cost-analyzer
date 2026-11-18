// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  cmdInvocation,
  isSafeCmdArg,
} from "../../src/mcp-setup/windows-command.js";

describe("isSafeCmdArg", () => {
  it.each([
    "npx",
    "-y",
    "agent-cost-analyzer@1.0.0",
    "--scope",
    "a=b",
    "x,y",
    "/c",
  ])("accepts %s", (arg) => expect(isSafeCmdArg(arg)).toBe(true));
  it.each([
    "",
    "a b",
    "a&b",
    "a|b",
    "a^b",
    "%PATH%",
    '"x"',
    "a;b",
    "<x",
    "{}",
    "a'b",
    "$x",
  ])("rejects %j", (arg) => expect(isSafeCmdArg(arg)).toBe(false));
});

describe("cmdInvocation", () => {
  const shim = "C:\\Program Files\\nodejs\\claude.cmd";

  it("runs the shim through cmd.exe with one verbatim, quoted line", () => {
    expect(cmdInvocation(shim, ["mcp", "add", "--scope", "user"])).toEqual({
      file: "cmd.exe",
      args: ["/d", "/s", "/c", `""${shim}" mcp add --scope user"`],
      verbatim: true,
    });
  });

  it("names the first unsafe argument and points at mcp config", () => {
    const result = cmdInvocation(shim, ["--add-mcp", '{"name":"x"}']);
    expect(result).toEqual({ error: expect.stringContaining('{"name":"x"}') });
    expect((result as { error: string }).error).toContain("mcp config");
  });

  it("refuses a shim path that cmd would expand or break", () => {
    expect("error" in cmdInvocation("C:\\a%b\\x.cmd", ["mcp"])).toBe(true);
    expect("error" in cmdInvocation('C:\\a"b\\x.cmd', ["mcp"])).toBe(true);
  });
});
