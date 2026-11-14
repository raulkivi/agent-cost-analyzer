// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readRecordLines } from "../../platform/files/read-record-lines.js";

// VS Code sometimes titles an Agent Host session with the opening of its first
// prompt. That is prompt text, not a title, so the app treats it as untitled
// (owner decision, 2026-11-14): nothing downstream (lists, statements, MCP
// answers) may carry it.

// Line breaks and runs of whitespace (U+2028/U+2029 included) become one space.
function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// VS Code truncates with "..." or "…"; what remains is the prompt's opening.
function withoutTrailingEllipsis(title: string): string {
  return title.replace(/(?:\.\.\.|…)$/, "").trimEnd();
}

// True when the title, less a trailing ellipsis, is the start of the first
// prompt. A title that is only an ellipsis (nothing left to compare) is not.
export function isPromptEchoTitle(title: string, firstPrompt: string): boolean {
  const stem = withoutTrailingEllipsis(normalise(title));
  const prompt = normalise(firstPrompt);
  return stem !== "" && prompt !== "" && prompt.startsWith(stem);
}

// The first user.message's text, read from the head of the log only: the
// stream stops at it, so a long log costs no more than its first lines.
// null when the log is missing, unreadable or has no user message with text.
export async function readFirstUserPrompt(logPath: string): Promise<string | null> {
  try {
    for await (const line of readRecordLines(logPath)) {
      if (!line.includes('"user.message"')) {
        continue;
      }
      const content = parseUserMessageContent(line);
      if (content !== null) {
        return content;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function parseUserMessageContent(line: string): string | null {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof event !== "object" || event === null) {
    return null;
  }
  const { type, data } = event as { type?: unknown; data?: unknown };
  if (type !== "user.message" || typeof data !== "object" || data === null) {
    return null;
  }
  const content = (data as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}
