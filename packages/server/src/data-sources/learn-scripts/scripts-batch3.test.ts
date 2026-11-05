import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scenarioScriptSchema } from "@agent-cost-analyzer/domain";

const SCRIPTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/learn-scripts",
);

const IDS = [
  "cache-ttl-1-hour-breakpoint",
  "cascading-model-switch-then-ttl-lapse",
  "image-attachment-invalidation",
  "reasoning-budget-toggle",
  "session-forking-multi-branch",
  "subagent-cheaper-model",
];

describe.each(IDS)("learn script %s", (id) => {
  const raw: unknown = JSON.parse(
    readFileSync(path.join(SCRIPTS_DIR, `${id}.json`), "utf-8"),
  );

  it("is a valid ScenarioScript whose id matches the filename", () => {
    const script = scenarioScriptSchema.parse(raw);
    expect(script.id).toBe(id);
    expect(script.harnesses.length).toBeGreaterThan(0);
  });

  it("numbers steps consecutively from 1", () => {
    const script = scenarioScriptSchema.parse(raw);
    expect(script.steps.map((step) => step.index)).toEqual(
      script.steps.map((_, position) => position + 1),
    );
  });
});

describe("batch 3 specifics", () => {
  const load = (id: string) =>
    scenarioScriptSchema.parse(
      JSON.parse(readFileSync(path.join(SCRIPTS_DIR, `${id}.json`), "utf-8")),
    );

  it("limits the 1-hour breakpoint scenario to the claude-code harness", () => {
    expect(load("cache-ttl-1-hour-breakpoint").harnesses).toEqual([
      "claude-code",
    ]);
  });

  it("gives images as pixel sizes", () => {
    const images = load("image-attachment-invalidation").steps.flatMap(
      (step) => step.newContent.images ?? [],
    );
    expect(images).toHaveLength(2);
  });

  it("marks the cheaper-model subagent as a subagent session", () => {
    expect(load("subagent-cheaper-model").sessionKind).toBe("subagent");
  });
});
