export interface PayloadToken {
  text: string;
  color: string;
}

// Matches Design/README.md's token table exactly — don't hard-code hex,
// map straight to the "Industry" theme custom properties.
export const PAYLOAD_TOKEN_COLORS = {
  key: "var(--color-accent-800)",
  str: "var(--color-text)",
  num: "var(--color-accent-600)",
  punc: "color-mix(in srgb, var(--color-text) 62%, transparent)",
  plain: "var(--color-text)",
} as const;

type TokenKind = keyof typeof PAYLOAD_TOKEN_COLORS;

function push(out: PayloadToken[], text: string, kind: TokenKind): void {
  out.push({ text, color: PAYLOAD_TOKEN_COLORS[kind] });
}

// Plain-prose payloads (a model's final answer, a tool result) arrive with
// literal escape sequences the same way JSON string values do. Pretty mode
// interprets them so the text reads as written; Raw mode leaves the bytes
// exactly as captured — this is why this is a standalone export rather than
// only an internal step of JSON string formatting.
export function unescapeText(text: string): string {
  return text.replace(/\\(n|t|r|"|'|\\)/g, (_match, escaped: string) => {
    if (escaped === "n") return "\n";
    if (escaped === "t") return "\t";
    if (escaped === "r") return "\r";
    return escaped;
  });
}

function formatJsonValue(value: unknown, indent: number, out: PayloadToken[]): void {
  const pad = "  ".repeat(indent);
  const childPad = "  ".repeat(indent + 1);

  if (value === null) {
    push(out, "null", "num");
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      push(out, "[]", "punc");
      return;
    }
    push(out, "[\n", "punc");
    value.forEach((element, index) => {
      push(out, childPad, "punc");
      formatJsonValue(element, indent + 1, out);
      if (index < value.length - 1) push(out, ",", "punc");
      push(out, "\n", "punc");
    });
    push(out, `${pad}]`, "punc");
    return;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      push(out, "{}", "punc");
      return;
    }
    push(out, "{\n", "punc");
    keys.forEach((key, index) => {
      push(out, childPad, "punc");
      push(out, `"${key}"`, "key");
      push(out, ": ", "punc");
      formatJsonValue((value as Record<string, unknown>)[key], indent + 1, out);
      if (index < keys.length - 1) push(out, ",", "punc");
      push(out, "\n", "punc");
    });
    push(out, `${pad}}`, "punc");
    return;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const looksLikeJson =
      (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
    if (looksLikeJson) {
      try {
        formatJsonValue(JSON.parse(trimmed), indent, out);
        return;
      } catch {
        // Not actually JSON — fall through to plain string formatting.
      }
    }
    const quoted = JSON.stringify(value);
    if (quoted.includes("\\n")) {
      push(out, quoted.split("\\n").join(`\n${childPad}`), "str");
      return;
    }
    push(out, quoted, "str");
    return;
  }

  push(out, String(value), "num");
}

// Finds the index of the brace/bracket that closes the one at `start`,
// tracking string literals (and their escapes) so a `}`/`]` inside a
// string doesn't end the scan early. Returns -1 if unbalanced.
function findJsonValueEnd(text: string, start: number): number {
  const open = text.charAt(start);
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text.charAt(i);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === open) {
      depth++;
    } else if (char === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Splits `text` into concatenated top-level JSON values plus the plain-text
// runs between them, pretty-printing each JSON value found. Returns null
// when no JSON value is found at all, so callers can fall back to
// unescaped plain text instead of a no-op single "plain" token.
export function buildPrettyTokens(text: string): PayloadToken[] | null {
  const out: PayloadToken[] = [];
  let cursor = 0;
  let plainStart = 0;
  let foundAny = false;

  while (cursor < text.length) {
    const char = text.charAt(cursor);
    if (char === "{" || char === "[") {
      const end = findJsonValueEnd(text, cursor);
      if (end > cursor) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text.slice(cursor, end + 1));
        } catch {
          parsed = undefined;
        }
        if (parsed !== undefined) {
          if (cursor > plainStart) push(out, text.slice(plainStart, cursor), "plain");
          formatJsonValue(parsed, 0, out);
          push(out, "\n", "punc");
          foundAny = true;
          cursor = end + 1;
          plainStart = cursor;
          continue;
        }
      }
    }
    cursor++;
  }

  if (plainStart < text.length) push(out, text.slice(plainStart), "plain");
  return foundAny ? out : null;
}
