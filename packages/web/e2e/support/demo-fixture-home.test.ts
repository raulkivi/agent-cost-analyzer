// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDemoFixtureHome,
  DEMO_CLAUDE_SESSION,
  DEMO_CLAUDE_SUBAGENT_SESSION,
  DEMO_COPILOT_MODELS,
  DEMO_LOCAL_MODEL,
  DEMO_PI_SESSION,
  DEMO_UNUSED_TOOLS_SERVER,
  DEMO_UNUSED_TOOLS_SESSIONS,
  DEMO_UNUSED_TOOLS_TOOLS,
} from "./demo-fixture-home.mts";
import { ALLOWANCE_KNOWN_SESSION_ID, ALLOWANCE_UNKNOWN_SESSION_ID, AUDIT_READ_SESSION_ID, AUDIT_READ_SESSION_TITLE, AUDIT_SHELL_SESSION_ID, createFixtureHome } from "./fixture-home.mts";

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

// D36 and the DR1 additions (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/demo-recordings-1.0.md §4): the demo variant of the
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

  it("adds a single-model Claude Code session in the window, whose cache reads follow its writes, for a replay whose self-check passes", () => {
    const file = files(path.join(home, ".claude", "projects")).find((f) => f.includes(DEMO_CLAUDE_SESSION.id));
    expect(file).toBeDefined();
    const lines = readFileSync(file!, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { type: string; timestamp?: string; message?: { model?: string; usage?: { cache_read_input_tokens?: number } } });
    const assistants = lines.filter((line) => line.type === "assistant");
    expect(assistants.length).toBeGreaterThanOrEqual(3);
    expect(new Set(assistants.map((line) => line.message?.model)).size).toBe(1);
    for (const line of lines) {
      expect(NOW - Date.parse(line.timestamp!)).toBeLessThan(30 * DAY_MS);
      expect(Date.parse(line.timestamp!)).toBeLessThan(NOW);
    }
    // Every later turn reads the cache the first one wrote.
    for (const line of assistants.slice(1)) expect(line.message?.usage?.cache_read_input_tokens ?? 0).toBeGreaterThan(0);
  });

  // DR12 (W2 extended): a Claude Code session whose first turn started one subagent run (CS3's linked shape).
  describe("the Claude Code session with a subagent run", () => {
    const { id, runId, toolUseId } = DEMO_CLAUDE_SUBAGENT_SESSION;
    const jsonl = (file: string) => readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
    const sessionFile = () => files(path.join(home, ".claude", "projects")).find((f) => f.endsWith(`${id}.jsonl`))!;
    const runFile = (ext: string) => path.join(sessionFile().replace(/\.jsonl$/, ""), "subagents", `agent-${runId}${ext}`);

    it("links the run by its Agent call: the call's result names the agent, the meta names the call", () => {
      const lines = jsonl(sessionFile());
      const call = lines.flatMap((line) => (Array.isArray(line.message?.content) ? line.message.content : [])).find((part: { type: string; name?: string }) => part.type === "tool_use" && part.name === "Agent");
      expect(call.id).toBe(toolUseId);
      // The run belongs to the second turn: the session opens on a turn without runs.
      const humanPrompts = lines.map((line, index) => (line.type === "user" && line.promptId ? index : -1)).filter((index) => index >= 0);
      const callIndex = lines.findIndex((line) => Array.isArray(line.message?.content) && line.message.content.some((part: { id?: string }) => part.id === toolUseId && true));
      expect(humanPrompts).toHaveLength(2);
      expect(callIndex).toBeGreaterThan(humanPrompts[1]!);
      expect(lines.find((line) => line.toolUseResult)?.toolUseResult).toMatchObject({ agentId: runId });
      expect(JSON.parse(readFileSync(runFile(".meta.json"), "utf8"))).toMatchObject({ toolUseId, spawnDepth: 1, agentType: "general-purpose" });
    });

    it("has a run transcript on a priced model with usage, in the session folder and inside the window", () => {
      const run = jsonl(runFile(".jsonl"));
      const assistants = run.filter((line) => line.type === "assistant");
      expect(assistants.length).toBeGreaterThanOrEqual(2);
      for (const line of assistants) expect(line.message.model).toBe(DEMO_CLAUDE_SUBAGENT_SESSION.runModel);
      for (const line of [...jsonl(sessionFile()), ...run]) {
        expect(NOW - Date.parse(line.timestamp)).toBeLessThan(30 * DAY_MS);
        expect(Date.parse(line.timestamp)).toBeLessThan(NOW);
        expect(line.cwd).toBe(path.join(home, "dev", "portal-api"));
      }
    });

    it("has a first turn without a run and reads like real use", () => {
      const users = jsonl(sessionFile()).filter((line) => line.type === "user" && line.promptId);
      expect(users).toHaveLength(2);
      const text = readFileSync(sessionFile(), "utf8") + readFileSync(runFile(".jsonl"), "utf8");
      expect(text).not.toMatch(/made-up|placeholder|fixture-/i);
    });
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
      expect(all).not.toContain(DEMO_CLAUDE_SESSION.id);
      expect(all).not.toContain(DEMO_CLAUDE_SUBAGENT_SESSION.id);
      expect(all).toContain("fixture-main-model");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// DR9 (W4): the demo home with MS8's seeds and no allowance set.
describe("createDemoFixtureHome with the allowance seeds", () => {
  let root: string;
  let home: string;
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "aica-demo-allowance-home-"));
    home = path.join(root, "home");
    createDemoFixtureHome(home, { allowanceSessions: true });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("seeds VS Code sessions from 2026-11-01 to 2026-11-06, one of them without cost data", () => {
    const db = new DatabaseSync(path.join(home, ".config", "Code", "User", "globalStorage", "github.copilot-chat", "session-store.db"), { readOnly: true });
    try {
      for (const id of [ALLOWANCE_KNOWN_SESSION_ID, ALLOWANCE_UNKNOWN_SESSION_ID]) {
        const row = db.prepare("SELECT created_at FROM sessions WHERE id = ?").get(id) as { created_at: string } | undefined;
        expect(Date.parse(row!.created_at)).toBeGreaterThanOrEqual(Date.parse("2026-11-01T00:00:00.000Z"));
        expect(Date.parse(row!.created_at)).toBeLessThan(Date.parse("2026-11-06T12:00:00.000Z"));
      }
    } finally {
      db.close();
    }
  });

  it("has an Agent Host session store", () => {
    expect(files(path.join(home, ".config", "Code")).some((file) => file.endsWith("session.db"))).toBe(true);
  });

  it("starts with no allowance set and no 'fixture-' text", () => {
    expect(files(home).some((file) => file.endsWith("settings.json") && file.includes("agent-cost-analyzer"))).toBe(false);
    expect(files(home).filter((file) => readFileSync(file).includes("fixture-"))).toEqual([]);
  });
});

// DR9 review: the shared seeds title some sessions "Fixture session"; the demo home retitles them.
describe("session titles", () => {
  const titles = (home: string): string[] => {
    const db = new DatabaseSync(path.join(home, ".config", "Code", "User", "globalStorage", "github.copilot-chat", "session-store.db"), { readOnly: true });
    try {
      return (db.prepare("SELECT summary FROM sessions").all() as { summary: string }[]).map((row) => row.summary);
    } finally {
      db.close();
    }
  };
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "aica-demo-titles-"));
    createDemoFixtureHome(path.join(root, "demo"), { allowanceSessions: true });
    createFixtureHome(path.join(root, "shared"), { allowanceSessions: true });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("leaves no demo session titled Fixture", () => {
    const demo = titles(path.join(root, "demo"));
    expect(demo.filter((title) => /fixture/i.test(title))).toEqual([]);
    expect(new Set(demo).size).toBeGreaterThan(5);
  });

  it("leaves the shared home's titles alone", () => {
    expect(titles(path.join(root, "shared"))).toContain("Fixture session");
  });
});

// DR11 (W5): the audit sessions (ST12's child-log calls) are opt-in on the shared home and pass
// through the demo home, so only W5 has them and W3/F4 keep their lists.
describe("createDemoFixtureHome with auditSessions", () => {
  it("holds the audit sessions, still with no 'fixture-' text, and leaves them out by default", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aica-demo-web-audit-"));
    try {
      const withAudit = path.join(root, "with");
      const without = path.join(root, "without");
      createDemoFixtureHome(withAudit, { auditSessions: true });
      createDemoFixtureHome(without);
      expect(files(withAudit).filter((file) => readFileSync(file).includes("fixture-"))).toEqual([]);
      const db = new DatabaseSync(path.join(withAudit, ".config", "Code", "User", "globalStorage", "github.copilot-chat", "session-store.db"), { readOnly: true });
      try {
        expect((db.prepare("SELECT summary FROM sessions WHERE id = ?").get(AUDIT_READ_SESSION_ID) as { summary: string }).summary).toBe(AUDIT_READ_SESSION_TITLE);
      } finally {
        db.close();
      }
      expect(files(withAudit).some((file) => file.includes(AUDIT_SHELL_SESSION_ID))).toBe(true);
      expect(files(without).some((file) => file.includes(AUDIT_READ_SESSION_ID))).toBe(false);
      // The failed call's evidence reads like a real error, and the read run's requests carry a billed figure.
      const text = textOf(withAudit, ".jsonl");
      expect(text).not.toContain("parse error: fixture");
      expect(text).toContain("Regex parse error: unclosed group");
      const run = files(withAudit).find((file) => file.endsWith("searchSubagent-call_auditexplore1.jsonl"))!;
      expect(readFileSync(run, "utf8")).toContain('"copilotUsageNanoAiu":500000000');
      expect(readFileSync(run, "utf8")).not.toContain('"copilotUsageNanoAiu":0,');
      // The shared home keeps the seed's wording, which the server's tests assert.
      const shared = path.join(root, "shared");
      createFixtureHome(shared, { auditSessions: true });
      expect(textOf(shared, ".jsonl")).toContain("parse error: fixture");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
