// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ScriptEvent, VendorProfile } from "@agent-cost-analyzer/domain";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import { InvalidationPolicy } from "./invalidation-policy.js";

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/vendor-profiles",
);
const profiles = loadVendorProfiles(fixtures);
const policyFor = (vendorId: string) =>
  new InvalidationPolicy(profiles.find((p) => p.vendorId === vendorId)!);

const tools: ScriptEvent = { type: "tools-changed", deltaTokens: 10 };
const system: ScriptEvent = {
  type: "system-changed",
  deltaTokens: 10,
  cause: "edit",
};
const rule = (
  change: VendorProfile["invalidation"][number]["change"],
  invalidatesFrom: VendorProfile["invalidation"][number]["invalidatesFrom"],
  extra: Partial<VendorProfile["invalidation"][number]> = {},
): VendorProfile["invalidation"][number] => ({
  change,
  invalidatesFrom,
  confidence: "documented",
  sourceIds: [`${change}-src`],
  ...extra,
});

describe("InvalidationPolicy", () => {
  it("returns a neutral result when nothing happened", () => {
    expect(policyFor("anthropic").evaluate([])).toEqual({
      unknown: false,
      modelSpecific: false,
      confidence: "documented",
      sourceIds: [],
      causes: [],
    });
  });

  it("ignores events with no cache effect", () => {
    const result = policyFor("anthropic").evaluate([{ type: "extended-ttl" }]);
    expect(result.invalidatedFrom).toBeUndefined();
    expect(result.causes).toEqual([]);
  });

  it("S8: images invalidate from messages (Anthropic)", () => {
    const policy = policyFor("anthropic");
    for (const type of ["image-added", "image-removed"] as const) {
      const result = policy.evaluate([{ type }]);
      expect(result.invalidatedFrom).toBe("messages");
      expect(result.confidence).toBe("documented");
      expect(result.sourceIds).toContain("anthropic-pc-images");
    }
  });

  it("S9: a system change invalidates from system (Anthropic)", () => {
    expect(policyFor("anthropic").evaluate([system]).invalidatedFrom).toBe(
      "system",
    );
  });

  it("S10: a tools change invalidates everything (Anthropic)", () => {
    expect(policyFor("anthropic").evaluate([tools]).invalidatedFrom).toBe(
      "tools",
    );
  });

  it("S11: a thinking change invalidates messages and is model-specific (Anthropic)", () => {
    const result = policyFor("anthropic").evaluate([
      { type: "thinking-changed", enabled: true },
    ]);
    expect(result.invalidatedFrom).toBe("messages");
    expect(result.modelSpecific).toBe(true);
    expect(result.causes).toEqual(["thinking-changed"]);
  });

  it("S12: a model switch carries nothing over (Anthropic)", () => {
    const result = policyFor("anthropic").evaluate([
      { type: "model-switch", toRole: "cheaper" },
    ]);
    expect(result.invalidatedFrom).toBe("tools");
  });

  it("never reports unknown for fully documented Anthropic rules", () => {
    expect(policyFor("anthropic").evaluate([tools, system]).unknown).toBe(
      false,
    );
  });

  it("xAI: unknown rules surface as unknown, never as 'nothing' or a layer", () => {
    const result = policyFor("xai").evaluate([tools]);
    expect(result.unknown).toBe(true);
    expect(result.invalidatedFrom).toBeUndefined();
    expect(result.confidence).toBe("unknown");
    expect(result.sourceIds).toEqual([]);
  });

  it("the earliest layer wins when several events combine", () => {
    const p = new InvalidationPolicy({
      invalidation: [
        rule("tools-changed", "tools"),
        rule("system-changed", "system"),
      ],
    });
    expect(p.evaluate([system, tools]).invalidatedFrom).toBe("tools");
    expect(p.evaluate([system]).invalidatedFrom).toBe("system");
  });

  it("takes the weakest confidence and the deduped union of sources", () => {
    const p = new InvalidationPolicy({
      invalidation: [
        rule("tools-changed", "tools", { sourceIds: ["a", "b"] }),
        rule("system-changed", "system", {
          confidence: "inferred",
          sourceIds: ["b", "c"],
        }),
      ],
    });
    const result = p.evaluate([tools, system]);
    expect(result.confidence).toBe("inferred");
    expect(result.sourceIds).toEqual(["a", "b", "c"]);
    expect(result.causes).toEqual(["tools-changed", "system-changed"]);
  });

  it("'nothing' applies a rule without invalidating", () => {
    const p = new InvalidationPolicy({
      invalidation: [rule("tools-changed", "nothing")],
    });
    const result = p.evaluate([tools]);
    expect(result.invalidatedFrom).toBeUndefined();
    expect(result.unknown).toBe(false);
    expect(result.sourceIds).toEqual(["tools-changed-src"]);
  });

  it("a change kind with no profile rule counts as unknown", () => {
    const result = new InvalidationPolicy({ invalidation: [] }).evaluate([
      tools,
    ]);
    expect(result.unknown).toBe(true);
    expect(result.confidence).toBe("unknown");
  });

  it("keeps a known layer when another event in the turn is unknown", () => {
    const p = new InvalidationPolicy({
      invalidation: [
        rule("tools-changed", "tools"),
        rule("system-changed", "unknown", {
          confidence: "unknown",
          sourceIds: [],
        }),
      ],
    });
    const result = p.evaluate([tools, system]);
    expect(result.unknown).toBe(true);
    expect(result.invalidatedFrom).toBe("tools");
  });

  it("S13-S15: compaction, clear, rewind and fork invalidate messages for any vendor", () => {
    const events: ScriptEvent[] = [
      { type: "compaction", summaryTokens: 100 },
      { type: "clear" },
      { type: "rewind", toStep: 1 },
      { type: "fork", branch: "b", fromStep: 1 },
    ];
    for (const event of events) {
      const result = policyFor("xai").evaluate([event]);
      expect(result).toMatchObject({
        invalidatedFrom: "messages",
        unknown: false,
        confidence: "inferred",
        sourceIds: [],
      });
    }
  });
});
