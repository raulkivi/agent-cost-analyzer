// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { EXTENSION_NO_PROJECTS_REASON } from "./no-projects-reason.js";

// The tools' answer to an unknown project id, and its reader. The server
// writes it; the MCP App views read it back to show the product's
// no-projects reason in place of a chart. One wording for both, so neither
// copies it.

const PREFIX = 'Unknown project id "';
const SUFFIX = '". Call list_projects to find valid ids.';
const KNOWN_REASONS: readonly string[] = [EXTENSION_NO_PROJECTS_REASON];

export function unknownProjectIdText(projectId: string, noProjectsReason?: string): string {
  const answer = `${PREFIX}${projectId}${SUFFIX}`;
  return noProjectsReason === undefined ? answer : `${answer} ${noProjectsReason}`;
}

export interface UnknownProjectIdAnswer {
  projectId: string;
  noProjectsReason?: string;
}

// Only a known reason counts as one. The project id is the model's own
// argument, so text after the answer is matched against the reasons a
// product sends, never taken as given.
export function parseUnknownProjectIdText(text: string): UnknownProjectIdAnswer | undefined {
  if (!text.startsWith(PREFIX)) return undefined;
  for (const reason of KNOWN_REASONS) {
    const tail = `${SUFFIX} ${reason}`;
    if (text.length >= PREFIX.length + tail.length && text.endsWith(tail)) return { projectId: text.slice(PREFIX.length, text.length - tail.length), noProjectsReason: reason };
  }
  if (text.length >= PREFIX.length + SUFFIX.length && text.endsWith(SUFFIX)) return { projectId: text.slice(PREFIX.length, text.length - SUFFIX.length) };
  return undefined;
}
