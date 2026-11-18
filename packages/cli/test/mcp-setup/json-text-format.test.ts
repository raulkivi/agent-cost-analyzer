// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  detectJsonTextFormat,
  formatJsonText,
  NEW_FILE_FORMAT,
} from "../../src/mcp-setup/json-text-format.js";

describe("detectJsonTextFormat", () => {
  it("finds a two-space indent, LF and a final newline", () => {
    expect(detectJsonTextFormat('{\n  "a": 1\n}\n')).toEqual({
      bom: false,
      eol: "\n",
      indent: "  ",
      finalNewline: true,
    });
  });

  it("finds a tab indent", () => {
    expect(detectJsonTextFormat('{\n\t"a": {\n\t\t"b": 1\n\t}\n}').indent).toBe(
      "\t",
    );
  });

  it("finds a four-space indent from the first indented line", () => {
    expect(
      detectJsonTextFormat('{\n    "a": {\n        "b": 1\n    }\n}').indent,
    ).toBe("    ");
  });

  it("defaults to two spaces for a one-line file", () => {
    expect(detectJsonTextFormat('{"a":1}').indent).toBe("  ");
  });

  it("finds CRLF, a BOM and a missing final newline", () => {
    expect(detectJsonTextFormat('\uFEFF{\r\n  "a": 1\r\n}')).toEqual({
      bom: true,
      eol: "\r\n",
      indent: "  ",
      finalNewline: false,
    });
  });
});

describe("formatJsonText", () => {
  it("writes new files with two spaces, LF and a final newline", () => {
    expect(formatJsonText({ a: [1] }, NEW_FILE_FORMAT)).toBe(
      '{\n  "a": [\n    1\n  ]\n}\n',
    );
  });

  it("puts back the BOM, CRLF and the indent it was given", () => {
    expect(
      formatJsonText(
        { a: 1 },
        { bom: true, eol: "\r\n", indent: "\t", finalNewline: true },
      ),
    ).toBe('\uFEFF{\r\n\t"a": 1\r\n}\r\n');
  });
});
