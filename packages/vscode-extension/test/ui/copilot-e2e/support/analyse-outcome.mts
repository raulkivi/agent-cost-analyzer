// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What U5's Analyse did in a real Copilot Chat (A33; owner, 2026-11-11,
// docs/plans/mcp-apps.md §9.2 Q7: try, then fall back). VS Code advertises no
// `message` capability, so the view tries. Three outcomes are told apart:
//   - sent: the chat gains exactly one request, with the fixed text
//     "Analyse session <id>";
//   - staged: VS Code accepts the message but puts exactly that text in the
//     chat input, unsent (VS Code 1.146, A33's first run): no model turn;
//   - fallback: VS Code declines and the row shows the text to type.
// Anything else fails the check.
// The chat list is virtualised (earlier requests may not be in the DOM), so
// "exactly one new request" is the analyzer's turn count for the run's new
// chats, and the text is read from the requests the chat shows.

// The row after the press: its button reads Sent, it shows the text to type,
// or neither has happened yet.
export type AnalyseRowState = "sent" | "fallback" | "pending";

export type AnalyseOutcome =
  | { kind: "sent"; request: string }
  | { kind: "staged"; input: string }
  | { kind: "fallback"; text: string }
  | { kind: "failed"; reason: string };

export interface AnalyseObservation {
  sessionId: string;
  // Turns of the run's new chats, before the press and after it settled.
  turnsBefore: number;
  turnsAfter: number;
  // The text of each request the chat shows after the press.
  requestTexts: readonly string[];
  // What the chat input holds after the press ("" when empty).
  inputText?: string;
  row: AnalyseRowState;
}

// VS Code's editor renders spaces as no-break spaces; \s covers both.
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

export function analyseOutcome({ sessionId, turnsBefore, turnsAfter, requestTexts, inputText = "", row }: AnalyseObservation): AnalyseOutcome {
  const message = `Analyse session ${sessionId}`;
  const added = turnsAfter - turnsBefore;
  const shown = requestTexts.map(collapse).filter((text) => text === message).length;
  if (added > 1) return { kind: "failed", reason: `${added} new chat requests after one press` };
  if (added === 1) {
    if (row === "fallback") return { kind: "failed", reason: "both a new chat request and the row's text to type" };
    if (shown === 0) return { kind: "failed", reason: `the chat gained a request, but no request shows the fixed text "${message}"` };
    if (shown > 1) return { kind: "failed", reason: `${shown} requests show the fixed text "${message}"` };
    return { kind: "sent", request: message };
  }
  if (shown > 0) return { kind: "failed", reason: `the chat shows the fixed text but gained no turn (${turnsBefore} before, ${turnsAfter} after)` };
  if (row === "fallback") return { kind: "fallback", text: `Ask in the chat: ${message}` };
  if (row === "sent") {
    const input = collapse(inputText);
    if (input === message) return { kind: "staged", input };
    if (input !== "") return { kind: "failed", reason: `the view says Sent, the chat gained no request, and its input holds something else: ${JSON.stringify(input)}` };
    return { kind: "failed", reason: "the view says Sent but the chat gained no request" };
  }
  return { kind: "failed", reason: "neither a new chat request nor the row's text to type appeared" };
}
