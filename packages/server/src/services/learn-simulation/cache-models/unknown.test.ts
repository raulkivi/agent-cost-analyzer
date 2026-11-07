// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { CacheModel } from "../cache-model.js";
import { UnknownCacheModel } from "./unknown.js";
import { buildPrompt } from "../prompt-builder.js";

describe("UnknownCacheModel", () => {
  it("returns an unknown outcome with the reason and no counts", () => {
    const m: CacheModel = new UnknownCacheModel({
      kind: "unknown",
      reason: "undocumented",
    });
    const r = m.request({
      prompt: buildPrompt({ tools: 100, system: 50, messages: 20 }),
      atMinute: 0,
    });
    expect(r).toEqual({ outcome: "unknown", reason: "undocumented" });
    expect(r).not.toHaveProperty("cacheRead");
    expect(r).not.toHaveProperty("uncachedInput");
  });
});
