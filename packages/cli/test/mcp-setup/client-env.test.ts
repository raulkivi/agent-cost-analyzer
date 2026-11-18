// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createClientEnv,
  pathCandidates,
} from "../../src/mcp-setup/client-env.js";

describe("pathCandidates", () => {
  it("joins each PATH folder with the command on POSIX", () => {
    expect(pathCandidates("claude", "linux", { PATH: "/a:/b" })).toEqual([
      "/a/claude",
      "/b/claude",
    ]);
  });

  it("tries every PATHEXT extension on Windows", () => {
    expect(
      pathCandidates("claude", "win32", {
        PATH: "C:\\bin;C:\\tools",
        PATHEXT: ".EXE;.CMD",
      }),
    ).toEqual([
      "C:\\bin\\claude.EXE",
      "C:\\bin\\claude.CMD",
      "C:\\tools\\claude.EXE",
      "C:\\tools\\claude.CMD",
    ]);
  });

  it("falls back to default extensions when PATHEXT is unset", () => {
    expect(pathCandidates("x", "win32", { PATH: "C:\\b" })).toContain(
      "C:\\b\\x.CMD",
    );
  });

  it("reads Path on Windows, where the variable name is case-insensitive", () => {
    expect(
      pathCandidates("x", "win32", { Path: "C:\\b", PATHEXT: ".EXE" }),
    ).toEqual(["C:\\b\\x.EXE"]);
  });

  it("returns nothing for an unset PATH and skips empty entries", () => {
    expect(pathCandidates("x", "linux", {})).toEqual([]);
    expect(pathCandidates("x", "linux", { PATH: "/a::/b" })).toEqual([
      "/a/x",
      "/b/x",
    ]);
  });
});

describe.skipIf(process.platform === "win32")("createClientEnv", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(join(tmpdir(), "aca-client-env-"));
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("copies the process facts it is given", () => {
    const env = createClientEnv({
      platform: "darwin",
      home: "/h",
      cwd: "/c",
      env: { A: "1" },
    });
    expect([env.platform, env.home, env.cwd, env.env.A]).toEqual([
      "darwin",
      "/h",
      "/c",
      "1",
    ]);
  });

  it("finds an executable file on PATH", async () => {
    await fsp.writeFile(join(dir, "claude"), "#!/bin/sh\n", { mode: 0o755 });
    const env = createClientEnv({ env: { PATH: dir } });
    expect(await env.onPath("claude")).toBe(true);
  });

  it("ignores a file without the execute bit and a missing command", async () => {
    await fsp.writeFile(join(dir, "plain"), "x", { mode: 0o644 });
    const env = createClientEnv({ env: { PATH: dir } });
    expect(await env.onPath("plain")).toBe(false);
    expect(await env.onPath("absent")).toBe(false);
  });

  it("reports whether a path exists", async () => {
    const env = createClientEnv({ env: {} });
    expect(await env.exists(dir)).toBe(true);
    expect(await env.exists(join(dir, "nope"))).toBe(false);
  });

  it("lists a folder and treats a missing one as empty", async () => {
    await fsp.writeFile(join(dir, "a"), "x");
    await fsp.mkdir(join(dir, "b"));
    const env = createClientEnv({ env: {} });
    expect((await env.readDir(dir)).sort()).toEqual(["a", "b"]);
    expect(await env.readDir(join(dir, "nope"))).toEqual([]);
  });

  it("reads a text file and returns undefined for a missing one", async () => {
    await fsp.writeFile(join(dir, "f.toml"), "x = 1\n");
    const env = createClientEnv({ env: {} });
    expect(await env.readText(join(dir, "f.toml"))).toBe("x = 1\n");
    expect(await env.readText(join(dir, "nope"))).toBeUndefined();
  });

  // MC9 review R6: a status read must finish, whatever the path holds.
  it.skipIf(process.platform === "win32")(
    "rejects a path that is not a regular file instead of reading forever",
    async () => {
      const path = join(dir, "config.toml");
      await fsp.symlink("/dev/zero", path);
      await expect(createClientEnv({ env: {} }).readText(path)).rejects.toThrow(
        `${path} is not a regular file`,
      );
    },
  );

  it("rejects a file over 10 MB", async () => {
    const path = join(dir, "config.toml");
    await fsp.writeFile(path, "");
    await fsp.truncate(path, 10 * 1024 * 1024 + 1);
    await expect(createClientEnv({ env: {} }).readText(path)).rejects.toThrow(
      "is larger than 10 MB",
    );
  });
});
