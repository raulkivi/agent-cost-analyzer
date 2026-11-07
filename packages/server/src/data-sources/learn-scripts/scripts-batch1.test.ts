// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scenarioScriptSchema } from "@agent-cost-analyzer/domain";

const dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/learn-scripts",
);
const IDS = [
  "cache-basics",
  "subagent-session",
  "compaction",
  "model-switch",
  "mcp-tool-change",
  "clear",
];

function load(id: string) {
  const raw: unknown = JSON.parse(
    readFileSync(path.join(dir, `${id}.json`), "utf-8"),
  );
  return scenarioScriptSchema.parse(raw);
}

describe.each(IDS)("learn script %s (batch 1)", (id) => {
  const script = load(id);

  it("has an id matching its filename and at least one harness", () => {
    expect(script.id).toBe(id);
    expect(script.harnesses.length).toBeGreaterThan(0);
  });

  it("numbers steps consecutively from 1", () => {
    expect(script.steps.map((s) => s.index)).toEqual(
      script.steps.map((_, i) => i + 1),
    );
  });

  it("keeps explanations vendor-neutral: no digits", () => {
    for (const step of script.steps) expect(step.explanation).not.toMatch(/\d/);
  });
});

describe("batch 1 story shape", () => {
  it("cache-basics has no images: an image would invalidate its normal growth (R-03)", () => {
    const steps = load("cache-basics").steps;
    expect(steps.every((s) => s.newContent.images === undefined)).toBe(true);
  });

  it("subagent-session is a subagent of cache-basics", () => {
    const script = load("subagent-session");
    expect(script.sessionKind).toBe("subagent");
    expect(script.parentScenarioId).toBe("cache-basics");
  });

  it("compaction carries one compaction event on step 3", () => {
    const steps = load("compaction").steps;
    expect(steps[2]?.events).toEqual([
      { type: "compaction", summaryTokens: 400 },
    ]);
  });

  it("model-switch, mcp-tool-change and clear each carry their event on step 3", () => {
    expect(load("model-switch").steps[2]?.events[0]?.type).toBe("model-switch");
    expect(load("mcp-tool-change").steps[2]?.events[0]?.type).toBe(
      "tools-changed",
    );
    expect(load("clear").steps[2]?.events[0]?.type).toBe("clear");
  });

  it("clear has VS Code wording that replaces the /clear text", () => {
    const text = load("clear").textByHarness;
    for (const harness of ["vscode-local", "copilot-agent-host"] as const) {
      expect(text?.[harness]?.userMessages).toHaveLength(5);
      expect(text?.[harness]?.explanations).toHaveLength(5);
      expect(text?.[harness]?.userMessages?.join(" ")).not.toContain("/clear");
      expect(text?.[harness]?.explanations?.join(" ")).not.toContain("/clear");
    }
  });
});
