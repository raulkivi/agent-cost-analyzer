// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { subagentRunIdSchema } from "@agent-cost-analyzer/domain";

// A run's agent-<id>.meta.json holds flags, ids and enums, but also the
// prompt's `description` and a `worktreePath` (plan §4.2). Only the keys below
// survive parsing; every other key is dropped so it can't reach a figure, the
// UI or MCP output (threat model: meta, information disclosure).
export const MAX_SUBAGENT_META_BYTES = 64 * 1024;

// Same alphabet and length as the agent part of a run label (plan §5.1).
const AGENT_TYPE = /^[A-Za-z0-9_.: -]{1,64}$/;
const MAX_SPAWN_DEPTH = 1000;

export interface SubagentMeta {
  /** Links the run to the parent's `Agent` call (CS0b §13). */
  toolUseId?: string;
  agentType?: string;
  isBuiltIn?: boolean;
  spawnDepth?: number;
  /** Names another run's agent id in the same folder; never joined into a path. */
  parentAgentId?: string;
  isFork?: boolean;
  finished?: boolean;
}

export type SubagentMetaResult =
  | { status: "ok"; meta: SubagentMeta }
  | { status: "malformed" }
  | { status: "too-large" };

const idOrUndefined = (value: unknown): string | undefined => {
  const parsed = subagentRunIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};
const agentTypeOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" && AGENT_TYPE.test(value) ? value : undefined;
const flagOrUndefined = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);
const depthOrUndefined = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_SPAWN_DEPTH ? value : undefined;

// One entry per kept key: adding a key is one line (open-closed).
const KEEP: { [K in keyof SubagentMeta]-?: (value: unknown) => SubagentMeta[K] } = {
  toolUseId: idOrUndefined,
  agentType: agentTypeOrUndefined,
  isBuiltIn: flagOrUndefined,
  spawnDepth: depthOrUndefined,
  parentAgentId: idOrUndefined,
  isFork: flagOrUndefined,
  finished: flagOrUndefined,
};

/** Parses a meta file's text, keeping allow-listed keys with valid values only. */
export function parseSubagentMeta(text: string): SubagentMetaResult {
  if (Buffer.byteLength(text, "utf8") > MAX_SUBAGENT_META_BYTES) return { status: "too-large" };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: "malformed" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { status: "malformed" };

  const meta: Record<string, unknown> = {};
  for (const [key, keep] of Object.entries(KEEP)) {
    if (!Object.hasOwn(raw, key)) continue;
    const value = keep((raw as Record<string, unknown>)[key]);
    if (value !== undefined) meta[key] = value;
  }
  return { status: "ok", meta: meta as SubagentMeta };
}
