// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Pure parts of generate-pi-fixtures.mts (Phase 11, owner decision
// 2026-11-14): argument parsing, the temporary pi config, the scripted
// scenarios, session counts and the manifest. No I/O here.

export type ScenarioId = "s1" | "s2" | "s3" | "s4";
const SCENARIO_IDS: ScenarioId[] = ["s1", "s2", "s3", "s4"];

export interface GeneratorArgs {
  scenarios: ScenarioId[];
  idleSeconds: number;
  gondolin: boolean;
  provider?: string;
  model?: string;
  out?: string;
  // Unset: the owner's pi on PATH (resolvePiCommand).
  piCommand?: string;
  timeoutSeconds: number;
  keepTemp: boolean;
}

export const DEFAULT_IDLE_SECONDS = 310;

function numberArg(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (value === undefined || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} needs a non-negative number`);
  }
  return parsed;
}

export function parseGeneratorArgs(argv: string[]): GeneratorArgs {
  const args: GeneratorArgs = {
    scenarios: [...SCENARIO_IDS],
    idleSeconds: DEFAULT_IDLE_SECONDS,
    gondolin: false,
    timeoutSeconds: 900,
    keepTemp: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--quick") args.idleSeconds = 0;
    else if (arg === "--idle-seconds") args.idleSeconds = numberArg(arg, argv[++i]);
    else if (arg === "--timeout-seconds") args.timeoutSeconds = numberArg(arg, argv[++i]);
    else if (arg === "--gondolin") args.gondolin = true;
    else if (arg === "--keep-temp") args.keepTemp = true;
    else if (arg === "--provider") args.provider = argv[++i];
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--pi") args.piCommand = argv[++i];
    else if (arg === "--scenarios") {
      args.scenarios = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
        if (!SCENARIO_IDS.includes(s as ScenarioId)) throw new Error(`Unknown scenario: ${s} (use ${SCENARIO_IDS.join(", ")})`);
        return s as ScenarioId;
      });
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

// `npm run` puts node_modules/.bin first on PATH, where the repo's vendored
// (older) pi lives; fixtures must come from the pi the owner actually runs.
export function resolvePiCommand(pathEnv: string, isExecutable: (file: string) => boolean): string | null {
  for (const dir of pathEnv.split(":").filter(Boolean)) {
    if (dir.split(/[/\\]/).includes("node_modules")) continue;
    const candidate = `${dir.replace(/\/$/, "")}/pi`;
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

// CI has no model server; generation only runs on the owner's PC.
export function refusalReason(env: Record<string, string | undefined>): string | null {
  const truthy = (v: string | undefined): boolean => v !== undefined && v !== "" && v !== "false" && v !== "0";
  if (truthy(env.CI) || truthy(env.GITHUB_ACTIONS)) {
    return "Refusing to run in CI: generating pi fixtures needs a local model. CI tests read the committed fixtures instead.";
  }
  return null;
}

interface ModelEntry {
  id: string;
  [key: string]: unknown;
}
interface ProviderEntry {
  models?: ModelEntry[];
  [key: string]: unknown;
}
export interface ModelsJson {
  providers: Record<string, ProviderEntry>;
}
export interface ModelOverrides {
  contextWindow?: number;
  maxTokens?: number;
}

// The temp agent dir gets one provider with one model, copied from the
// owner's models.json (so its endpoint and key resolution are the owner's),
// plus per-scenario window overrides.
export function buildTempModelsJson(
  owner: ModelsJson,
  providerId: string,
  modelId: string,
  overrides: ModelOverrides = {},
): { providers: Record<string, ProviderEntry & { models: ModelEntry[] }> } {
  const provider = owner.providers?.[providerId];
  if (!provider) throw new Error(`pi models.json has no provider "${providerId}"`);
  const model = provider.models?.find((m) => m.id === modelId);
  if (!model) throw new Error(`pi models.json provider "${providerId}" has no model "${modelId}"`);
  const cleanModel = Object.fromEntries(Object.entries(model).filter(([key]) => !key.startsWith("_"))) as ModelEntry;
  return {
    providers: {
      [providerId]: { ...provider, models: [{ ...cleanModel, ...overrides }] },
    },
  };
}

export interface CompactionBudget {
  reserveTokens: number;
  keepRecentTokens: number;
}

export function buildTempSettings(providerId: string, modelId: string, compaction: CompactionBudget): Record<string, unknown> {
  return {
    defaultProvider: providerId,
    defaultModel: modelId,
    quietStartup: true,
    compaction: { enabled: true, ...compaction },
  };
}

// pi names a session folder after the cwd: no leading separator, then
// `/`, `\` and `:` as `-` (docs/session-format.md "File Location").
export function dashedPath(p: string): string {
  return p.replace(/^[/\\]+/, "").replace(/[/\\:]/g, "-");
}

function parseLines(text: string): { entries: Record<string, unknown>[]; malformed: number } {
  const entries: Record<string, unknown>[] = [];
  let malformed = 0;
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value === "object" && value !== null) entries.push(value as Record<string, unknown>);
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }
  return { entries, malformed };
}

function messageOf(entry: Record<string, unknown>): Record<string, unknown> | null {
  return typeof entry.message === "object" && entry.message !== null ? (entry.message as Record<string, unknown>) : null;
}

// pi's calculateContextTokens over the last assistant usage: what its
// compaction threshold compares against the context window.
export function lastAssistantContextTokens(text: string): number | null {
  let last: number | null = null;
  for (const entry of parseLines(text).entries) {
    const message = messageOf(entry);
    const usage = message?.role === "assistant" ? (message.usage as Record<string, unknown> | undefined) : undefined;
    if (!usage) continue;
    const n = (k: string): number => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
    const total = n("totalTokens") || n("input") + n("output") + n("cacheRead") + n("cacheWrite");
    if (total > 0) last = total;
  }
  return last;
}

export interface SessionCounts {
  entryTypes: Record<string, number>;
  messageRoles: Record<string, number>;
  stopReasons: Record<string, number>;
  turns: number;
  toolCalls: number;
  compactions: number;
  contextEdits: number;
  malformedLines: number;
}

const bump = (map: Record<string, number>, key: string): void => {
  map[key] = (map[key] ?? 0) + 1;
};

// Structure only: safe to print and commit, holds no text.
export function countSession(text: string): SessionCounts {
  const { entries, malformed } = parseLines(text);
  const counts: SessionCounts = {
    entryTypes: {}, messageRoles: {}, stopReasons: {}, turns: 0, toolCalls: 0, compactions: 0, contextEdits: 0, malformedLines: malformed,
  };
  for (const entry of entries) {
    const type = typeof entry.type === "string" ? entry.type : "(none)";
    bump(counts.entryTypes, type);
    if (type === "compaction") counts.compactions += 1;
    if (type === "context_edit") counts.contextEdits += 1;
    const message = messageOf(entry);
    const role = typeof message?.role === "string" ? message.role : undefined;
    if (!role) continue;
    bump(counts.messageRoles, role);
    if (role === "user") counts.turns += 1;
    if (role === "toolResult") counts.toolCalls += 1;
    if (role === "assistant" && typeof message?.stopReason === "string") bump(counts.stopReasons, message.stopReason);
  }
  return counts;
}

// ---- scenarios ----

// `window` on a restart: "threshold" sizes the context window so pi's
// threshold check compacts before the next prompt; "length" leaves the next
// response a few hundred output tokens, so it stops on `length` below the
// model's maxTokens, which pi recovers from with context_edit + compaction.
export type ScenarioStep =
  | { kind: "prompt"; text: string }
  | { kind: "idle" }
  | { kind: "compact" }
  | { kind: "restart"; window: "threshold" | "length" }
  | { kind: "fork"; userMessageIndex: number; text: string };

export interface Scenario {
  id: ScenarioId;
  stem: string;
  title: string;
  steps: ScenarioStep[];
}

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  s1: {
    id: "s1",
    stem: "pi-linear",
    title: "linear: 4 prompts, tool calls, one tool left unused, an idle gap",
    steps: [
      { kind: "prompt", text: "Read hello.ts and explain in two sentences what it does." },
      { kind: "prompt", text: "Use bash to run ls in this folder and tell me how many files there are." },
      { kind: "idle" },
      { kind: "prompt", text: "Add a one-line comment at the top of hello.ts that says: demo file." },
      { kind: "prompt", text: "In one sentence, what did you change?" },
    ],
  },
  s2: {
    id: "s2",
    stem: "pi-compaction",
    title: "compaction: manual /compact, then a threshold compaction after a restart with a small window",
    steps: [
      { kind: "prompt", text: "Read notes.md and list its headings." },
      { kind: "prompt", text: "Read hello.ts and suggest one improvement, in two sentences." },
      { kind: "compact" },
      { kind: "prompt", text: "Remind me in one sentence what we looked at so far." },
      { kind: "restart", window: "threshold" },
      { kind: "prompt", text: "Name one more improvement for hello.ts in one sentence." },
    ],
  },
  s3: {
    id: "s3",
    stem: "pi-context-edit",
    title: "context_edit: a restart with a tight window forces a length stop that pi recovers from",
    steps: [
      { kind: "prompt", text: "Read hello.ts and summarise it in one sentence." },
      { kind: "prompt", text: "What is the type of the function's parameter? Answer in a few words." },
      { kind: "restart", window: "length" },
      { kind: "prompt", text: "Write a numbered list of 200 short facts about the TypeScript language, one per line." },
    ],
  },
  s4: {
    id: "s4",
    stem: "pi-fork",
    title: "fork: /fork from the second prompt into a new session file",
    steps: [
      { kind: "prompt", text: "Read hello.ts and summarise it in one sentence." },
      { kind: "prompt", text: "Suggest a better name for the function, in a few words." },
      { kind: "fork", userMessageIndex: 1, text: "Suggest a better name for the exported constant, in a few words." },
    ],
  },
};

// Harmless files for the throwaway workspace.
export const WORKSPACE_FILES: Record<string, string> = {
  "hello.ts": "export const hello = (name: string): string => `Hello, ${name}!`;\n\nconsole.log(hello(\"world\"));\n",
  "notes.md": "# Demo notes\n\n## Goals\n\nGreet people.\n\n## Ideas\n\nAdd a farewell function.\n",
  "AGENTS.md": "# Demo project\n\nA tiny TypeScript demo. Keep answers short.\n",
};

// ---- manifest ----

export interface ManifestFile {
  file: string;
  sidecar?: string;
  sidecarRecords: number;
  counts: SessionCounts;
}

export interface ManifestScenario {
  id: ScenarioId;
  stem: string;
  status: "ok" | "skipped" | "failed";
  note?: string;
  files: ManifestFile[];
  durationSeconds: number;
}

export interface ManifestInput {
  piVersion: string;
  provider: string;
  model: string;
  variant: "default" | "gondolin";
  generatedOn: string;
  idleSeconds: number;
  scenarios: ManifestScenario[];
}

export function buildManifest(input: ManifestInput): Record<string, unknown> {
  return {
    generator: "packages/server/scripts/generate-pi-fixtures.mts",
    piVersion: input.piVersion,
    model: { provider: input.provider, id: input.model },
    variant: input.variant,
    generatedOn: input.generatedOn,
    idleSeconds: input.idleSeconds,
    scenarios: input.scenarios.map((s) => ({ ...s, title: SCENARIOS[s.id].title })),
  };
}
