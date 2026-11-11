// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The real-Copilot suite's guard while a chat runs (release-ui-gate.md R5):
// the pre-send picker check can't see every wrong model (on VS Code 1.146 a
// chat ran on Sonnet 5.5 with the picker on Claude Haiku 5.5, 16.06 AI
// Credits), so after sending, the suite watches the new session's Copilot
// debug log (the source the analyzer and the after-chat check read) and
// cancels the chat as soon as its first logged request names another model.
// A chat that starts in the Copilot SDK harness (a new Copilot CLI session
// in the run's COPILOT_HOME) writes no such log, so it is cancelled at once.
import { modelMatches } from "./copilot-e2e-env.mts";

const NANO_AIU_PER_AI_CREDIT = 1_000_000_000;

export interface LoggedRequest {
  model: string;
  // Null when the log has no usage for it: unknown, never 0.
  aiCredits: number | null;
  debugName?: string;
}

interface LlmRequestRecord {
  model?: unknown;
  copilotUsageNanoAiu?: unknown;
  debugName?: unknown;
}

// Complete lines only: the last one may still be being written.
function llmRequests(jsonl: string): LlmRequestRecord[] {
  return jsonl.split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    try {
      const record = JSON.parse(line) as { type?: unknown; attrs?: LlmRequestRecord };
      return record.type === "llm_request" && record.attrs ? [record.attrs] : [];
    } catch {
      return [];
    }
  });
}

function credits(nanoAiu: unknown): number | null {
  return typeof nanoAiu === "number" && Number.isFinite(nanoAiu) && nanoAiu >= 0 ? nanoAiu / NANO_AIU_PER_AI_CREDIT : null;
}

export function firstModelRequest(jsonl: string): LoggedRequest | undefined {
  const first = llmRequests(jsonl).find((attrs) => typeof attrs.model === "string" && attrs.model !== "");
  if (!first) return undefined;
  return {
    model: first.model as string,
    aiCredits: credits(first.copilotUsageNanoAiu),
    ...(typeof first.debugName === "string" ? { debugName: first.debugName } : {}),
  };
}

export function loggedCredits(jsonl: string): number {
  return llmRequests(jsonl).reduce((sum, attrs) => sum + (credits(attrs.copilotUsageNanoAiu) ?? 0), 0);
}

export function newEntries(before: ReadonlySet<string>, now: readonly string[]): string[] {
  return now.filter((entry) => !before.has(entry));
}

export interface InFlightInput {
  requested: string;
  firstRequest: LoggedRequest | undefined;
  // Copilot CLI session folders that appeared in the run's COPILOT_HOME since the chat was sent.
  agentHostSessions: readonly string[];
}

export type InFlightCheck = { verdict: "waiting" } | { verdict: "ok" } | { verdict: "cancel"; reason: string };

export function inFlightCheck({ requested, firstRequest, agentHostSessions }: InFlightInput): InFlightCheck {
  if (agentHostSessions.length > 0) {
    return {
      verdict: "cancel",
      reason: `the chat started in the Copilot SDK harness (agent host), whose model the suite doesn't pick, not in VS Code's local harness; cancelled before it could run on another model than ${requested}.`,
    };
  }
  if (firstRequest === undefined) return { verdict: "waiting" };
  if (modelMatches(requested, firstRequest.model)) return { verdict: "ok" };
  const cost = firstRequest.aiCredits === null ? "an unknown number of" : firstRequest.aiCredits.toFixed(4);
  return {
    verdict: "cancel",
    reason: `the chat's first request ran on "${firstRequest.model}", not ${requested} (${cost} AI Credits); the chat was cancelled.`,
  };
}
