import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionSchema } from "@agent-cost-analyzer/domain";
import { getLearnScenario, listLearnScenarios, loadLearnScenarios } from "./loader.js";

const bundledFixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/learn-scenarios",
);

describe("learn-scenarios loader", () => {
  it("lists bundled scenarios as valid learn-mode Sessions", () => {
    const scenarios = listLearnScenarios();

    expect(scenarios.length).toBeGreaterThanOrEqual(18);
    for (const scenario of scenarios) {
      expect(() => sessionSchema.parse(scenario)).not.toThrow();
      expect(scenario.mode).toBe("learn");
      expect(scenario.turns.length).toBeGreaterThan(0);
    }
  });

  it("returns each scenario's full Session by id", () => {
    const [first] = listLearnScenarios();

    expect(getLearnScenario(first.id)).toEqual(first);
  });

  it("returns undefined for an unknown scenario id", () => {
    expect(getLearnScenario("does-not-exist")).toBeUndefined();
  });
});

// G4 (vscode-extension.md §2.2): a bundle can't locate the fixtures through
// import.meta.url, so the directory is injectable; the default stays the
// package's own fixtures/learn-scenarios.
describe("loadLearnScenarios", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "learn-scenarios-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to the bundled fixtures directory", () => {
    expect(loadLearnScenarios().list()).toEqual(listLearnScenarios());
  });

  it("reads scenarios from an injected fixtures directory", () => {
    copyFileSync(path.join(bundledFixturesDir, "cache-basics.json"), path.join(dir, "cache-basics.json"));
    const { id } = JSON.parse(readFileSync(path.join(dir, "cache-basics.json"), "utf-8")) as { id: string };

    const catalog = loadLearnScenarios({ fixturesDir: dir });

    expect(catalog.list().map((scenario) => scenario.id)).toEqual([id]);
    expect(catalog.get(id)).toEqual(getLearnScenario(id));
    expect(catalog.get("does-not-exist")).toBeUndefined();
  });

  it("fails fast on a fixture that isn't a learn-mode scenario", () => {
    const raw = JSON.parse(readFileSync(path.join(bundledFixturesDir, "cache-basics.json"), "utf-8")) as object;
    writeFileSync(path.join(dir, "bad.json"), JSON.stringify({ ...raw, mode: "analyze" }));

    expect(() => loadLearnScenarios({ fixturesDir: dir })).toThrow(/must have mode "learn"/);
  });
});
