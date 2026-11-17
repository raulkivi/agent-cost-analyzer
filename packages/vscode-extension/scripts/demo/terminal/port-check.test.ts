// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { assertPortFree } from "./port-check.mts";

describe("assertPortFree", () => {
  it("passes when the port can be bound", async () => {
    await expect(assertPortFree(5199, async () => true)).resolves.toBeUndefined();
  });
  it("fails clearly when something holds the port, saying what to do", async () => {
    await expect(assertPortFree(5199, async () => false)).rejects.toThrow(/5199 is in use.*stop/i);
  });
});
