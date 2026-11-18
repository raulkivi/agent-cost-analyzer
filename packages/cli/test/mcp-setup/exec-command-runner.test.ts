// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  createCommandRunner,
  type ExecFn,
} from "../../src/mcp-setup/exec-command-runner.js";

interface Call {
  file: string;
  args: readonly string[];
  verbatim: boolean;
}

function fakeExec(result: Awaited<ReturnType<ExecFn>> = { ok: true }) {
  const calls: Call[] = [];
  const exec: ExecFn = async (file, args, options) => {
    calls.push({ file, args, verbatim: options.verbatim });
    return result;
  };
  return { exec, calls };
}

describe("createCommandRunner on Linux", () => {
  it("runs the argv directly, without a shell", async () => {
    const { exec, calls } = fakeExec();
    const runner = createCommandRunner({ platform: "linux", env: {}, exec });
    expect(await runner.run("claude", ["mcp", "add", "x"])).toEqual({
      ok: true,
    });
    expect(calls).toEqual([
      { file: "claude", args: ["mcp", "add", "x"], verbatim: false },
    ]);
  });

  it("passes a failure message through", async () => {
    const { exec } = fakeExec({ ok: false, message: "exit 1: boom" });
    const runner = createCommandRunner({ platform: "linux", env: {}, exec });
    expect(await runner.run("claude", [])).toEqual({
      ok: false,
      message: "exit 1: boom",
    });
  });
});

describe("createCommandRunner on Windows", () => {
  const env = { Path: "C:\\bin;C:\\npm", PATHEXT: ".COM;.EXE;.CMD" };
  const files =
    (...present: string[]) =>
    async (path: string) =>
      present.includes(path);

  it("runs an .exe directly", async () => {
    const { exec, calls } = fakeExec();
    const runner = createCommandRunner({
      platform: "win32",
      env,
      exec,
      isFile: files("C:\\npm\\code.EXE"),
    });
    await runner.run("code", ["--version"]);
    expect(calls).toEqual([
      { file: "C:\\npm\\code.EXE", args: ["--version"], verbatim: false },
    ]);
  });

  it("wraps a .cmd shim in cmd.exe", async () => {
    const { exec, calls } = fakeExec();
    const runner = createCommandRunner({
      platform: "win32",
      env,
      exec,
      isFile: files("C:\\npm\\claude.CMD"),
    });
    await runner.run("claude", ["mcp", "remove", "x"]);
    expect(calls).toEqual([
      {
        file: "cmd.exe",
        args: ["/d", "/s", "/c", '""C:\\npm\\claude.CMD" mcp remove x"'],
        verbatim: true,
      },
    ]);
  });

  it("refuses a shim call with an unsafe argument and runs nothing", async () => {
    const { exec, calls } = fakeExec();
    const runner = createCommandRunner({
      platform: "win32",
      env,
      exec,
      isFile: files("C:\\npm\\code.CMD"),
    });
    const result = await runner.run("code", ["--add-mcp", "{}"]);
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("falls back to the bare name when nothing resolves", async () => {
    const { exec, calls } = fakeExec();
    const runner = createCommandRunner({
      platform: "win32",
      env,
      exec,
      isFile: files(),
    });
    await runner.run("gemini", ["x"]);
    expect(calls[0]?.file).toBe("gemini");
  });
});
