// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { estimateTokenCount } from "../jsonl/token-estimator.js";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { buildClaudeCodeToolInventory, toolDefinitionTokensByShape } from "./tool-shape-inventory.js";

// Phase 16 SR2 (savings-report.md §15 d): Claude Code records each distinct
// request shape (`api-request-shape`) once and names it by `shapeHash` on
// every `api-request`. Synthetic tools only.
const readTool = { name: "Read", description: "Reads a file from disk.", input_schema: { type: "object", properties: { path: { type: "string" } } } };
const mcpTool = { name: "mcp__demo__lookup", description: "Looks a record up in the demo service, by key.", input_schema: { type: "object" } };
const deferredTool = { name: "mcp__demo__rare", description: "A long description that is not sent while the tool is deferred.", input_schema: { type: "object" }, defer_loading: true };
const stubTool = { name: "mcp__demo__stub", type: "custom", model: "x", defer_loading: true };

function shape(shapeHash: string, tools: unknown[]): ClaudeCodeRawEntry {
  return { type: "api-request-shape", shapeHash, shape: { system: [{ type: "text", text: "SYSTEM TEXT MUST NOT BE KEPT" }], tools } };
}

function request(shapeHash: string, querySource = "repl_main_thread:outputStyle:custom"): ClaudeCodeRawEntry {
  return { type: "api-request", id: `r-${shapeHash}`, querySource, shapeHash };
}

describe("toolDefinitionTokensByShape", () => {
  it("counts description plus input_schema per tool, labelled estimated", () => {
    const byShape = toolDefinitionTokensByShape([shape("h1", [readTool, mcpTool])]);

    expect(byShape.get("h1")?.get("Read")).toEqual(estimateTokenCount(readTool.description + JSON.stringify(readTool.input_schema)));
    expect(byShape.get("h1")?.get("Read")).toMatchObject({ known: true, estimated: true });
  });

  it("counts a deferred tool at name-only cost", () => {
    const byShape = toolDefinitionTokensByShape([shape("h1", [deferredTool, stubTool])]);

    expect(byShape.get("h1")?.get("mcp__demo__rare")).toEqual(estimateTokenCount("mcp__demo__rare"));
    expect(byShape.get("h1")?.get("mcp__demo__stub")).toEqual(estimateTokenCount("mcp__demo__stub"));
  });

  it("keeps one entry per shape hash and ignores entries that are not shapes", () => {
    const byShape = toolDefinitionTokensByShape([shape("h1", [readTool]), shape("h2", [mcpTool]), request("h1"), { type: "user" }, shape("h3", "not an array" as never)]);

    expect([...byShape.keys()]).toEqual(["h1", "h2"]);
  });
});

describe("buildClaudeCodeToolInventory", () => {
  it("lists the tools of the last main-thread request's shape with the turns that invoked them", () => {
    const entries = [shape("h1", [readTool]), request("h1"), shape("h2", [readTool, mcpTool]), request("h2")];

    expect(buildClaudeCodeToolInventory(entries, [["Read"], [], ["Read"]])).toEqual([
      { name: "Read", loaded: true, invokedInTurns: [0, 2], definitionTokens: estimateTokenCount(readTool.description + JSON.stringify(readTool.input_schema)) },
      { name: "mcp__demo__lookup", loaded: true, invokedInTurns: [], definitionTokens: estimateTokenCount(mcpTool.description + JSON.stringify(mcpTool.input_schema)) },
    ]);
  });

  it("ignores requests of other query sources while a main-thread request exists", () => {
    const entries = [shape("h1", [readTool]), shape("h2", [mcpTool]), request("h1"), request("h2", "sdk")];

    expect(buildClaudeCodeToolInventory(entries, [])?.map((entry) => entry.name)).toEqual(["Read"]);
  });

  it("marks a tool invoked but not in the shape as not loaded, with an unknown size and a reason", () => {
    const entries = [shape("h1", [readTool]), request("h1")];

    expect(buildClaudeCodeToolInventory(entries, [["Bash"]])?.find((entry) => entry.name === "Bash")).toEqual({
      name: "Bash",
      loaded: false,
      invokedInTurns: [0],
      definitionTokens: { known: false, reason: expect.stringContaining("not in the request shape") },
    });
  });

  it("is undefined when the log has no request shape, not an empty inventory", () => {
    expect(buildClaudeCodeToolInventory([request("h1")], [])).toBeUndefined();
    expect(buildClaudeCodeToolInventory([], [])).toBeUndefined();
  });

  it("keeps no prompt or system text on the result", () => {
    const entries = [shape("h1", [readTool]), request("h1")];

    expect(JSON.stringify(buildClaudeCodeToolInventory(entries, []))).not.toContain("SYSTEM TEXT");
    expect(JSON.stringify(buildClaudeCodeToolInventory(entries, []))).not.toContain("Reads a file");
  });
});
