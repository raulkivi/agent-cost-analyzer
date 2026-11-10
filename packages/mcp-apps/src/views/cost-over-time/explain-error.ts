// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// A tool error as U9 explains it (docs/plans/mcp-apps.md §9.1, question 1).
// In the extension get_project_cost answers
//   Unknown project id "x". Call list_projects to find valid ids. <reason>
// where the server appends the product's no-projects reason; the view puts
// that reason where the chart would be. Any other error shows the tool's text
// as it is. The text is plain: it is only ever rendered as a text node and
// never sent on to the model.

export type ErrorExplanation = { kind: "no-projects"; reason: string; answer: string } | { kind: "error"; text?: string };

const MAX_TEXT = 500;
const UNKNOWN_PROJECT = /^(Unknown project id "[^"\n]*")\. Call list_projects to find valid ids\.\s+(\S[\s\S]*)$/;

export function explainError(errorText: string | undefined): ErrorExplanation {
  const text = errorText?.trim() ?? "";
  if (text === "") return { kind: "error" };
  const match = UNKNOWN_PROJECT.exec(text);
  if (match !== null) return { kind: "no-projects", answer: match[1]!, reason: match[2]!.slice(0, MAX_TEXT) };
  return { kind: "error", text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text };
}
