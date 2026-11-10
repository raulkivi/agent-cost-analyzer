// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { parseUnknownProjectIdText } from "@agent-cost-analyzer/domain";

// A tool error as U9 explains it (docs/plans/mcp-apps.md §9.1, question 1).
// In the extension get_project_cost answers an unknown id with the product's
// no-projects reason appended (domain's unknownProjectIdText); the view puts
// that reason where the chart would be. Only a reason the domain knows
// counts, so a crafted project id can't fake the state. Any other error shows
// the tool's text as it is. The text is plain: it is only ever rendered as a
// text node and never sent on to the model.

export type ErrorExplanation = { kind: "no-projects"; reason: string; answer: string } | { kind: "error"; text?: string };

const MAX_TEXT = 500;
const MAX_ID = 120;

const capped = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function explainError(errorText: string | undefined): ErrorExplanation {
  const text = errorText?.trim() ?? "";
  if (text === "") return { kind: "error" };
  const answer = parseUnknownProjectIdText(text);
  if (answer?.noProjectsReason !== undefined) return { kind: "no-projects", answer: `Unknown project id "${capped(answer.projectId, MAX_ID)}"`, reason: answer.noProjectsReason };
  return { kind: "error", text: capped(text, MAX_TEXT) };
}
