// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { toolInventoryEntrySchema } from "./tool-inventory-entry.js";

describe("toolInventoryEntrySchema", () => {
  it("accepts a loaded, invoked tool", () => {
    const sample = { name: "read_file", loaded: true, invokedInTurns: [0, 2, 5] };

    expect(toolInventoryEntrySchema.parse(sample)).toEqual(sample);
  });

  it("accepts a loaded but never-invoked tool", () => {
    const sample = { name: "create_file", loaded: true, invokedInTurns: [] };

    expect(toolInventoryEntrySchema.parse(sample)).toEqual(sample);
  });

  it("rejects a tool missing the loaded flag", () => {
    expect(() => toolInventoryEntrySchema.parse({ name: "read_file", invokedInTurns: [] })).toThrow();
  });

  it("accepts an estimated definition token count", () => {
    const sample = { name: "read_file", loaded: true, invokedInTurns: [], definitionTokens: { known: true, value: 120, estimated: true } };

    expect(toolInventoryEntrySchema.parse(sample)).toEqual(sample);
  });

  it("accepts an unknown definition token count with its reason", () => {
    const sample = { name: "read_file", loaded: true, invokedInTurns: [], definitionTokens: { known: false, reason: "The tools file could not be read." } };

    expect(toolInventoryEntrySchema.parse(sample)).toEqual(sample);
  });

  it("rejects a definition token count with neither a value nor a reason", () => {
    expect(() => toolInventoryEntrySchema.parse({ name: "read_file", loaded: true, invokedInTurns: [], definitionTokens: { known: false } })).toThrow();
  });
});
