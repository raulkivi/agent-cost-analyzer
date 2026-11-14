// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Phase 11 (1.0 task V14): the pi provider against sessions the owner's real
// pi wrote with a local model, redacted and committed by
// scripts/generate-pi-fixtures.mts. Reads only committed files; no model.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { describeLogProviderContract } from "../log-providers/contract.js";
import { PiAgentLogProvider } from "./pi-agent-log-provider.js";
import { computePiFileHash } from "./session-id.js";
import { findLeafEntryIds, walkBranch } from "./session-tree.js";
import { readPiSessionFile, type PiRawEntry } from "./pi-jsonl-reader.js";
import { branchEndTimestamp, selectSidecarRecord } from "./system-prompt-sidecar-matcher.js";
import { parseSidecarLine } from "./system-prompt-sidecar-reader.js";
import { ADDED_BY_PI_EXTENSIONS_LABEL } from "./system-prompt-combiner.js";

const generatedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/pi-agent/generated");
const fixture = (stem: string): string => path.join(generatedDir, `${stem}.jsonl`);
const manifest = JSON.parse(readFileSync(path.join(generatedDir, "manifest.json"), "utf8")) as {
  idleSeconds: number;
  scenarios: { id: string; files: { file: string; sidecar?: string }[] }[];
};
const sessionFiles = manifest.scenarios.flatMap((s) => s.files);

const provider = new PiAgentLogProvider({ sessionsDirPath: generatedDir });
const idOf = (stem: string): string => computePiFileHash(fixture(stem));

function rawEntries(stem: string): Record<string, unknown>[] {
  return readFileSync(fixture(stem), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

type RawUsage = Record<string, number | undefined>;
function usageOf(entry: Record<string, unknown>): RawUsage | undefined {
  const message = entry.message as Record<string, unknown> | undefined;
  if (message?.role === "assistant" || message?.role === "toolResult") return message.usage as RawUsage | undefined;
  if (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary") return entry.usage as RawUsage | undefined;
  return undefined;
}

// The sidecar joins on the session file's absolute path; the committed
// records carry a placeholder, so point them at this checkout's fixture.
const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function sidecarFor(stems: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-generated-sidecar-"));
  tmpDirs.push(dir);
  const lines = stems.flatMap((stem) =>
    readFileSync(path.join(generatedDir, `${stem}.system-prompts.jsonl`), "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.stringify({ ...(JSON.parse(line) as object), sessionFile: fixture(stem) })),
  );
  const file = path.join(dir, "system-prompts.jsonl");
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

describe("generated pi fixtures: provider reads every file", () => {
  it.each(sessionFiles.map((f) => f.file))("%s: one session per branch, turns with known usage", async (file) => {
    const sessions = (await provider.listSessions()).filter((s) => s.id.startsWith(computePiFileHash(path.join(generatedDir, file))));
    expect(sessions).toHaveLength(1);
    const session = await provider.readSession(sessions[0].id);
    expect(session?.turnCount).toBeGreaterThan(0);
    for (const turn of session?.turns ?? []) {
      expect(turn.userMessage.length).toBeGreaterThan(0);
      expect(turn.usage.uncachedInput.known && turn.usage.output.known && turn.usage.cacheRead.known).toBe(true);
    }
  });

  // Every usage carrier pi wrote (assistant, toolResult, usage, compaction,
  // branch_summary) counts once, whatever the context edits say.
  it.each(sessionFiles.map((f) => f.file.replace(/\.jsonl$/, "")))("%s: turn usage sums to every usage in the file", async (stem) => {
    const session = await provider.readSession(idOf(stem));
    const sum = (field: string): number =>
      rawEntries(stem).reduce((total, entry) => total + (usageOf(entry)?.[field] ?? 0), 0);
    const turns = session?.turns ?? [];
    const turnSum = (pick: (t: (typeof turns)[number]) => { known: boolean; value?: number }): number =>
      turns.reduce((total, turn) => total + (pick(turn).value ?? 0), 0);
    expect(turnSum((t) => t.usage.uncachedInput)).toBe(sum("input"));
    expect(turnSum((t) => t.usage.output)).toBe(sum("output"));
    expect(turnSum((t) => t.usage.cacheRead)).toBe(sum("cacheRead"));
  });

  // Field-name diff against schema-v3-session.jsonl (Phase 11): the fields
  // the provider reads must exist in what pi really writes.
  it("pi wrote every field the provider reads", () => {
    const paths = new Set<string>();
    const walk = (value: unknown, prefix: string): void => {
      if (Array.isArray(value)) value.forEach((item) => walk(item, `${prefix}[]`));
      else if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          paths.add(`${prefix}.${key}`);
          walk(child, `${prefix}.${key}`);
        }
      }
    };
    for (const { file } of sessionFiles) {
      for (const entry of rawEntries(file.replace(/\.jsonl$/, ""))) walk(entry, String(entry.type));
    }
    const read = [
      "session.cwd", "session.id", "session.timestamp",
      "message.id", "message.parentId", "message.timestamp", "message.message.role", "message.message.content",
      "message.message.model", "message.message.usage.input", "message.message.usage.output",
      "message.message.usage.cacheRead", "message.message.usage.cacheWrite", "message.message.usage.reasoning",
      "message.message.usage.cost.total", "message.message.content[].type", "message.message.content[].text",
      "message.message.content[].thinking", "message.message.content[].arguments", "message.message.content[].id",
      "message.message.toolCallId", "message.message.toolName", "message.message.isError",
      "message.message.sections", "message.message.toolsAdded[].name", "message.message.toolsAdded[].description",
      "message.message.toolsAdded[].parameters",
      "compaction.usage.output", "compaction.systemMessage", "compaction.firstKeptEntryId", "compaction.summary",
      "context_edit.targetId", "context_edit.replacement",
    ];
    expect(read.filter((p) => !paths.has(p))).toEqual([]);
  });
});

describe("S1 linear (pi-linear)", () => {
  it("has 3-5 turns, tool calls, and a declared tool left unused", async () => {
    const session = await provider.readSession(idOf("pi-linear"));
    expect(session?.turnCount).toBeGreaterThanOrEqual(3);
    expect(session?.turnCount).toBeLessThanOrEqual(5);
    expect(session?.turns.some((t) => t.toolCalls.length > 0)).toBe(true);
    expect(session?.toolInventory?.some((tool) => tool.invokedInTurns.length === 0)).toBe(true);
  });

  it("keeps the idle gap between two turns' start times", async () => {
    const session = await provider.readSession(idOf("pi-linear"));
    const starts = (session?.turns ?? []).map((t) => Date.parse(t.startedAt ?? ""));
    const gaps = starts.slice(1).map((start, i) => start - starts[i]);
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(manifest.idleSeconds * 1000);
  });
});

describe("S2 compaction (pi-compaction)", () => {
  it("has a manual and a threshold compaction, each with usage, and tags their turns", async () => {
    const compactions = rawEntries("pi-compaction").filter((e) => e.type === "compaction");
    expect(compactions.length).toBeGreaterThanOrEqual(2);
    expect(compactions.every((c) => typeof (c.usage as RawUsage | undefined)?.output === "number")).toBe(true);
    const session = await provider.readSession(idOf("pi-compaction"));
    expect(session?.turns.some((t) => t.triggeredEvent === "compaction")).toBe(true);
  });
});

describe("S3 context_edit (pi-context-edit)", () => {
  const entries = rawEntries("pi-context-edit");
  const edits = entries.filter((e) => e.type === "context_edit");
  const byId = new Map(entries.map((e) => [e.id, e]));

  it("pi omitted the truncated attempt itself and compacted", () => {
    expect(edits.length).toBeGreaterThan(0);
    const target = byId.get(edits[0].targetId) as { message?: { role?: string; stopReason?: string } } | undefined;
    expect(target?.message?.role).toBe("assistant");
    expect(target?.message?.stopReason).toBe("length");
    expect(edits[0].replacement).toBeNull();
    expect(entries.some((e) => e.type === "compaction")).toBe(true);
  });

  it("the turn inspector marks the omitted response; the other rounds are unmarked", async () => {
    const session = await provider.readSession(idOf("pi-context-edit"));
    const last = (session?.turnCount ?? 1) - 1;
    const detail = await provider.readTurnDetail(idOf("pi-context-edit"), last);
    const marked = detail?.rounds.filter((r) => r.response.contextEdit) ?? [];
    expect(marked).toHaveLength(edits.filter((e) => (byId.get(e.targetId) as { message?: { role?: string } }).message?.role === "assistant").length);
    expect(marked[0].response.contextEdit?.kind).toBe("omitted");
    expect(detail?.rounds.some((r) => !r.response.contextEdit)).toBe(true);
    expect(JSON.stringify(detail?.rounds.map((r) => r.request))).not.toMatch(/"targetId"|"firstKeptEntryId"/);
  });

  it("usage still counts the omitted attempt", async () => {
    const target = byId.get(edits[0].targetId) as { message: { usage: RawUsage } };
    const session = await provider.readSession(idOf("pi-context-edit"));
    const lastTurn = session?.turns.at(-1);
    const later = entries.slice(entries.indexOf(target as Record<string, unknown>) + 1);
    const laterOutput = later.reduce((total, e) => total + (usageOf(e)?.output ?? 0), 0);
    const output = lastTurn?.usage.output;
    expect(output?.known && output.value).toBeGreaterThanOrEqual((target.message.usage.output ?? 0) + laterOutput);
  });
});

describe("S4 fork (pi-fork, pi-fork-parent)", () => {
  it("the fork is a new file naming its parent; it repeats the parent's earlier entries with the same ids", async () => {
    const fork = await readPiSessionFile(fixture("pi-fork"));
    const parent = await readPiSessionFile(fixture("pi-fork-parent"));
    expect(typeof fork.header?.parentSession).toBe("string");
    const parentIds = new Set(parent.entries.map((e) => e.id));
    expect(fork.entries.filter((e) => parentIds.has(e.id)).length).toBeGreaterThan(0);
    const session = await provider.readSession(idOf("pi-fork"));
    expect(session?.turnCount).toBe(2);
  });
});

describe("sidecar records on real sessions (PR #279 matcher)", () => {
  const withSidecar = sessionFiles.filter((f) => f.sidecar).map((f) => f.file.replace(/\.jsonl$/, ""));
  const sidecarProvider = new PiAgentLogProvider({ sessionsDirPath: generatedDir, systemPromptLogPath: sidecarFor(withSidecar) });

  it("every generated session has its own sidecar record", () => {
    expect(withSidecar.sort()).toEqual(sessionFiles.map((f) => f.file.replace(/\.jsonl$/, "")).sort());
  });

  it.each(withSidecar)("%s: the record's sessionId is the header id, and the exact prompt combines with pi's sections", async (stem) => {
    const { header } = await readPiSessionFile(fixture(stem));
    const records = readFileSync(path.join(generatedDir, `${stem}.system-prompts.jsonl`), "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as { sessionId: string });
    expect(records.every((r) => r.sessionId === header?.id)).toBe(true);

    const session = await sidecarProvider.readSession(idOf(stem));
    expect(session?.systemPromptNote).toBeUndefined();
    const labels = (session?.systemPrompt ?? []).map((c) => c.label);
    expect(labels.some((label) => !label.startsWith(ADDED_BY_PI_EXTENSIONS_LABEL) && !/tool/i.test(label))).toBe(true);
  });

  it("a restarted session uses the latest record captured at or before the branch end", async () => {
    const stem = "pi-compaction";
    const { entries } = await readPiSessionFile(fixture(stem));
    const branch: PiRawEntry[] = walkBranch(entries, findLeafEntryIds(entries)[0]);
    const records = readFileSync(path.join(generatedDir, `${stem}.system-prompts.jsonl`), "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => parseSidecarLine(line))
      .filter((r) => r !== null);
    expect(records.length).toBeGreaterThanOrEqual(2);
    const chosen = selectSidecarRecord(records, branchEndTimestamp(branch));
    expect(chosen?.capturedAt).toBe(records.map((r) => r.capturedAt).sort().at(-1));
  });
});

// The optional Gondolin variant (tools run in a micro-VM) when committed.
const gondolinDir = path.join(generatedDir, "gondolin");
if (existsSync(path.join(gondolinDir, "manifest.json"))) {
  describeLogProviderContract("PiAgentLogProvider over generated pi fixtures (Gondolin)", {
    buildAvailableProvider: () => new PiAgentLogProvider({ sessionsDirPath: gondolinDir }),
    knownSessionId: computePiFileHash(path.join(gondolinDir, "pi-linear.jsonl")),
    unknownSessionId: "does-not-exist",
    buildUnavailableProvider: () => new PiAgentLogProvider({ sessionsDirPath: null }),
    turnIndexWithRoundTrip: 0,
  });
}

describeLogProviderContract("PiAgentLogProvider over generated pi fixtures", {
  buildAvailableProvider: () => new PiAgentLogProvider({ sessionsDirPath: generatedDir }),
  knownSessionId: idOf("pi-linear"),
  unknownSessionId: "does-not-exist",
  buildUnavailableProvider: () => new PiAgentLogProvider({ sessionsDirPath: null }),
  turnIndexWithRoundTrip: 0,
});
