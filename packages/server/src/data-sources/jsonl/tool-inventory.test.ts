// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readMainJsonlEnvelopes } from "./main-jsonl-reader.js";
import type { JsonlEnvelope } from "./main-jsonl-reader.js";
import {
  buildToolInventory,
  extractInvokedToolNamesByTurn,
} from "./tool-inventory.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/jsonl",
);
const realSessionPath = path.join(fixturesDir, "real-session-with-usage.jsonl");

describe("extractInvokedToolNamesByTurn", () => {
  it("groups tool_call names by SQLite turn, in call order (real fixture)", async () => {
    const envelopes = await readMainJsonlEnvelopes(realSessionPath);

    expect(extractInvokedToolNamesByTurn(envelopes)).toEqual([
      ["manage_todo_list", "read_file"],
      ["manage_todo_list", "run_in_terminal"],
    ]);
  });

  it("returns an empty array when there is no user_message event", () => {
    const envelopes: JsonlEnvelope[] = [{ type: "session_start" }];

    expect(extractInvokedToolNamesByTurn(envelopes)).toEqual([]);
  });

  it("returns an empty tool list for a turn with no tool_call events", () => {
    const envelopes: JsonlEnvelope[] = [
      { type: "user_message" },
      { type: "llm_request", attrs: {} },
    ];

    expect(extractInvokedToolNamesByTurn(envelopes)).toEqual([[]]);
  });
});

describe("buildToolInventory", () => {
  const invokedByTurn = [
    ["manage_todo_list", "read_file"],
    ["manage_todo_list", "run_in_terminal"],
  ];

  it("marks every loaded tool, real invocation turns, in the loaded list's order", () => {
    const loadedToolNames = [
      "create_file",
      "read_file",
      "run_in_terminal",
      "manage_todo_list",
    ];

    expect(buildToolInventory(loadedToolNames, invokedByTurn)).toEqual([
      { name: "create_file", loaded: true, invokedInTurns: [] },
      { name: "read_file", loaded: true, invokedInTurns: [0] },
      { name: "run_in_terminal", loaded: true, invokedInTurns: [1] },
      { name: "manage_todo_list", loaded: true, invokedInTurns: [0, 1] },
    ]);
  });

  it("appends an invoked tool missing from the loaded list as loaded:false, never dropping it", () => {
    const loadedToolNames = ["read_file"];
    const invokedWithUnknownTool = [["read_file", "some_new_tool"]];

    expect(buildToolInventory(loadedToolNames, invokedWithUnknownTool)).toEqual([
      { name: "read_file", loaded: true, invokedInTurns: [0] },
      { name: "some_new_tool", loaded: false, invokedInTurns: [0] },
    ]);
  });

  it("falls back to invoked-only entries, all loaded:true, when the tools file couldn't be read", () => {
    expect(buildToolInventory(null, invokedByTurn)).toEqual([
      { name: "manage_todo_list", loaded: true, invokedInTurns: [0, 1] },
      { name: "read_file", loaded: true, invokedInTurns: [0] },
      { name: "run_in_terminal", loaded: true, invokedInTurns: [1] },
    ]);
  });

  it("returns an empty array when nothing was loaded or invoked", () => {
    expect(buildToolInventory(null, [])).toEqual([]);
    expect(buildToolInventory([], [])).toEqual([]);
  });
});

describe("buildToolInventory definition tokens", () => {
  const tokens = (name: string) => ({ known: true as const, value: name.length, estimated: true });

  it("adds each entry's definition tokens when a lookup is given", () => {
    expect(buildToolInventory(["read_file"], [["read_file", "stray_tool"]], tokens)).toEqual([
      { name: "read_file", loaded: true, invokedInTurns: [0], definitionTokens: tokens("read_file") },
      { name: "stray_tool", loaded: false, invokedInTurns: [0], definitionTokens: tokens("stray_tool") },
    ]);
  });

  it("keeps an unknown count, with its reason, on the entry", () => {
    const unknown = () => ({ known: false as const, reason: "The tools file could not be read, so this tool's definition size is unknown." });

    expect(buildToolInventory(null, [["read_file"]], unknown)).toEqual([
      { name: "read_file", loaded: true, invokedInTurns: [0], definitionTokens: unknown() },
    ]);
  });

  it("leaves definitionTokens off when no lookup is given", () => {
    expect(buildToolInventory(["read_file"], [[]])).toEqual([{ name: "read_file", loaded: true, invokedInTurns: [] }]);
  });
});

