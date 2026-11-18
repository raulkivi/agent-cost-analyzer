// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The mcp-setup smoke's pure checks (mcp-client-setup.md §7, MC7): status
// lines, the argv the stub CLIs recorded, the JSON entries written and the
// home changes allowed.
import { describe, expect, it } from "vitest";
import { createClientTargets } from "../src/mcp-setup/client-targets.js";
import { createConfigFileStore } from "../src/mcp-setup/config-file-store.js";
import { MCP_CLIENT_IDS } from "../../server/src/mcp/client-setup/client-setup.js";
import {
  CLIENT_LABELS,
  argvLogProblems,
  expectedArgv,
  homeChangeProblems,
  jsonInstallProblems,
  parseStatus,
  statusProblems,
  withoutEntry,
} from "../smoke/setup-checks.mts";

const NAME = "agent-cost-analyzer";
const LATEST = ["-y", "--prefer-offline", NAME, "mcp"];
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe("CLIENT_LABELS", () => {
  it("names every client as mcp status prints it", () => {
    const targets = createClientTargets({ store: createConfigFileStore() });
    expect(Object.keys(CLIENT_LABELS)).toEqual(MCP_CLIENT_IDS);
    for (const target of targets) expect(CLIENT_LABELS[target.id]).toBe(target.label);
  });
});

describe("parseStatus", () => {
  it("reads the padded label and the status of each line", () => {
    expect(parseStatus("Claude Code     not registered\nVS Code         provided by the AI Credits Analyzer extension\n")).toEqual({
      "Claude Code": "not registered",
      "VS Code": "provided by the AI Credits Analyzer extension",
    });
  });
});

describe("statusProblems", () => {
  const expected = { "Claude Code": "registered (latest)", "Codex CLI": "not registered" };

  it("is empty when every client reads as expected and no other line appears", () => {
    expect(statusProblems("Claude Code  registered (latest)\nCodex CLI    not registered\n", expected)).toEqual([]);
  });

  it("names a wrong, missing or unexpected line", () => {
    expect(statusProblems("Claude Code  not registered\nCursor       not registered\n", expected)).toEqual([
      'Claude Code: "not registered", expected "registered (latest)"',
      'Codex CLI: missing, expected "not registered"',
      'Cursor: unexpected line "not registered"',
    ]);
  });
});

describe("expectedArgv", () => {
  it("is the add and remove argv MC1 builds, without the program name", () => {
    expect(expectedArgv("claude-code", "1.0.0")).toEqual({
      add: ["mcp", "add", "--scope", "user", NAME, "--", "npx", ...LATEST],
      remove: ["mcp", "remove", "--scope", "user", NAME],
    });
    expect(expectedArgv("gemini", "1.0.0")).toEqual({
      add: ["mcp", "add", "-s", "user", NAME, "npx", ...LATEST],
      remove: ["mcp", "remove", "-s", "user", NAME],
    });
    expect(expectedArgv("codex", "1.0.0")).toEqual({ add: ["mcp", "add", NAME, "--", "npx", ...LATEST] });
  });
});

describe("argvLogProblems", () => {
  it("is empty when the log holds exactly the expected calls, in order", () => {
    expect(argvLogProblems("claude", `${JSON.stringify(["a"])}\n${JSON.stringify(["b", "c"])}\n`, [["a"], ["b", "c"]])).toEqual([]);
    expect(argvLogProblems("codex", undefined, [])).toEqual([]);
  });

  it("names a missing, extra or different call", () => {
    expect(argvLogProblems("claude", `${JSON.stringify(["a"])}\n`, [["a"], ["b"]])).toEqual(['claude stub: call 2 missing, expected ["b"]']);
    expect(argvLogProblems("claude", `${JSON.stringify(["x"])}\n`, [])).toEqual(['claude stub: unexpected call 1 ["x"]']);
    expect(argvLogProblems("gemini", `${JSON.stringify(["x"])}\n`, [["y"]])).toEqual(['gemini stub: call 1 was ["x"], expected ["y"]']);
  });
});

describe("withoutEntry", () => {
  it("drops the named entry at the key path, keeping the rest in order", () => {
    expect(JSON.stringify(withoutEntry({ a: 1, mcpServers: { x: 1, [NAME]: 2 }, z: 3 }, ["mcpServers"], NAME))).toBe(
      JSON.stringify({ a: 1, mcpServers: { x: 1 }, z: 3 }),
    );
  });
});

describe("jsonInstallProblems", () => {
  const seeded = json({ preferences: { a: 1 }, mcpServers: { other: { command: "node", args: ["x.js"] } }, tail: true });
  const entry = { command: "npx", args: LATEST };
  const written = json({ preferences: { a: 1 }, mcpServers: { other: { command: "node", args: ["x.js"] }, [NAME]: entry }, tail: true });
  const facts = { label: "Claude Desktop", keyPath: ["mcpServers"], entry, seeded, written, backup: seeded };

  it("is empty when the entry is written, the rest kept and the backup holds the seeded bytes", () => {
    expect(jsonInstallProblems(facts)).toEqual([]);
  });

  it("names a wrong entry, a lost key, a reordered file or a wrong backup", () => {
    expect(jsonInstallProblems({ ...facts, entry: { command: "npx", args: [] } })).toEqual([expect.stringMatching(/^Claude Desktop: the entry is/)]);
    expect(jsonInstallProblems({ ...facts, written: json({ mcpServers: { other: { command: "node", args: ["x.js"] }, [NAME]: entry } }) })).toEqual([
      expect.stringMatching(/^Claude Desktop: the rest of the file changed/),
    ]);
    expect(jsonInstallProblems({ ...facts, backup: undefined })).toEqual(["Claude Desktop: no backup"]);
    expect(jsonInstallProblems({ ...facts, backup: `${seeded} ` })).toEqual(["Claude Desktop: the backup differs from the seeded file"]);
  });
});

describe("homeChangeProblems", () => {
  it("allows changes to the listed files only", () => {
    const changes = [
      { path: ".cursor/mcp.json", kind: "modified", directory: false },
      { path: ".claude.json", kind: "added", directory: false },
      { path: ".cache", kind: "added", directory: true },
    ] as const;
    expect(homeChangeProblems(changes, [".cursor/mcp.json", ".claude.json"])).toEqual(["added outside the client config files: .cache"]);
  });
});
