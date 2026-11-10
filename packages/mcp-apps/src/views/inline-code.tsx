// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";

// Server text uses Markdown-style `code` spans. Splitting on backticks and
// building elements keeps logged text inert: no HTML, no Markdown parser.
// Odd segments sit between a backtick pair; a trailing unmatched backtick
// stays literal.
export function InlineCode({ text }: { text: string }): ReactNode {
  const parts = text.split("`");
  // With an even part count the last backtick has no partner.
  const unmatchedFrom = parts.length % 2 === 0 ? parts.length - 1 : parts.length;
  const out: ReactNode[] = [];
  let literal = "";
  const flush = () => {
    if (literal) out.push(literal);
    literal = "";
  };
  parts.forEach((part, i) => {
    if (i % 2 === 1 && i < unmatchedFrom && part !== "") {
      flush();
      out.push(
        <code key={i} className="inline-code">
          {part}
        </code>,
      );
    } else if (i % 2 === 1 && i < unmatchedFrom) {
      literal += "``"; // an empty pair is not a span
    } else if (i === unmatchedFrom) {
      literal += "`" + part;
    } else {
      literal += part;
    }
  });
  flush();
  return <>{out}</>;
}
