// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { estimateTokenCount } from "./token-estimator.js";
import { toolDefinitionTokenLookup, toolDefinitionTokensByName } from "./tool-definition-tokens.js";

// Synthetic tool definitions only (no real tool text).
const readFile = { type: "function", name: "read_file", description: "Reads a file.", parameters: { type: "object", properties: { path: { type: "string" } } } };
const makeFile = { type: "function", name: "make_file", description: "Makes a file from the given content.", parameters: { type: "object" } };

describe("toolDefinitionTokensByName", () => {
  it("counts each tool's own JSON with the local tokenizer, labelled estimated", () => {
    const byName = toolDefinitionTokensByName([readFile, makeFile]);

    expect(byName.get("read_file")).toEqual(estimateTokenCount(JSON.stringify(readFile)));
    expect(byName.get("make_file")).toEqual(estimateTokenCount(JSON.stringify(makeFile)));
    expect(byName.get("read_file")).toMatchObject({ known: true, estimated: true });
  });

  it("skips entries with no name", () => {
    expect([...toolDefinitionTokensByName([{ description: "x" }, "text", null]).keys()]).toEqual([]);
  });
});

describe("toolDefinitionTokenLookup", () => {
  it("returns the counted tokens for a tool in the file", () => {
    const lookup = toolDefinitionTokenLookup([readFile]);

    expect(lookup("read_file")).toEqual(estimateTokenCount(JSON.stringify(readFile)));
  });

  it("is unknown with a reason for a tool the file does not hold", () => {
    const lookup = toolDefinitionTokenLookup([readFile]);

    expect(lookup("other_tool")).toEqual({ known: false, reason: expect.stringContaining("not in the tools file") });
  });

  it("is unknown with a reason for every tool when the file could not be read", () => {
    const lookup = toolDefinitionTokenLookup(null);

    expect(lookup("read_file")).toEqual({ known: false, reason: expect.stringContaining("could not be read") });
  });

  it("uses the caller's reasons when the source is not a tools file", () => {
    const reasons = { unreadable: "u", absent: "This tool is no longer declared." };

    expect(toolDefinitionTokenLookup([readFile], reasons)("gone")).toEqual({ known: false, reason: reasons.absent });
    expect(toolDefinitionTokenLookup(null, reasons)("gone")).toEqual({ known: false, reason: "u" });
  });
});
