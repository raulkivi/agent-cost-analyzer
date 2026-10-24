import path from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_SERVER_USAGE, parseMcpServerArgs } from "./mcp-server-args.js";

const USER_DATA_DIR = "/home/u/.config/Code";

// A user-data dir is only accepted when it has VS Code's User folder.
const hasUserDir = (dir: string) => dir === path.posix.join(USER_DATA_DIR, "User");
const deps = { isDirectory: hasUserDir, pathApi: path.posix };

describe("parseMcpServerArgs (the extension's MCP child process, vscode-extension.md D7)", () => {
  it("accepts --user-data-dir with VS Code's user-data dir", () => {
    expect(parseMcpServerArgs(["--user-data-dir", USER_DATA_DIR], deps)).toEqual({ ok: true, userDataDir: USER_DATA_DIR });
  });

  it("accepts a Windows user-data dir with Windows path rules", () => {
    const dir = "C:\\Users\\x\\AppData\\Roaming\\Code";
    const windows = { isDirectory: (candidate: string) => candidate === `${dir}\\User`, pathApi: path.win32 };

    expect(parseMcpServerArgs(["--user-data-dir", dir], windows)).toEqual({ ok: true, userDataDir: dir });
  });

  it.each([
    ["no arguments", []],
    ["the flag without a value", ["--user-data-dir"]],
    ["a flag as the value", ["--user-data-dir", "--inspect"]],
    ["the flag twice", ["--user-data-dir", USER_DATA_DIR, "--user-data-dir", USER_DATA_DIR]],
    ["an unknown flag", ["--user-data-dir", USER_DATA_DIR, "--write"]],
    ["a stray value", [USER_DATA_DIR]],
    ["the =value form", [`--user-data-dir=${USER_DATA_DIR}`]],
  ])("rejects %s with the usage", (_label, argv) => {
    const result = parseMcpServerArgs(argv, deps);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(MCP_SERVER_USAGE);
  });

  it.each([
    ["an empty path", ""],
    ["a relative path", ".config/Code"],
    ["a path with .. segments", "/home/u/.config/Code/../../../etc"],
    ["a path that isn't normalized", "/home/u//.config/Code"],
    ["a trailing separator", "/home/u/.config/Code/"],
    ["the root", "/"],
    ["a NUL byte", "/home/u/.config/Code\0/x"],
    ["a control character", "/home/u/.config/Code\n"],
  ])("rejects %s as the user-data dir", (_label, dir) => {
    const result = parseMcpServerArgs(["--user-data-dir", dir], { ...deps, isDirectory: () => true });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/absolute, normalized path/);
  });

  it("rejects a directory without VS Code's User folder, naming it", () => {
    const result = parseMcpServerArgs(["--user-data-dir", "/tmp/elsewhere"], deps);

    expect(result).toEqual({ ok: false, error: expect.stringContaining('"/tmp/elsewhere" has no User folder') });
  });

  it("never echoes control characters from a rejected path into the message", () => {
    const result = parseMcpServerArgs(["--user-data-dir", "/x\u001b[2J"], { ...deps, isDirectory: () => true });

    const codes = [...(!result.ok ? result.error : "")].map((character) => character.charCodeAt(0));
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((code) => code < 0x20 || code === 0x7f)).toEqual([]);
  });
});
