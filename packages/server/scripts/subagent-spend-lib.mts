// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Pure helpers of the classic-subagent spend measurement (step 10.19, SA0).
// They read numbers only: no prompt, response, tool output or title is kept.

export type SubagentKind = "runSubagent" | "searchSubagent";

const NANO_AIU_PER_AI_CREDIT = 1_000_000_000;

export const nanoAiuToAiCredits = (nano: number): number =>
  nano / NANO_AIU_PER_AI_CREDIT;

export function classifySubagentFileName(name: string): SubagentKind | null {
  if (!name.endsWith(".jsonl")) return null;
  if (name.startsWith("runSubagent-")) return "runSubagent";
  if (name.startsWith("searchSubagent-")) return "searchSubagent";
  return null;
}

type Event = {
  type?: unknown;
  attrs?: Record<string, unknown>;
  ts?: unknown;
};

export function parseJsonlLines(text: string): {
  events: Event[];
  malformed: number;
} {
  const events: Event[] = [];
  let malformed = 0;
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    try {
      const v: unknown = JSON.parse(raw);
      if (v !== null && typeof v === "object") events.push(v as Event);
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }
  return { events, malformed };
}

interface RequestSums {
  requests: number;
  nanoAiu: number;
  withoutCredits: number;
  models: Record<string, number>;
  subagentNamed: number;
  refs: string[];
}

// Mirrors extractLlmRequestUsage: a request needs numeric input and output
// tokens; credits count only when a finite, non-negative number.
function sumEvents(events: Event[]): RequestSums {
  const s: RequestSums = {
    requests: 0,
    nanoAiu: 0,
    withoutCredits: 0,
    models: {},
    subagentNamed: 0,
    refs: [],
  };
  for (const e of events) {
    const a = e.attrs ?? {};
    if (e.type === "child_session_ref") {
      s.refs.push(typeof a.childLogFile === "string" ? a.childLogFile : "");
      continue;
    }
    if (e.type !== "llm_request") continue;
    if (typeof a.inputTokens !== "number" || typeof a.outputTokens !== "number")
      continue;
    s.requests += 1;
    const n = a.copilotUsageNanoAiu;
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) s.nanoAiu += n;
    else s.withoutCredits += 1;
    const model = typeof a.model === "string" ? a.model : "unknown";
    s.models[model] = (s.models[model] ?? 0) + 1;
    if (
      typeof a.debugName === "string" &&
      a.debugName.toLowerCase().includes("subagent")
    )
      s.subagentNamed += 1;
  }
  return s;
}

export interface SessionSummary {
  startDate: string | null;
  mainAiCredits: number;
  files: number;
  runsByKind: Record<SubagentKind, number>;
  requestsByKind: Record<SubagentKind, number>;
  aiCreditsByKind: Record<SubagentKind, number>;
  models: Record<string, number>;
  danglingRefs: number;
  orphanFiles: number;
  nestedRefs: number;
  requestsWithoutCredits: number;
  mainSubagentNamedRequests: number;
  malformedLines: number;
  missingAiCredits: number;
}

const isSafeBareName = (n: string) =>
  n !== "" && !n.includes("/") && !n.includes("\\") && !n.includes("..");

export function summarizeSession(input: {
  mainText: string;
  files: { name: string; text: string }[];
}): SessionSummary {
  const main = parseJsonlLines(input.mainText);
  const mainSums = sumEvents(main.events);
  const firstTs = main.events.find((e) => typeof e.ts === "number")?.ts as
    number | undefined;
  const refNames = new Set(mainSums.refs.filter(isSafeBareName));
  const present = new Set(input.files.map((f) => f.name));
  const out: SessionSummary = {
    startDate:
      firstTs === undefined
        ? null
        : new Date(firstTs).toISOString().slice(0, 10),
    mainAiCredits: nanoAiuToAiCredits(mainSums.nanoAiu),
    files: 0,
    runsByKind: { runSubagent: 0, searchSubagent: 0 },
    requestsByKind: { runSubagent: 0, searchSubagent: 0 },
    aiCreditsByKind: { runSubagent: 0, searchSubagent: 0 },
    models: {},
    danglingRefs: mainSums.refs.filter(
      (r) => !isSafeBareName(r) || !present.has(r),
    ).length,
    orphanFiles: 0,
    nestedRefs: 0,
    requestsWithoutCredits: 0,
    mainSubagentNamedRequests: mainSums.subagentNamed,
    malformedLines: main.malformed,
    missingAiCredits: 0,
  };
  let nano = 0;
  for (const f of input.files) {
    const kind = classifySubagentFileName(f.name);
    if (kind === null) continue;
    const parsed = parseJsonlLines(f.text);
    const sums = sumEvents(parsed.events);
    out.files += 1;
    out.runsByKind[kind] += 1;
    out.requestsByKind[kind] += sums.requests;
    out.aiCreditsByKind[kind] += nanoAiuToAiCredits(sums.nanoAiu);
    nano += sums.nanoAiu;
    out.requestsWithoutCredits += sums.withoutCredits;
    out.nestedRefs += sums.refs.length;
    out.malformedLines += parsed.malformed;
    if (!refNames.has(f.name)) out.orphanFiles += 1;
    for (const [m, c] of Object.entries(sums.models))
      out.models[m] = (out.models[m] ?? 0) + c;
  }
  out.missingAiCredits = nanoAiuToAiCredits(nano);
  return out;
}

export interface Totals {
  sessions: number;
  sessionsWithSubagentFiles: number;
  files: number;
  maxFilesPerSession: number;
  runsByKind: Record<SubagentKind, number>;
  requestsByKind: Record<SubagentKind, number>;
  aiCreditsByKind: Record<SubagentKind, number>;
  models: Record<string, number>;
  danglingRefs: number;
  orphanFiles: number;
  nestedRefs: number;
  requestsWithoutCredits: number;
  mainSubagentNamedRequests: number;
  mainAiCredits: number;
  missingAiCredits: number;
}

export function aggregateSessions(list: SessionSummary[]): Totals {
  const t: Totals = {
    sessions: list.length,
    sessionsWithSubagentFiles: 0,
    files: 0,
    maxFilesPerSession: 0,
    runsByKind: { runSubagent: 0, searchSubagent: 0 },
    requestsByKind: { runSubagent: 0, searchSubagent: 0 },
    aiCreditsByKind: { runSubagent: 0, searchSubagent: 0 },
    models: {},
    danglingRefs: 0,
    orphanFiles: 0,
    nestedRefs: 0,
    requestsWithoutCredits: 0,
    mainSubagentNamedRequests: 0,
    mainAiCredits: 0,
    missingAiCredits: 0,
  };
  for (const s of list) {
    if (s.files > 0) t.sessionsWithSubagentFiles += 1;
    t.files += s.files;
    t.maxFilesPerSession = Math.max(t.maxFilesPerSession, s.files);
    for (const k of ["runSubagent", "searchSubagent"] as const) {
      t.runsByKind[k] += s.runsByKind[k];
      t.requestsByKind[k] += s.requestsByKind[k];
      t.aiCreditsByKind[k] += s.aiCreditsByKind[k];
    }
    for (const [m, c] of Object.entries(s.models))
      t.models[m] = (t.models[m] ?? 0) + c;
    t.danglingRefs += s.danglingRefs;
    t.orphanFiles += s.orphanFiles;
    t.nestedRefs += s.nestedRefs;
    t.requestsWithoutCredits += s.requestsWithoutCredits;
    t.mainSubagentNamedRequests += s.mainSubagentNamedRequests;
    t.mainAiCredits += s.mainAiCredits;
    t.missingAiCredits += s.missingAiCredits;
  }
  return t;
}
