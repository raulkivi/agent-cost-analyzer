// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// V27 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/savings-increment-3.md §7.1, §7.4): pi's tool inventory over V14's real
// fixtures, a tool list that changes mid-session, and a forked file's shared
// prefix (D27).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { PiAgentLogProvider } from "./pi-agent-log-provider.js";
import { computePiFileHash } from "./session-id.js";

const generatedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/pi-agent/generated");
const real = new PiAgentLogProvider({ sessionsDirPath: generatedDir });
const realSession = (stem: string) => real.readSession(computePiFileHash(path.join(generatedDir, `${stem}.jsonl`)));

const estimate = (value: number) => ({ known: true, value, estimated: true });

describe("pi tool inventory over the real fixtures", () => {
  it("pi-linear: four declared tools, each with its definition tokens and the requests it was declared for; write is never invoked", async () => {
    const session = await realSession("pi-linear");

    expect(session?.toolInventory).toEqual([
      { name: "read", loaded: true, invokedInTurns: [0, 2], definitionTokens: estimate(214), loadedRequests: 8 },
      { name: "bash", loaded: true, invokedInTurns: [1], definitionTokens: estimate(173), loadedRequests: 8 },
      { name: "edit", loaded: true, invokedInTurns: [2], definitionTokens: estimate(373), loadedRequests: 8 },
      { name: "write", loaded: true, invokedInTurns: [], definitionTokens: estimate(127), loadedRequests: 8 },
    ]);
    expect(session?.sharedPrefixRequests).toBeUndefined();
  });

  it("pi-compaction: the compaction checkpoint keeps the same four tools declared for every request", async () => {
    const session = await realSession("pi-compaction");

    expect(session?.toolInventory?.map(({ name, invokedInTurns, loadedRequests }) => [name, invokedInTurns, loadedRequests])).toEqual([
      ["read", [0, 1], 6],
      ["bash", [], 6],
      ["edit", [], 6],
      ["write", [], 6],
    ]);
  });

  it("every generated session's tools are loaded, with a known estimated size and a request count", async () => {
    for (const stem of ["pi-linear", "pi-compaction", "pi-context-edit", "pi-fork", "pi-fork-parent"]) {
      const inventory = (await realSession(stem))?.toolInventory ?? [];
      expect(inventory.length, stem).toBeGreaterThan(0);
      for (const entry of inventory) {
        expect(entry.loaded, `${stem} ${entry.name}`).toBe(true);
        expect(entry.definitionTokens, `${stem} ${entry.name}`).toMatchObject({ known: true, estimated: true });
        expect(entry.loadedRequests, `${stem} ${entry.name}`).toBeGreaterThan(0);
      }
    }
  });
});

// ---- hand-made files ---------------------------------------------------------

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const tool = (name: string, description = `${name} tool`) => ({ name, description, parameters: { type: "object", properties: {} } });
const usage = { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 };
const at = (n: number) => `2026-11-14T10:00:${String(n).padStart(2, "0")}.000Z`;

type Line = Record<string, unknown>;
const header: Line = { type: "session", version: 3, id: "11111111-1111-1111-1111-111111111111", timestamp: at(0), cwd: "/work" };
const system = (id: string, parentId: string | null, message: Record<string, unknown>): Line => ({ type: "message", id, parentId, timestamp: at(1), message: { role: "system", content: "", timestamp: 1, ...message } });
const user = (id: string, parentId: string): Line => ({ type: "message", id, parentId, timestamp: at(2), message: { role: "user", content: `prompt ${id}` } });
const assistant = (id: string, parentId: string, model = "local-model"): Line => ({ type: "message", id, parentId, timestamp: at(3), message: { role: "assistant", model, content: [{ type: "text", text: "ok" }], usage } });

function providerOver(lines: Line[]): PiAgentLogProvider {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-v27-"));
  dirs.push(dir);
  writeFileSync(path.join(dir, "session.jsonl"), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return new PiAgentLogProvider({ sessionsDirPath: dir });
}

describe("a tool list that changes mid-session", () => {
  const provider = providerOver([
    header,
    system("s0", null, { toolsAdded: [tool("read"), tool("write")] }),
    user("u1", "s0"),
    assistant("a1", "u1"),
    assistant("a2", "a1"),
    system("s1", "a2", { toolsRemoved: [{ name: "write" }], toolsAdded: [tool("grep")] }),
    assistant("a3", "s1"),
  ]);

  it("counts each tool's declared requests and keeps a removed tool's definition, so it is no longer unknown", async () => {
    const [summary] = await provider.listSessions();
    const session = await provider.readSession(summary!.id);

    expect(session?.toolInventory).toEqual([
      { name: "read", loaded: true, invokedInTurns: [], definitionTokens: expect.objectContaining({ known: true }), loadedRequests: 3 },
      { name: "write", loaded: true, invokedInTurns: [], definitionTokens: expect.objectContaining({ known: true }), loadedRequests: 2 },
      { name: "grep", loaded: true, invokedInTurns: [], definitionTokens: expect.objectContaining({ known: true }), loadedRequests: 1 },
    ]);
  });
});

describe("a forked file (D27)", () => {
  // One file, two leaves: A = s0 u1 a1 u2a a2a, B = s0 u1 a1 u2b a2b u3b a3b.
  // B shares s0, u1 and a1 with A, so its first request (a1) is counted under A.
  const provider = providerOver([
    header,
    system("s0", null, { toolsAdded: [tool("read"), tool("write")] }),
    user("u1", "s0"),
    assistant("a1", "u1"),
    user("u2a", "a1"),
    assistant("a2a", "u2a"),
    user("u2b", "a1"),
    assistant("a2b", "u2b"),
    user("u3b", "a2b"),
    assistant("a3b", "u3b"),
  ]);

  it("the first branch in leaf order owns the shared prefix; the later branch reports it and counts only its own requests", async () => {
    const sessions = await Promise.all((await provider.listSessions()).map((summary) => provider.readSession(summary.id)));
    const first = sessions.find((session) => session?.id.endsWith("__branch__a2a"));
    const second = sessions.find((session) => session?.id.endsWith("__branch__a3b"));

    expect(first?.sharedPrefixRequests).toBeUndefined();
    expect(first?.toolInventory?.map((entry) => entry.loadedRequests)).toEqual([2, 2]);
    expect(second?.sharedPrefixRequests).toBe(1);
    expect(second?.toolInventory?.map((entry) => entry.loadedRequests)).toEqual([2, 2]);
  });
});
