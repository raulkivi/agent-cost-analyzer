// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { createCacheModel } from "./index.js";
import { BreakpointCacheModel } from "./breakpoint.js";
import { AutomaticPrefixCacheModel } from "./automatic-prefix.js";
import { BestEffortCacheModel } from "./best-effort.js";
import { UnknownCacheModel } from "./unknown.js";

describe("createCacheModel", () => {
  it("builds the strategy matching the caching kind", () => {
    expect(
      createCacheModel({
        kind: "breakpoints",
        defaultTtlMinutes: 5,
        refreshOnHit: true,
        minCacheableTokens: 1,
        layers: ["tools"],
      }),
    ).toBeInstanceOf(BreakpointCacheModel);
    expect(
      createCacheModel({
        kind: "automatic-prefix",
        ttlMinutes: { fixed: 5 },
        writeCharged: false,
        minCacheableTokens: 1,
      }),
    ).toBeInstanceOf(AutomaticPrefixCacheModel);
    expect(
      createCacheModel(
        { kind: "best-effort", note: "n" },
        { assumedTtlMinutes: 5 },
      ),
    ).toBeInstanceOf(BestEffortCacheModel);
    expect(createCacheModel({ kind: "unknown", reason: "r" })).toBeInstanceOf(
      UnknownCacheModel,
    );
  });

  it("requires an assumed TTL for best-effort kinds", () => {
    expect(() => createCacheModel({ kind: "best-effort", note: "n" })).toThrow(
      /assumedTtlMinutes/,
    );
  });
});
