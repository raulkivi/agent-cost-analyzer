// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The pure parts of the real-client check (mcp-client-setup.md §7 item 7, MC8).
import { describe, expect, it } from "vitest";
import {
  claudeGetStatus,
  guardedFiles,
  hashChanges,
  hashFiles,
  realClientsEnabled,
  redactTemp,
  sandboxEnvProblems,
  shimCallProblems,
  shimScript,
  statusRow,
  stripClientVariables,
  summaryTable,
  vscodeEntryProblems,
} from "../real-clients/checks.mts";

describe("realClientsEnabled", () => {
  it("is on only for REAL_CLIENTS=1", () => {
    expect(realClientsEnabled({ REAL_CLIENTS: "1" })).toBe(true);
    expect(realClientsEnabled({ REAL_CLIENTS: "0" })).toBe(false);
    expect(realClientsEnabled({ REAL_CLIENTS: "true" })).toBe(false);
    expect(realClientsEnabled({})).toBe(false);
  });
});

describe("guardedFiles", () => {
  it("lists the owner's client configs that a stray write could hit, minus ~/.claude.json", () => {
    expect(guardedFiles("/home/me")).toEqual([
      "/home/me/.config/Claude/claude_desktop_config.json",
      "/home/me/.cursor/mcp.json",
      "/home/me/.config/Code/User/mcp.json",
      "/home/me/.config/Code - Insiders/User/mcp.json",
      "/home/me/.codex/config.toml",
      "/home/me/.gemini/settings.json",
    ]);
  });
});

describe("hashFiles and hashChanges", () => {
  const files: Record<string, string | undefined> = { "/a": "one", "/b": "two" };
  const read = (file: string) => files[file];

  it("hashes what exists and marks what does not", () => {
    const hashes = hashFiles(["/a", "/missing"], read);
    expect(hashes["/a"]).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes["/missing"]).toBe("absent");
  });

  it("reports nothing when nothing changed", () => {
    expect(hashChanges(hashFiles(["/a", "/b", "/c"], read), hashFiles(["/a", "/b", "/c"], read))).toEqual([]);
  });

  it("reports a changed, created and deleted file", () => {
    const before = hashFiles(["/a", "/b", "/c"], read);
    files["/a"] = "changed";
    files["/b"] = undefined;
    files["/c"] = "new";
    expect(hashChanges(before, hashFiles(["/a", "/b", "/c"], read))).toEqual(["/a changed", "/b was deleted", "/c was created"]);
  });
});

describe("shimScript and shimCallProblems", () => {
  it("builds a node script that logs HOME, cwd and argv, then runs the real program", () => {
    const script = shimScript("/usr/bin/node", "/real/claude", "/logs/claude.jsonl");
    expect(script.startsWith("#!/usr/bin/node\n")).toBe(true);
    expect(script).toContain('"/real/claude"');
    expect(script).toContain('"/logs/claude.jsonl"');
    expect(script).toContain("process.env.HOME");
  });

  const line = (home: string, argv: string[]) => JSON.stringify({ home, cwd: "/p", argv });

  it("accepts calls that all ran with the temporary home", () => {
    expect(shimCallProblems("claude", [line("/t/home", ["mcp", "get", "x"])], "/t/home")).toEqual([]);
  });

  it("fails a call with another home, and a log with no call when calls are required", () => {
    expect(shimCallProblems("claude", [line("/home/me", ["mcp", "get", "x"])], "/t/home")).toEqual([
      "claude ran with HOME=/home/me, not the temporary home: mcp get x",
    ]);
    expect(shimCallProblems("claude", [], "/t/home", { requireCalls: true })).toEqual(["claude was never called"]);
    expect(shimCallProblems("claude", [], "/t/home")).toEqual([]);
  });
});

describe("claudeGetStatus", () => {
  it("reads the connected line of `claude mcp get`", () => {
    expect(claudeGetStatus("agent-cost-analyzer:\n  Scope: User config\n  Status: ✔ Connected\n  Type: stdio\n")).toBe("connected");
  });
  it("tells a failed connection from an unknown output", () => {
    expect(claudeGetStatus("x:\n  Status: ✗ Failed to connect\n")).toBe("failed");
    expect(claudeGetStatus("nothing useful")).toBe("unknown");
    expect(claudeGetStatus("x:\n  Status: ⏸ Pending approval\n")).toBe("other: ⏸ Pending approval");
  });
});

describe("vscodeEntryProblems", () => {
  const entry = { type: "stdio", command: "npx", args: ["-y", "agent-cost-analyzer", "mcp"] };
  it("accepts the same relative path and entry", () => {
    expect(vscodeEntryProblems({ file: "User/mcp.json", entry }, { file: "User/mcp.json", entry: { ...entry } })).toEqual([]);
  });
  it("names each difference", () => {
    const real = { ...entry, command: "x" };
    expect(vscodeEntryProblems({ file: "Code/User/mcp.json", entry }, { file: "User/mcp.json", entry: real })).toEqual([
      "relative path: ours Code/User/mcp.json, the real client's User/mcp.json",
      `entry differs: ours ${JSON.stringify(entry)}, the real client's ${JSON.stringify(real)}`,
    ]);
  });
});

describe("sandboxEnvProblems and stripClientVariables", () => {
  it("drops variables that would point a client at a running app or the real profile", () => {
    const env = stripClientVariables({ PATH: "/bin", VSCODE_IPC_HOOK_CLI: "/s", CLAUDECODE: "1", CLAUDE_CONFIG_DIR: "/c", ANTHROPIC_API_KEY: "k", HOME: "/h" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h" });
  });

  it("requires every home variable inside the temporary root", () => {
    const ok = { HOME: "/t/home", XDG_CONFIG_HOME: "/t/home/.config" };
    expect(sandboxEnvProblems(ok, "/t")).toEqual([]);
    expect(sandboxEnvProblems({ HOME: "/home/me", XDG_CONFIG_HOME: "/t/x" }, "/t")).toEqual(["HOME is /home/me, outside /t"]);
    expect(sandboxEnvProblems({ ...ok, CODEX_HOME: "/home/me/.codex" }, "/t")).toEqual(["CODEX_HOME is /home/me/.codex, outside /t"]);
  });
});

describe("redactTemp", () => {
  it("replaces the random part of a temporary path", () => {
    expect(redactTemp("/tmp/mcp-real-clients-Ab12Cd/home/.claude.json", "/tmp/mcp-real-clients-Ab12Cd")).toBe("<tmp>/home/.claude.json");
  });
});

describe("summaryTable", () => {
  it("aligns the columns and trims line ends", () => {
    expect(
      summaryTable([
        { client: "Claude Code", scope: "user", result: "pass" },
        { client: "VS Code", scope: "-", result: "skipped: no code" },
      ]),
    ).toBe(
      [
        "client       scope  result",
        "-----------  -----  ----------------",
        "Claude Code  user   pass",
        "VS Code      -      skipped: no code",
      ].join("\n"),
    );
  });
});

describe("statusRow", () => {
  const output = "Claude Code     registered (latest)\nClaude Desktop  not detected\nVS Code         not detected\n";
  it("returns the state in a client's row", () => {
    expect(statusRow(output, "Claude Code")).toBe("registered (latest)");
    expect(statusRow(output, "Claude Desktop")).toBe("not detected");
  });
  it("does not mistake VS Code Insiders' row for VS Code's", () => {
    const rows = "VS Code Insiders  registered (latest)\nCursor            not detected\n";
    expect(statusRow(rows, "VS Code")).toBeUndefined();
    expect(statusRow(rows, "VS Code Insiders")).toBe("registered (latest)");
  });
  it("returns undefined for a client that has no row", () => {
    expect(statusRow(output, "Cursor")).toBeUndefined();
  });
});
