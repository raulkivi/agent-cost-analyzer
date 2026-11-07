// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type {
  ScenarioScript,
  VendorProfile,
} from "@agent-cost-analyzer/domain";
import {
  GENERATED_END,
  GENERATED_START,
  generateScenarioDocs,
  replaceGeneratedRegion,
  type ScenarioFile,
} from "./generate-docs.js";

describe("replaceGeneratedRegion", () => {
  const doc = `# T\n\nintro\n\n${GENERATED_START}\nold\n${GENERATED_END}\n\n**Sources**\n`;

  it("replaces only what is between the markers", () => {
    const next = replaceGeneratedRegion(doc, "new\ntext");
    expect(next).toBe(
      `# T\n\nintro\n\n${GENERATED_START}\nnew\ntext\n${GENERATED_END}\n\n**Sources**\n`,
    );
  });

  it("is idempotent", () => {
    const once = replaceGeneratedRegion(doc, "new");
    expect(replaceGeneratedRegion(once, "new")).toBe(once);
  });

  it("fails loudly when a marker is missing", () => {
    expect(() => replaceGeneratedRegion("# T\n", "x")).toThrow(
      /scenarios:generated/,
    );
  });
});

const profile = {
  vendorId: "anthropic",
  displayName: "Anthropic",
  defaultModelId: "m",
  caching: {
    kind: "breakpoints",
    defaultTtlMinutes: 5,
    refreshOnHit: true,
    minCacheableTokens: 10,
    layers: ["tools", "system", "messages"],
  },
  invalidation: [],
  models: [
    {
      modelId: "m",
      displayName: "Model M",
      vendorId: "anthropic",
      releaseStatus: "GA",
      tiers: [
        {
          inputUsdPerM: 2,
          cachedInputUsdPerM: 0.2,
          cacheWriteUsdPerM: 2.5,
          outputUsdPerM: 10,
        },
      ],
      sourceIds: ["s"],
    },
  ],
  assumptions: [],
  sources: [{ id: "s", title: "t", url: "u", checkedAt: "2026-11-03" }],
} as VendorProfile;

const script = (id: string, title: string): ScenarioScript => ({
  id,
  title,
  category: "C",
  harnesses: ["claude-code"],
  sessionKind: "main",
  staticPrefix: { toolsTokens: 500, systemTokens: 500 },
  steps: [
    {
      index: 1,
      userMessage: "u",
      assistantResponse: "a",
      toolCalls: [],
      explanation: "First turn.",
      newContent: {
        userTokens: 100,
        toolResultTokens: 0,
        reasoningTokens: 0,
        outputTokens: 50,
      },
      events: [],
    },
  ],
});

const files: ScenarioFile[] = [
  { number: 1, file: "01-a.md", scriptId: "a" },
  { number: 2, file: "02-b.md", scriptId: "b" },
];

describe("generateScenarioDocs", () => {
  const perDoc = (title: string, n: number, link: string) =>
    `# Scenario ${n}: ${title}\n\n> src\n\nSee [other](${link}).\n\n${GENERATED_START}\nstale\n${GENERATED_END}\n\n**Sources**\n`;
  const docs = {
    "01-a.md": perDoc("A", 1, "02-b.md"),
    "02-b.md": perDoc("B", 2, "01-a.md"),
    "all-scenarios.md": `# All\n\ncontents\n\n---\n\n${GENERATED_START}\nstale\n${GENERATED_END}\n`,
  };
  const out = generateScenarioDocs({
    docs,
    scripts: [script("a", "A"), script("b", "B")],
    profile,
    modelId: "m",
    files,
  });

  it("regenerates each scenario doc's table from its script", () => {
    expect(out["01-a.md"]).toContain("| 1 | First turn. |");
    expect(out["01-a.md"]).not.toContain("stale");
    expect(out["01-a.md"]).toContain("Simulated on Model M");
  });

  it("leaves the prose around the region untouched", () => {
    expect(
      out["01-a.md"]!.startsWith(
        "# Scenario 1: A\n\n> src\n\nSee [other](02-b.md).",
      ),
    ).toBe(true);
  });

  it("builds all-scenarios.md from the regenerated docs with in-page links", () => {
    const all = out["all-scenarios.md"]!;
    expect(all).toContain('<a id="scenario-1"></a>\n\n## Scenario 1: A');
    expect(all).toContain("See [other](#scenario-2).");
    expect(all).toContain('\n\n---\n\n<a id="scenario-2"></a>');
    expect(all).toContain("| 1 | First turn. |");
    // one pair of markers: the sections' own markers are stripped
    expect(all.split(GENERATED_START)).toHaveLength(2);
  });

  it("fails when a script is missing for a doc", () => {
    expect(() =>
      generateScenarioDocs({
        docs,
        scripts: [script("a", "A")],
        profile,
        modelId: "m",
        files,
      }),
    ).toThrow(/script "b"/);
  });
});
