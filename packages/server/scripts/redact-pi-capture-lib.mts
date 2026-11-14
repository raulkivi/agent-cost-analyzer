// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Pure functions behind redact-pi-capture.mts (1.0 task V12, Phase 11).
//
// Redaction rules (also in docs/providers/pi-provider.md):
//  KEEP byte-for-byte: every number, boolean and null (usage, tokens, cost,
//    epoch timestamps); keys; and string values under structural keys (type,
//    id, parentId, timestamp, role, api, provider, model, modelId, stopReason,
//    name, toolName, toolCallId, kind, thinkingLevel, customType, fromId,
//    firstKeptEntryId, targetId, sessionId, capturedAt, required, mimeType,
//    selectedTools, skillNames, contextFilePaths). Kept strings still get the
//    identifier mask below.
//  REPLACE every other string (user prompts, assistant text, thinking, tool
//    arguments and results, file contents, summaries, descriptions, system
//    prompt text and sections) with a placeholder of the SAME length. Each
//    whitespace-delimited word maps to a deterministic pronounceable word of
//    the same length; space, tab, CR and LF are kept. Because the map is per
//    word, a section redacted inside the session file is a substring of the
//    redacted sidecar prompt, so the combine logic still matches.
//  MASK in kept strings and keys: the capture's cwd(s) -> /home/user/project,
//    /home/<name> and /Users/<name> -> /home/user, usernames -> user,
//    hostnames -> host, emails -> user@example.com, secrets -> [REDACTED]
//    (redactSecrets). Any `cwd` value becomes /home/user/project.
//  Unknown string-valued keys are replaced (safe default); the report lists
//    their names, never their values.
import { mkdirSync, writeFileSync } from "node:fs";
import { hostname as osHostname, userInfo } from "node:os";
import path from "node:path";
import { redactSecrets } from "../src/services/tool-audit/output-redactor.js";
import { PiAgentLogProvider } from "../src/data-sources/pi-agent/pi-agent-log-provider.js";
import type { PiRawEntry } from "../src/data-sources/pi-agent/pi-jsonl-reader.js";
import { replaySystemMessages } from "../src/data-sources/pi-agent/system-message-replay.js";
import { findLeafEntryIds, walkBranch } from "../src/data-sources/pi-agent/session-tree.js";

export interface RedactionContext {
  usernames: string[];
  hostnames: string[];
  cwds: string[];
}

export interface RedactionReport {
  entries: number;
  malformedLines: number;
  // key name -> number of string values replaced
  redactedKeys: Record<string, number>;
}

export interface RedactedSession {
  text: string;
  context: RedactionContext;
  // Verbatim in-file system-prompt pieces (base content and sections), used to
  // keep the sidecar consistent.
  pieces: string[];
  report: RedactionReport;
}

export const CWD_PLACEHOLDER = "/home/user/project";
const SESSIONS_DIR_PLACEHOLDER = "/home/user/.pi/agent/sessions/--home-user-project--";

const KEEP_KEYS = new Set([
  "type", "id", "parentId", "timestamp", "version", "role", "api", "provider", "model", "modelId",
  "stopReason", "name", "toolName", "toolCallId", "kind", "thinkingLevel", "customType", "fromId",
  "firstKeptEntryId", "targetId", "sessionId", "capturedAt", "required", "mimeType",
  "selectedTools", "skillNames", "contextFilePaths",
]);
// Subtrees where every string value is free text, whatever its key says.
const FREE_KEYS = new Set(["arguments", "details", "data", "sections"]);

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const CONSONANTS = "bcdfghklmnprstvz";
const VOWELS = "aeiou";

function placeholderWord(word: string): string {
  for (let attempt = 0; ; attempt += 1) {
    let state = (fnv1a(word) + attempt * 0x9e3779b9) >>> 0 || 1;
    let out = "";
    for (let i = 0; i < word.length; i += 1) {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      const pool = i % 2 === 0 ? CONSONANTS : VOWELS;
      out += pool[state % pool.length];
    }
    if (out !== word) {
      return out;
    }
  }
}

// Same length (UTF-16 code units), same space/tab/CR/LF layout, every other
// character, including NBSP, U+2028 and bidi/zero-width controls, becomes a
// plain letter.
export function redactText(text: string): string {
  return text.replace(/[^ \t\r\n]+/g, (word) => placeholderWord(word));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceTerms(text: string, terms: string[], replacement: string): string {
  let out = text;
  for (const term of terms.filter((t) => t.length >= 3).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(escapeRegExp(term), "gi"), replacement);
  }
  return out;
}

export function maskIdentifiers(text: string, ctx: RedactionContext): string {
  let out = redactSecrets(text);
  for (const cwd of [...ctx.cwds].sort((a, b) => b.length - a.length)) {
    out = out.split(cwd).join(CWD_PLACEHOLDER);
  }
  out = out.replace(/\/(?:home|Users)\/(?!user(?:[/\s"']|$))[^/\s"']+/g, "/home/user");
  out = out.replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, "C:\\Users\\user");
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) =>
    m.endsWith("@example.com") ? m : "user@example.com",
  );
  out = replaceTerms(out, ctx.usernames, "user");
  out = replaceTerms(out, ctx.hostnames, "host");
  return out;
}

export function deriveContext(headerCwd: string | undefined, extra: Partial<RedactionContext> = {}): RedactionContext {
  const usernames = [...(extra.usernames ?? [])];
  const cwds = [...(extra.cwds ?? [])];
  if (headerCwd) {
    cwds.push(headerCwd);
    const match = /^(?:\/home|\/Users)\/([^/]+)/.exec(headerCwd) ?? /^[A-Za-z]:\\Users\\([^\\]+)/.exec(headerCwd);
    if (match) {
      usernames.push(match[1]);
    }
  }
  try {
    usernames.push(userInfo().username);
  } catch {
    // no passwd entry; the header-derived name still applies
  }
  return {
    usernames: usernames.filter((name) => name !== "user"),
    hostnames: [...(extra.hostnames ?? []), osHostname()].filter((h) => h.length >= 3),
    cwds,
  };
}

interface Walk {
  ctx: RedactionContext;
  redactedKeys: Record<string, number>;
}

function walk(value: unknown, key: string, free: boolean, w: Walk): unknown {
  if (typeof value === "string") {
    if (!free && key === "cwd") {
      return CWD_PLACEHOLDER;
    }
    if (!free && KEEP_KEYS.has(key)) {
      return maskIdentifiers(value, w.ctx);
    }
    w.redactedKeys[key] = (w.redactedKeys[key] ?? 0) + 1;
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, key, free, w));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[maskIdentifiers(k, w.ctx)] = walk(v, k, free || FREE_KEYS.has(k), w);
    }
    return out;
  }
  return value;
}

function systemMessagePieces(entries: PiRawEntry[]): string[] {
  const pieces = new Set<string>();
  for (const leaf of findLeafEntryIds(entries)) {
    const state = replaySystemMessages(walkBranch(entries, leaf));
    if (!state) {
      continue;
    }
    if (state.baseContent.length > 0) {
      pieces.add(state.baseContent);
    }
    for (const section of state.sections) {
      if (section.text.length > 0) {
        pieces.add(section.text);
      }
    }
  }
  return [...pieces];
}

export function redactSession(text: string, context?: RedactionContext): RedactedSession {
  const rawLines = text.split("\n");
  const trailingNewline = rawLines[rawLines.length - 1] === "";
  if (trailingNewline) {
    rawLines.pop();
  }
  const parsed = rawLines.map((line): unknown => {
    try {
      return line.trim() === "" ? undefined : JSON.parse(line);
    } catch {
      return undefined;
    }
  });
  const header = parsed.find((p) => (p as { type?: unknown } | undefined)?.type === "session") as
    | { cwd?: string }
    | undefined;
  const ctx = context ?? deriveContext(typeof header?.cwd === "string" ? header.cwd : undefined);
  const w: Walk = { ctx, redactedKeys: {} };
  let malformedLines = 0;
  const entries: PiRawEntry[] = [];

  const out = rawLines.map((line, i) => {
    const entry = parsed[i];
    if (entry === undefined || typeof entry !== "object" || entry === null) {
      if (line.trim() !== "") {
        malformedLines += 1;
      }
      return redactText(line);
    }
    entries.push(entry as PiRawEntry);
    const redacted = walk(entry, "", false, w) as Record<string, unknown>;
    if (typeof redacted.parentSession === "string") {
      redacted.parentSession = `${SESSIONS_DIR_PLACEHOLDER}/parent-session.jsonl`;
    }
    return JSON.stringify(redacted);
  });

  return {
    text: out.join("\n") + (trailingNewline ? "\n" : ""),
    context: ctx,
    pieces: systemMessagePieces(entries),
    report: { entries: entries.length, malformedLines, redactedKeys: w.redactedKeys },
  };
}

// Pieces claimed longest-first at their earliest non-overlapping verbatim
// occurrence, like system-prompt-combiner.ts; each is redacted as a unit and
// the gaps between them separately.
function redactPrompt(prompt: string, pieces: string[]): string {
  const claims: { start: number; end: number; text: string }[] = [];
  for (const piece of [...pieces].filter((p) => p.length > 0).sort((a, b) => b.length - a.length)) {
    let from = prompt.indexOf(piece);
    while (from !== -1 && claims.some((c) => from < c.end && from + piece.length > c.start)) {
      from = prompt.indexOf(piece, from + 1);
    }
    if (from !== -1) {
      claims.push({ start: from, end: from + piece.length, text: piece });
    }
  }
  claims.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const claim of claims) {
    out += redactText(prompt.slice(cursor, claim.start)) + redactText(claim.text);
    cursor = claim.end;
  }
  return out + redactText(prompt.slice(cursor));
}

export function redactSidecarRecord(
  record: Record<string, unknown>,
  pieces: string[],
  ctx: RedactionContext,
  stem: string,
): Record<string, unknown> {
  const w: Walk = { ctx, redactedKeys: {} };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "systemPrompt" && typeof value === "string") {
      out[key] = redactPrompt(value, pieces);
    } else if (key === "sessionFile" && typeof value === "string") {
      out[key] = `${SESSIONS_DIR_PLACEHOLDER}/${stem}.jsonl`;
    } else {
      out[key] = walk(value, key, false, w);
    }
  }
  return out;
}

export type LeakKind = "username" | "hostname" | "home-path" | "email";

export function findLeaks(text: string, ctx: RedactionContext): LeakKind[] {
  const leaks = new Set<LeakKind>();
  const has = (terms: string[]): boolean =>
    terms.some((t) => t.length >= 3 && text.toLowerCase().includes(t.toLowerCase()));
  if (has(ctx.usernames)) leaks.add("username");
  if (has(ctx.hostnames)) leaks.add("hostname");
  if (/\/(?:home|Users)\/(?!user(?:[/\s"'\\]|$))[^/\s"'\\]+/.test(text) || /[A-Za-z]:\\\\?Users\\\\?(?!user)[^\\\s"']+/.test(text)) {
    leaks.add("home-path");
  }
  for (const m of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
    if (!m.endsWith("@example.com")) leaks.add("email");
  }
  return [...leaks];
}

// ---- verify: what the pi provider sees ----

export interface CaptureInput {
  sessionText: string;
  records: Record<string, unknown>[];
}

export interface TurnSummary {
  usage: unknown;
  toolNames: string[];
  triggeredEvent?: string;
}
export interface SessionSummary {
  turnCount: number;
  turns: TurnSummary[];
  // kind + label only: labels carry the character counts; the token figures
  // next to them are local estimates over the text and are not pinned.
  promptComponents: { kind: string; label: string }[];
  promptNote?: string;
}
export interface CaptureSummary {
  sessions: SessionSummary[];
}

export async function summariseCapture(dir: string, input: CaptureInput): Promise<CaptureSummary> {
  const sessionsDir = path.join(dir, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  const sessionPath = path.join(sessionsDir, "capture.jsonl");
  writeFileSync(sessionPath, input.sessionText);
  let sidecarPath: string | null = null;
  if (input.records.length > 0) {
    sidecarPath = path.join(dir, "system-prompts.jsonl");
    writeFileSync(
      sidecarPath,
      input.records.map((r) => JSON.stringify({ ...r, sessionFile: sessionPath })).join("\n") + "\n",
    );
  }
  const provider = new PiAgentLogProvider({ sessionsDirPath: sessionsDir, systemPromptLogPath: sidecarPath });
  const sessions: SessionSummary[] = [];
  for (const listed of await provider.listSessions()) {
    const session = await provider.readSession(listed.id);
    if (!session) {
      continue;
    }
    sessions.push({
      turnCount: session.turnCount,
      turns: session.turns.map((turn) => ({
        usage: turn.usage,
        toolNames: turn.toolCalls.map((call) => call.name),
        ...(turn.triggeredEvent ? { triggeredEvent: String(turn.triggeredEvent) } : {}),
      })),
      promptComponents: (session.systemPrompt ?? []).map((c) => ({ kind: c.kind, label: c.label })),
      ...(session.systemPromptNote ? { promptNote: session.systemPromptNote } : {}),
    });
  }
  return { sessions };
}

// Empty array means the provider reads both captures the same way.
export function compareSummaries(before: CaptureSummary, after: CaptureSummary): string[] {
  const diffs: string[] = [];
  if (before.sessions.length !== after.sessions.length) {
    diffs.push(`branch count ${before.sessions.length} -> ${after.sessions.length}`);
  }
  before.sessions.forEach((a, i) => {
    const b = after.sessions[i];
    if (!b) return;
    if (a.turnCount !== b.turnCount) diffs.push(`branch ${i}: turn count ${a.turnCount} -> ${b.turnCount}`);
    a.turns.forEach((turn, t) => {
      if (JSON.stringify(turn) !== JSON.stringify(b.turns[t])) diffs.push(`branch ${i} turn ${t}: usage, tools or event differ`);
    });
    if (JSON.stringify(a.promptComponents) !== JSON.stringify(b.promptComponents)) {
      diffs.push(`branch ${i}: system-prompt components differ`);
    }
    if (a.promptNote !== b.promptNote) diffs.push(`branch ${i}: system-prompt note differs`);
  });
  return diffs;
}
