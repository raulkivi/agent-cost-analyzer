import { describe, expect, it } from "vitest";
import { buildPrettyTokens, PAYLOAD_TOKEN_COLORS, unescapeText } from "./turn-payload-pretty.js";

function text(tokens: ReturnType<typeof buildPrettyTokens>): string {
  return (tokens ?? []).map((token) => token.text).join("");
}

describe("unescapeText", () => {
  it("interprets \\n, \\t, \\r, \\\", \\', and \\\\ literally", () => {
    expect(unescapeText("a\\nb\\tc\\rd\\\"e\\'f\\\\g")).toBe("a\nb\tc\rd\"e'f\\g");
  });

  it("leaves already-literal whitespace untouched", () => {
    expect(unescapeText("a\nb")).toBe("a\nb");
  });
});

describe("buildPrettyTokens", () => {
  it("returns null for plain prose with no embedded JSON", () => {
    expect(buildPrettyTokens("just a sentence, no braces here")).toBeNull();
  });

  it("pretty-prints a single top-level JSON object with 2-space indent", () => {
    const tokens = buildPrettyTokens('{"a":1,"b":"two"}');
    expect(tokens).not.toBeNull();
    expect(text(tokens)).toBe('{\n  "a": 1,\n  "b": "two"\n}\n');
  });

  it("splits multiple concatenated top-level JSON values onto their own lines", () => {
    const tokens = buildPrettyTokens('{"a":1}{"b":2}');
    expect(text(tokens)).toBe('{\n  "a": 1\n}\n{\n  "b": 2\n}\n');
  });

  it("expands a JSON-in-string field (tool call arguments) into a nested object", () => {
    const tokens = buildPrettyTokens('{"name":"read_file","arguments":"{\\"filePath\\":\\"src/foo.ts\\"}"}');
    expect(text(tokens)).toBe(
      '{\n  "name": "read_file",\n  "arguments": {\n    "filePath": "src/foo.ts"\n  }\n}\n',
    );
  });

  it("preserves surrounding plain text around an embedded JSON value", () => {
    const tokens = buildPrettyTokens('Warning: too many.\n{"a":1}');
    expect(text(tokens)).toBe('Warning: too many.\n{\n  "a": 1\n}\n');
  });

  it("colors object keys, string values, numeric/boolean/null scalars, and punctuation distinctly", () => {
    const tokens = buildPrettyTokens('{"n":1,"s":"x","b":true,"z":null}') ?? [];
    const key = tokens.find((token) => token.text === '"n"');
    const str = tokens.find((token) => token.text === '"x"');
    const num = tokens.find((token) => token.text === "1");
    const bool = tokens.find((token) => token.text === "true");
    const nullTok = tokens.find((token) => token.text === "null");
    const punc = tokens.find((token) => token.text === "{\n");

    expect(key?.color).toBe(PAYLOAD_TOKEN_COLORS.key);
    expect(str?.color).toBe(PAYLOAD_TOKEN_COLORS.str);
    expect(num?.color).toBe(PAYLOAD_TOKEN_COLORS.num);
    expect(bool?.color).toBe(PAYLOAD_TOKEN_COLORS.num);
    expect(nullTok?.color).toBe(PAYLOAD_TOKEN_COLORS.num);
    expect(punc?.color).toBe(PAYLOAD_TOKEN_COLORS.punc);
  });

  it("returns null rather than throwing on an unbalanced brace", () => {
    expect(buildPrettyTokens('not json { at all')).toBeNull();
  });
});
