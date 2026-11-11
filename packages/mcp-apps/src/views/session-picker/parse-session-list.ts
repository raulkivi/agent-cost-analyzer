// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SessionListEntry, SessionListInput } from "../../view-models/index.js";

// The host hands over structuredContent as unknown. This keeps the entries
// the picker can show (an id, a title, a turn count and a model) and drops
// the rest; the server has already validated the shape against its output
// schema.

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function entryOf(value: unknown): SessionListEntry | undefined {
  if (!isObject(value) || typeof value.id !== "string" || value.id === "" || typeof value.title !== "string" || typeof value.turnCount !== "number" || typeof value.model !== "string") return undefined;
  return {
    id: value.id,
    title: value.title,
    turnCount: value.turnCount,
    model: value.model,
    ...(typeof value.startedAt === "string" ? { startedAt: value.startedAt } : {}),
    ...(typeof value.repositoryKey === "string" ? { repositoryKey: value.repositoryKey } : {}),
  };
}

export function parseSessionList(value: unknown): SessionListInput | undefined {
  if (!isObject(value) || typeof value.total !== "number" || !Array.isArray(value.sessions)) return undefined;
  const sessions = value.sessions.map(entryOf);
  if (sessions.some((entry) => entry === undefined)) return undefined;
  return { total: value.total, sessions: sessions as SessionListEntry[] };
}
