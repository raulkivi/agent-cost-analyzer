// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  copySubagentFixtureCase,
  makeSubagentCapFolder,
  makeSymlinkedSubagentTranscript,
} from "./subagent-fixture-builders.js";

// CS3 of https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/claude-code-subagents.md: synthetic fixtures for Claude
// Code subagent transcripts (fixtures/claude-code/subagents/README.md).
const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/claude-code/subagents",
);
const PROJECT = "-home-dev-project";
const AGENT_JSONL = /^agent-[A-Za-z0-9]{1,64}\.jsonl$/;
const AGENT_META = /^agent-[A-Za-z0-9]{1,64}\.meta\.json$/;

// Untyped on purpose: the test inspects raw log lines of many shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

interface Loaded {
  caseDir: string;
  sessionId: string;
  session: Json[];
  runs: Map<string, { lines: Json[]; unparsableTrailing: boolean }>;
  metas: Map<string, Json>;
  ignored: string[];
}

function parseJsonl(text: string): { lines: Json[]; unparsableTrailing: boolean; bad: number } {
  const lines: Json[] = [];
  let bad = 0;
  let unparsableTrailing = false;
  const parts = text.split("\n");
  parts.forEach((part, index) => {
    if (part.trim() === "") return;
    try {
      lines.push(JSON.parse(part) as Json);
    } catch {
      bad += 1;
      if (index === parts.length - 1) unparsableTrailing = true;
    }
  });
  return { lines, unparsableTrailing, bad };
}

function load(caseName: string): Loaded {
  const caseDir = path.join(fixturesDir, caseName);
  const projectDir = path.join(caseDir, PROJECT);
  const sessionFiles = readdirSync(projectDir).filter((name) => name.endsWith(".jsonl"));
  expect(sessionFiles).toHaveLength(1);
  const sessionId = sessionFiles[0]!.replace(/\.jsonl$/, "");
  const session = parseJsonl(readFileSync(path.join(projectDir, sessionFiles[0]!), "utf8"));
  expect(session.bad, `${caseName}: session file`).toBe(0);
  const runs = new Map<string, { lines: Json[]; unparsableTrailing: boolean }>();
  const metas = new Map<string, Json>();
  const ignored: string[] = [];
  const subDir = path.join(projectDir, sessionId, "subagents");
  if (existsSync(subDir)) {
    for (const name of readdirSync(subDir)) {
      const text = readFileSync(path.join(subDir, name), "utf8");
      if (AGENT_JSONL.test(name)) {
        const parsed = parseJsonl(text);
        runs.set(name.replace(/^agent-|\.jsonl$/g, ""), parsed);
        expect(parsed.bad, `${caseName}/${name}`).toBe(parsed.unparsableTrailing ? 1 : 0);
      } else if (AGENT_META.test(name)) {
        metas.set(name.replace(/^agent-|\.meta\.json$/g, ""), JSON.parse(text) as Json);
      } else {
        ignored.push(name);
        JSON.parse(text);
      }
    }
  }
  return { caseDir, sessionId, session: session.lines, runs, metas, ignored };
}

function roundIds(lines: Json[]): string[] {
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.type === "assistant" && typeof line.message?.id === "string") ids.add(line.message.id);
  }
  return [...ids];
}

function toolUseIds(lines: Json[], name: string): string[] {
  const ids: string[] = [];
  for (const line of lines) {
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) if (block.type === "tool_use" && block.name === name) ids.push(block.id);
  }
  return ids;
}

function sharedRounds(a: Json[], b: Json[]): string[] {
  const inB = new Set(roundIds(b));
  return roundIds(a).filter((id) => inB.has(id));
}

function requestIdOf(lines: Json[], messageId: string): string | undefined {
  return lines.find((line) => line.type === "assistant" && line.message?.id === messageId)?.requestId;
}

const expected: Record<string, { sessionRounds: number; runs: Record<string, number>; metas: number }> = {
  "linked-run": { sessionRounds: 2, runs: { a111111111111111a: 2 }, metas: 1 },
  "nested-run": { sessionRounds: 2, runs: { a211111111111111a: 2, a222222222222222b: 1 }, metas: 2 },
  "fork-copy": { sessionRounds: 2, runs: { a311111111111111a: 3 }, metas: 1 },
  "nested-fork-copy": { sessionRounds: 2, runs: { a411111111111111a: 3, a422222222222222b: 3 }, metas: 2 },
  "failed-launch": { sessionRounds: 2, runs: {}, metas: 0 },
  "missing-transcript": { sessionRounds: 2, runs: {}, metas: 1 },
  "unlinked-transcript": { sessionRounds: 1, runs: { a711111111111111a: 1 }, metas: 1 },
  "partial-last-line": { sessionRounds: 2, runs: { a811111111111111a: 1 }, metas: 1 },
  "off-branch-call": { sessionRounds: 3, runs: { a911111111111111a: 1 }, metas: 1 },
  "synthetic-round": { sessionRounds: 2, runs: { aa11111111111111a: 2 }, metas: 1 },
  "one-hour-cache": { sessionRounds: 2, runs: { ab11111111111111a: 2 }, metas: 1 },
  "continued-run": { sessionRounds: 3, runs: { ac11111111111111a: 3 }, metas: 1 },
  "tool-audit-fork": { sessionRounds: 3, runs: { ad11111111111111a: 3 }, metas: 1 },
};

describe("Claude Code subagent fixtures (CS3)", () => {
  it("has exactly the documented cases plus a README that names each", () => {
    const cases = readdirSync(fixturesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(cases).toEqual(Object.keys(expected).sort());
    const readme = readFileSync(path.join(fixturesDir, "README.md"), "utf8");
    for (const name of cases) expect(readme, name).toContain(`\`${name}\``);
    for (const generated of ["symlink", "cap"]) expect(readme).toContain(generated);
  });

  describe.each(Object.entries(expected))("%s", (caseName, want) => {
    const loaded = load(caseName);

    it("parses and has the expected round and file counts", () => {
      expect(roundIds(loaded.session)).toHaveLength(want.sessionRounds);
      expect(Object.fromEntries([...loaded.runs].map(([id, run]) => [id, roundIds(run.lines).length]))).toEqual(
        want.runs,
      );
      expect(loaded.metas.size).toBe(want.metas);
    });

    it("lays out like the provider expects", () => {
      const subDir = path.join(loaded.caseDir, PROJECT, loaded.sessionId, "subagents");
      if (loaded.runs.size + loaded.metas.size === 0) return;
      expect(lstatSync(subDir).isDirectory()).toBe(true);
      for (const name of readdirSync(subDir)) expect(lstatSync(path.join(subDir, name)).isFile()).toBe(true);
      for (const [id, run] of loaded.runs) {
        expect(id).toMatch(/^a[0-9a-f]{16}$/);
        for (const line of run.lines) {
          expect(line.agentId, `${id} agentId`).toBe(id);
          if (line.type !== "fork-context-ref") expect(line.sessionId).toBe(loaded.sessionId);
          expect(line.isSidechain).toBe(true);
        }
        expect(run.lines[0]!.parentUuid).toBeNull();
      }
    });

    it("resolves ids across files", () => {
      const sessionCalls = new Set(toolUseIds(loaded.session, "Agent"));
      const runCalls = new Set([...loaded.runs.values()].flatMap((run) => toolUseIds(run.lines, "Agent")));
      for (const [id, meta] of loaded.metas) {
        if (meta.toolUseId !== undefined) {
          expect(sessionCalls.has(meta.toolUseId) || runCalls.has(meta.toolUseId), `${id} toolUseId`).toBe(true);
        }
        if (meta.parentAgentId !== undefined) expect(loaded.runs.has(meta.parentAgentId), `${id} parent`).toBe(true);
        if (!loaded.runs.has(id)) expect(caseName).toBe("missing-transcript");
      }
      for (const id of loaded.runs.keys()) expect(loaded.metas.has(id), `${caseName}: meta for ${id}`).toBe(true);
      const results = loaded.session.filter((line) => line.toolUseResult?.agentId !== undefined);
      for (const result of results) {
        // missing-transcript is the one case whose result names a run that has no file.
        expect(loaded.runs.has(result.toolUseResult.agentId) || caseName === "missing-transcript").toBe(true);
      }
    });
  });

  it("linked-run: link by toolUseId and by the parent result's agentId, and ignores skill files", () => {
    const loaded = load("linked-run");
    const [id] = [...loaded.runs.keys()];
    expect(loaded.metas.get(id!)!.toolUseId).toBe(toolUseIds(loaded.session, "Agent")[0]);
    expect(loaded.session.some((line) => line.toolUseResult?.agentId === id)).toBe(true);
    expect(loaded.ignored.sort()).toEqual([`agent-${id}.forked-skill.json`, `agent-${id}.forked-skill.marker.json`]);
  });

  it("nested-run: depth 2, parentAgentId and its own Agent call", () => {
    const loaded = load("nested-run");
    const child = loaded.metas.get("a222222222222222b")!;
    expect(child).toMatchObject({ spawnDepth: 2, parentAgentId: "a211111111111111a" });
    expect(toolUseIds(loaded.runs.get("a211111111111111a")!.lines, "Agent")).toContain(child.toolUseId);
    expect(sharedRounds(loaded.session, loaded.runs.get("a222222222222222b")!.lines)).toEqual([]);
  });

  it("fork-copy: repeats one session round (same message.id and requestId) and has a fork-context-ref", () => {
    const loaded = load("fork-copy");
    const run = loaded.runs.get("a311111111111111a")!;
    const shared = sharedRounds(loaded.session, run.lines);
    expect(shared).toHaveLength(1);
    expect(requestIdOf(run.lines, shared[0]!)).toBe(requestIdOf(loaded.session, shared[0]!));
    expect(requestIdOf(run.lines, shared[0]!)).toBeDefined();
    const ref = run.lines.find((line) => line.type === "fork-context-ref")!;
    expect(ref).toMatchObject({ parentSessionId: loaded.sessionId });
    expect(typeof ref.parentLastUuid).toBe("string");
    expect(typeof ref.contextLength).toBe("number");
    expect(loaded.metas.get("a311111111111111a")!.isFork).toBe(true);
  });

  it("nested-fork-copy: duplicates the parent run's rounds, not the session's (§13.2)", () => {
    const loaded = load("nested-fork-copy");
    const parent = loaded.runs.get("a411111111111111a")!;
    const fork = loaded.runs.get("a422222222222222b")!;
    expect(sharedRounds(loaded.session, fork.lines)).toEqual([]);
    expect(sharedRounds(loaded.session, parent.lines)).toEqual([]);
    const shared = sharedRounds(parent.lines, fork.lines);
    expect(shared).toHaveLength(2);
    for (const id of shared) {
      expect(requestIdOf(fork.lines, id)).toBe(requestIdOf(parent.lines, id));
      expect(requestIdOf(fork.lines, id)).toBeDefined();
    }
    const parentUuids = new Set(parent.lines.map((line) => line.uuid));
    expect(fork.lines.filter((line) => parentUuids.has(line.uuid)).length).toBeGreaterThan(0);
    expect(fork.lines.some((line) => line.type === "fork-context-ref")).toBe(false);
    expect(loaded.metas.get("a422222222222222b")).toMatchObject({
      isFork: true,
      spawnDepth: 2,
      parentAgentId: "a411111111111111a",
    });
    // The copy repeats the parent run's Agent call id.
    const callId = toolUseIds(parent.lines, "Agent")[0]!;
    expect(toolUseIds(fork.lines, "Agent")).toContain(callId);
  });

  it("no non-fork case shares a round between files", () => {
    for (const name of Object.keys(expected)) {
      if (name === "fork-copy" || name === "nested-fork-copy" || name === "tool-audit-fork") continue;
      const loaded = load(name);
      const flat = [...[...loaded.runs.values()].map((run) => roundIds(run.lines)), roundIds(loaded.session)].flat();
      expect(new Set(flat).size, name).toBe(flat.length);
    }
  });

  it("failed-launch: the Agent call errored and nothing was written", () => {
    const loaded = load("failed-launch");
    const result = loaded.session.find((line) => line.message?.content?.[0]?.type === "tool_result");
    expect(result!.message.content[0].is_error).toBe(true);
    expect(existsSync(path.join(loaded.caseDir, PROJECT, loaded.sessionId))).toBe(false);
  });

  it("missing-transcript: a meta whose transcript is absent, from a non-failed call", () => {
    const loaded = load("missing-transcript");
    const [meta] = [...loaded.metas.values()];
    expect(toolUseIds(loaded.session, "Agent")).toContain(meta!.toolUseId);
    expect(loaded.runs.size).toBe(0);
  });

  it("unlinked-transcript: no toolUseId, no spawnDepth, no parent call", () => {
    const loaded = load("unlinked-transcript");
    const [meta] = [...loaded.metas.values()];
    expect(meta).not.toHaveProperty("toolUseId");
    expect(meta).not.toHaveProperty("spawnDepth");
    expect(toolUseIds(loaded.session, "Agent")).toEqual([]);
    const first = loaded.runs.values().next().value!.lines[0]!.timestamp as string;
    const stamps = loaded.session.map((line) => line.timestamp as string).sort();
    expect(first >= stamps[0]! && first <= stamps[stamps.length - 1]!).toBe(true);
  });

  it("partial-last-line: the transcript ends in a truncated line with no newline", () => {
    const loaded = load("partial-last-line");
    expect([...loaded.runs.values()][0]!.unparsableTrailing).toBe(true);
    const sub = path.join(loaded.caseDir, PROJECT, loaded.sessionId, "subagents");
    const file = readdirSync(sub).find((name) => AGENT_JSONL.test(name))!;
    expect(readFileSync(path.join(sub, file), "utf8").endsWith("\n")).toBe(false);
  });

  it("off-branch-call: the Agent call sits on a branch the last message does not reach", () => {
    const loaded = load("off-branch-call");
    const byUuid = new Map(loaded.session.map((line) => [line.uuid as string, line]));
    const last = loaded.session[loaded.session.length - 1]!;
    const active = new Set<string>();
    for (let cur: Json | undefined = last; cur; cur = byUuid.get(cur.parentUuid)) active.add(cur.uuid);
    const call = loaded.session.find((line) => line.message?.content?.some?.((b: Json) => b.name === "Agent"))!;
    expect(active.has(call.uuid)).toBe(false);
    const children = loaded.session.filter((line) => line.parentUuid === call.parentUuid);
    expect(children.length).toBeGreaterThan(1);
  });

  it("synthetic-round: a <synthetic> round with zero usage", () => {
    const loaded = load("synthetic-round");
    const lines = [...loaded.runs.values()][0]!.lines.filter((line) => line.message?.model === "<synthetic>");
    expect(lines).toHaveLength(1);
    const numbers = Object.values(lines[0]!.message.usage).filter((v) => typeof v === "number");
    expect(numbers.every((v) => v === 0)).toBe(true);
  });

  it("one-hour-cache: 1-hour and 5-minute writes add up to the cache creation total", () => {
    const loaded = load("one-hour-cache");
    const usages = [...loaded.runs.values()][0]!.lines
      .filter((line) => line.type === "assistant")
      .map((line) => line.message.usage);
    expect(usages.some((u) => u.cache_creation.ephemeral_1h_input_tokens > 0)).toBe(true);
    expect(usages.some((u) => u.cache_creation.ephemeral_5m_input_tokens > 0)).toBe(true);
    for (const u of usages) {
      expect(u.cache_creation.ephemeral_1h_input_tokens + u.cache_creation.ephemeral_5m_input_tokens).toBe(
        u.cache_creation_input_tokens,
      );
    }
  });

  it("continued-run: coordinator, queued_command and task-notification lines in one transcript (§13.3)", () => {
    const loaded = load("continued-run");
    const [id, run] = [...loaded.runs.entries()][0]!;
    expect(run.lines.filter((l) => l.type === "user" && l.origin?.kind === "coordinator")).toHaveLength(1);
    expect(run.lines.filter((l) => l.type === "attachment" && l.attachment?.type === "queued_command")).toHaveLength(1);
    expect(run.lines.filter((l) => l.type === "user" && l.origin?.kind === "task-notification")).toHaveLength(1);
    const send = loaded.session.find((l) => l.toolUseResult?.resumedAgentId !== undefined)!;
    expect(send.toolUseResult.resumedAgentId).toBe(id);
    expect(toolUseIds(loaded.session, "SendMessage")).toHaveLength(1);
  });

  it("contains no real home path, e-mail address or token", () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(fixturesDir);
    expect(files.length).toBeGreaterThan(20);
    const patterns: [string, RegExp][] = [
      ["home path", /(?:\/home\/(?!dev\b)[A-Za-z0-9._-]+|\/Users\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\)/],
      ["e-mail", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
      ["token", /(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abp]-|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{20,}\.|-----BEGIN)/],
      ["long hex", /\b[0-9a-f]{32,}\b/],
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const [label, pattern] of patterns) {
        expect(pattern.test(text), `${label} in ${path.relative(fixturesDir, file)}`).toBe(false);
      }
    }
  });
});

describe("test-time generated cases", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("copies a case into a temp projects dir", () => {
    root = mkdtempSync(path.join(tmpdir(), "cs3-copy-"));
    const copy = copySubagentFixtureCase("linked-run", root);
    expect(existsSync(copy.sessionFile)).toBe(true);
    expect(readdirSync(copy.subagentsDir).some((name) => AGENT_JSONL.test(name))).toBe(true);
  });

  it("replaces a transcript with a symlink to a real file elsewhere", () => {
    root = mkdtempSync(path.join(tmpdir(), "cs3-link-"));
    const copy = copySubagentFixtureCase("linked-run", root);
    const link = makeSymlinkedSubagentTranscript(copy, root);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(link, "utf8").length).toBeGreaterThan(0);
  });

  it("fills a subagents folder with the requested number of transcripts and metas", () => {
    root = mkdtempSync(path.join(tmpdir(), "cs3-cap-"));
    const copy = makeSubagentCapFolder(root, 7);
    expect(readdirSync(copy.subagentsDir).filter((name) => AGENT_JSONL.test(name))).toHaveLength(7);
    expect(readdirSync(copy.subagentsDir).filter((name) => AGENT_META.test(name))).toHaveLength(7);
  });
});
