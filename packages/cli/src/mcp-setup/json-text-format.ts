// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// The layout of a JSON file that JSON.parse throws away, so a rewrite can
// put it back and a user's diff shows only the entry that changed.
export interface JsonTextFormat {
  bom: boolean;
  eol: "\n" | "\r\n";
  /** One indent level: a tab or a run of spaces. */
  indent: string;
  finalNewline: boolean;
}

export const NEW_FILE_FORMAT: JsonTextFormat = {
  bom: false,
  eol: "\n",
  indent: "  ",
  finalNewline: true,
};

const BOM = "\uFEFF";

export function detectJsonTextFormat(text: string): JsonTextFormat {
  // JSON strings cannot hold raw newlines, so the first indented line is a
  // structural line one level deep: its whitespace is one indent level.
  const indented = /\n([ \t]+)\S/.exec(text);
  return {
    bom: text.startsWith(BOM),
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    indent: indented ? indented[1] : NEW_FILE_FORMAT.indent,
    finalNewline: text.endsWith("\n"),
  };
}

export function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

export function formatJsonText(value: unknown, format: JsonTextFormat): string {
  // JSON.stringify escapes newlines inside strings, so every "\n" it emits
  // is a line break and can take the file's own line ending.
  const body = JSON.stringify(value, null, format.indent).replace(
    /\n/g,
    format.eol,
  );
  return (
    (format.bom ? BOM : "") + body + (format.finalNewline ? format.eol : "")
  );
}
