// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadScenarioScripts } from "../../data-sources/learn-scripts/loader.js";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import { LearnSimulationService } from "./learn-simulation-service.js";
import { createSimulatedScenarioCatalog } from "./simulated-scenario-catalog.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const profiles = loadVendorProfiles(
  path.resolve(here, "../../../fixtures/vendor-profiles"),
);
const scripts = loadScenarioScripts();
const catalog = createSimulatedScenarioCatalog(
  new LearnSimulationService(scripts, profiles, "vscode-local"),
);

describe("createSimulatedScenarioCatalog (D3, D13)", () => {
  it("lists the 17 Copilot-applicable scenarios, without the 1-hour cache one", () => {
    const ids = catalog.list().map((s) => s.id);
    expect(ids).toHaveLength(17);
    expect(ids).not.toContain("cache-ttl-1-hour-breakpoint");
  });

  it("simulates every listed scenario on the default model, Claude Sonnet 5.5", () => {
    for (const session of catalog.list()) {
      expect(session.mode).toBe("learn");
      expect(session.model).toBe("claude-sonnet-5.5");
      expect(session.turns.every((t) => t.simulation !== undefined)).toBe(true);
    }
  });

  it("returns the same simulated session by id", () => {
    expect(catalog.get("clear")).toEqual(
      catalog.list().find((s) => s.id === "clear"),
    );
  });

  it("returns undefined for an unknown or non-applicable id", () => {
    expect(catalog.get("nope")).toBeUndefined();
    expect(catalog.get("cache-ttl-1-hour-breakpoint")).toBeUndefined();
  });
});
