// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDemoFixtureHome,
  DEMO_COPILOT_MODELS,
  DEMO_LOCAL_MODEL,
  DEMO_PI_SESSION,
  DEMO_UNUSED_TOOLS_SERVER,
  DEMO_UNUSED_TOOLS_SESSIONS,
  DEMO_UNUSED_TOOLS_TOOLS,
} from "./demo-fixture-home.mts";
import { createFixtureHome } from "./fixture-home.mts";

// The parts of a pi session line this test reads.
interface PiLine {
  id?: string;
  cwd?: string;
  timestamp?: string;
  message?: { role: string; model?: string; usage?: { cost: { total: number } }; content?: { type: string; name?: string }[]; toolsAdded?: { name: string }[] };
}

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-11-06T12:00:00.000Z");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? files(file) : [file];
  });
}

const textOf = (home: string, ext: string): string =>
  files(home)
    .filter((file) => file.endsWith(ext))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

// D36 and the DR1 additions (docs/plans/demo-recordings-1.0.md §4): the demo variant of the
// web e2e fixture home, for W3, F4 and (through the Desktop home) M8.
describe("createDemoFixtureHome", () => {
  let root: string;
  let home: string;
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "aica-demo-web-home-"));
    home = path.join(root, "home");
    createDemoFixtureHome(home);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("leaves no 'fixture-' text anywhere under the home", () => {
    expect(files(home).filter((file) => readFileSync(file).includes("fixture-"))).toEqual([]);
  });

  it("writes each realistic Copilot model name where the fixture's name was", () => {
    const text = textOf(home, ".jsonl");
    for (const model of Object.values(DEMO_COPILOT_MODELS)) expect(text).toContain(`"model":"${model}"`);
  });

  it("adds Copilot sessions whose tools file loads an MCP server of at least six tools no turn calls, inside the 30 days", () => {
    expect(DEMO_UNUSED_TOOLS_TOOLS.length).toBeGreaterThanOrEqual(6);
    expect(DEMO_UNUSED_TOOLS_SESSIONS.length).toBeGreaterThanOrEqual(2);
    const db = new DatabaseSync(path.join(home, ".config", "Code", "User", "globalStorage", "github.copilot-chat", "session-store.db"), { readOnly: true });
    try {
      for (const session of DEMO_UNUSED_TOOLS_SESSIONS) {
        const row = db.prepare("SELECT summary, cwd, created_at FROM sessions WHERE id = ?").get(session.id) as { summary: string; cwd: string; created_at: string } | undefined;
        expect(row?.summary).toBe(session.title);
        expect(row?.cwd).toBe(path.join(home, "dev", "scratch"));
        expect(NOW - Date.parse(row!.created_at)).toBeLessThan(30 * DAY_MS);
        expect(Date.parse(row!.created_at)).toBeLessThan(NOW);
      }
    } finally {
      db.close();
    }
    const toolsFiles = files(home).filter((file) => file.endsWith("tools_0.json") && DEMO_UNUSED_TOOLS_SESSIONS.some((session) => file.includes(session.id)));
    expect(toolsFiles).toHaveLength(DEMO_UNUSED_TOOLS_SESSIONS.length);
    for (const file of toolsFiles) {
      const names = (JSON.parse(JSON.parse(readFileSync(file, "utf8")).content) as { name: string }[]).map((tool) => tool.name);
      for (const tool of DEMO_UNUSED_TOOLS_TOOLS) expect(names).toContain(`mcp_${DEMO_UNUSED_TOOLS_SERVER}_${tool}`);
    }
    // No turn calls one of them.
    expect(textOf(home, "main.jsonl")).not.toContain(`"name":"mcp_${DEMO_UNUSED_TOOLS_SERVER}`);
  });

  it("adds a pi session on a local model: no cost, declared tools, one never run, dated in the window, in the scratch folder", () => {
    const file = files(path.join(home, ".pi", "agent", "sessions")).find((f) => f.includes(DEMO_PI_SESSION.id));
    expect(file).toBeDefined();
    const lines = readFileSync(file!, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as PiLine);
    const header = lines[0]!;
    expect(header.id).toBe(DEMO_PI_SESSION.id);
    expect(header.cwd).toBe(path.join(home, "dev", "scratch"));
    expect(NOW - Date.parse(header.timestamp!)).toBeLessThan(30 * DAY_MS);
    for (const line of lines) if (typeof line.timestamp === "string") expect(Date.parse(line.timestamp)).toBeLessThan(NOW);
    const assistants = lines.flatMap((line) => (line.message?.role === "assistant" ? [line.message] : []));
    expect(assistants.length).toBeGreaterThan(0);
    for (const message of assistants) {
      expect(message.model).toBe(DEMO_LOCAL_MODEL);
      expect(message.usage?.cost.total).toBe(0);
    }
    const declared = lines.flatMap((line) => (line.message?.role === "system" ? (line.message.toolsAdded ?? []) : [])).map((tool) => tool.name);
    const called = lines
      .flatMap((line) => (line.message?.role === "assistant" ? (line.message.content ?? []) : []))
      .flatMap((part) => (part.type === "toolCall" ? [part.name] : []));
    expect(declared.length).toBeGreaterThanOrEqual(3);
    expect(declared.filter((name) => !called.includes(name)).length).toBeGreaterThan(0);
  });

  it("holds nothing of the generated fixture's folder or the owner's model alias", () => {
    const text = textOf(home, ".jsonl");
    expect(text).not.toContain("/home/user/project");
    expect(text).not.toContain(":setup6");
  });
});

describe("the shared fixture home", () => {
  it("has none of the demo additions, so the asserted figures do not move", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aica-shared-web-home-"));
    try {
      const home = path.join(root, "home");
      createFixtureHome(home);
      const all = files(home).join("\n") + textOf(home, ".jsonl");
      expect(all).not.toContain(DEMO_PI_SESSION.id);
      for (const session of DEMO_UNUSED_TOOLS_SESSIONS) expect(all).not.toContain(session.id);
      expect(all).toContain("fixture-main-model");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
