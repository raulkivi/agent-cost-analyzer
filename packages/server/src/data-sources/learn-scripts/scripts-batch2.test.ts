import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scenarioScriptSchema } from "@agent-cost-analyzer/domain";

const scriptsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/learn-scripts",
);

const IDS = [
  "rewind",
  "session-forking",
  "cache-ttl-smoke-break",
  "instructions-edit",
  "silent-instructions-pullin",
  "inline-exploration-bloat",
];

describe.each(IDS)("learn script %s", (id) => {
  const raw: unknown = JSON.parse(
    readFileSync(path.join(scriptsDir, `${id}.json`), "utf-8"),
  );

  it("is a valid ScenarioScript whose id matches its filename", () => {
    const script = scenarioScriptSchema.parse(raw);
    expect(script.id).toBe(id);
    expect(script.harnesses.length).toBeGreaterThan(0);
  });

  it("numbers its steps consecutively from 1", () => {
    const script = scenarioScriptSchema.parse(raw);
    expect(script.steps.map((step) => step.index)).toEqual(
      script.steps.map((_, position) => position + 1),
    );
  });

  it("keeps vendor-neutral explanations free of digits", () => {
    const script = scenarioScriptSchema.parse(raw);
    for (const step of script.steps) {
      expect(step.explanation).not.toMatch(/\d/);
    }
  });
});
