// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JsonlEnvelope } from "../../data-sources/jsonl/main-jsonl-reader.js";
import { estimateTokenCount } from "../../data-sources/jsonl/token-estimator.js";
import { buildAnalyzeModeExtras } from "./analyze-mode-extras.js";

// Phase 16 SR2: per-tool definition tokens on the VS Code local inventory.
// Synthetic tool definitions only.
const readFile = { type: "function", name: "read_file", description: "Reads a file.", parameters: { type: "object" } };
const makeFile = { type: "function", name: "make_file", description: "Makes a file from the given content, creating folders as needed.", parameters: { type: "object", properties: { path: { type: "string" } } } };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "extras-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeTools(fileName: string, definitions: unknown[]): void {
  writeFileSync(path.join(dir, fileName), JSON.stringify({ content: JSON.stringify(definitions) }));
}

function span(toolsFile: string): JsonlEnvelope {
  return { type: "llm_request", attrs: { systemPromptFile: "system_prompt_0.json", toolsFile } };
}

describe("buildAnalyzeModeExtras tool inventory definition tokens", () => {
  it("counts each loaded tool's own definition, labelled estimated", async () => {
    writeTools("tools_0.json", [readFile, makeFile]);
    const envelopes: JsonlEnvelope[] = [{ type: "user_message" }, span("tools_0.json"), { type: "tool_call", name: "read_file" }];

    const { toolInventory } = await buildAnalyzeModeExtras(envelopes, path.join(dir, "main.jsonl"));

    expect(toolInventory).toEqual([
      { name: "read_file", loaded: true, invokedInTurns: [0], definitionTokens: estimateTokenCount(JSON.stringify(readFile)) },
      { name: "make_file", loaded: true, invokedInTurns: [], definitionTokens: estimateTokenCount(JSON.stringify(makeFile)) },
    ]);
    expect(toolInventory[1].definitionTokens).toMatchObject({ known: true, estimated: true });
  });

  it("uses the tools file of the last request, since the list changes mid-session", async () => {
    writeTools("tools_0.json", [readFile]);
    writeTools("tools_1.json", [readFile, makeFile]);
    const envelopes: JsonlEnvelope[] = [{ type: "user_message" }, span("tools_0.json"), span("tools_1.json")];

    const { toolInventory } = await buildAnalyzeModeExtras(envelopes, path.join(dir, "main.jsonl"));

    expect(toolInventory.map((entry) => entry.name)).toEqual(["read_file", "make_file"]);
  });

  it("is unknown with a reason when the tools file is missing", async () => {
    const envelopes: JsonlEnvelope[] = [{ type: "user_message" }, span("tools_9.json"), { type: "tool_call", name: "read_file" }];

    const { toolInventory } = await buildAnalyzeModeExtras(envelopes, path.join(dir, "main.jsonl"));

    expect(toolInventory).toEqual([
      { name: "read_file", loaded: true, invokedInTurns: [0], definitionTokens: { known: false, reason: expect.stringContaining("could not be read") } },
    ]);
  });

  it("leaves definition tokens off when no request names a tools file", async () => {
    const envelopes: JsonlEnvelope[] = [{ type: "user_message" }, { type: "tool_call", name: "read_file" }];

    const { toolInventory } = await buildAnalyzeModeExtras(envelopes, path.join(dir, "main.jsonl"));

    expect(toolInventory).toEqual([{ name: "read_file", loaded: true, invokedInTurns: [0] }]);
  });
});
