// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { composeLogProviders } from "./compose-log-providers.js";
import { createMcpServices } from "./mcp-services.js";
import { createStandaloneAttribution } from "./create-standalone-attribution.js";
import { createStandalonePriceBook } from "./create-price-book.js";
import { createTurnPricer } from "./create-turn-pricer.js";
import { InMemoryStatementStore } from "../test-support/in-memory-statement-store.js";

// The configured clock (AGENT_COST_ANALYZER_NOW) reaches the billing pair,
// as in the standalone app's composition: estimate_cost's window and
// get_statement's "has the period ended" follow it, not the real date.
describe("createMcpServices clock", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mcp-services-clock-"));
    writeFileSync(
      path.join(dir, "projects.json"),
      JSON.stringify({ version: 1, projects: [{ id: "portal", name: "Customer portal", members: [{ repository: "github.com/acme/portal" }] }], aliases: {}, captureRules: [] }),
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function servicesAt(now: () => Date) {
    const { registry } = composeLogProviders({
      sessionStoreDbPath: path.join(dir, "missing.db"),
      debugLogsDirPaths: [],
      vscodeSettingsPath: path.join(dir, "settings.json"),
      agentTracesDbPath: null,
      agentHostUserDataDir: null,
      appSettingsDir: dir,
      mitmproxyCapturesDirPath: null,
      piAgentSessionsDirPath: null,
      systemPromptLogPath: null,
      claudeCodeProjectsDirPath: null,
    });
    const attribution = createStandaloneAttribution(registry, dir);
    const priceBook = createStandalonePriceBook(dir, attribution.catalog);
    return createMcpServices(
      registry,
      "0.1.0-test",
      undefined,
      attribution,
      createTurnPricer(priceBook),
      priceBook,
      { store: new InMemoryStatementStore(), projects: attribution.catalog, priceBookHash: () => "test", timeZone: "UTC" },
      undefined,
      now,
    );
  }

  it("windows estimates on the configured clock", async () => {
    const deps = servicesAt(() => new Date("2026-11-06T12:00:00.000Z"));
    const estimate = await deps.estimates!.estimate({ projectId: "portal", unit: "activeDays", planned: 5, weeks: 12 });
    expect(estimate?.window).toMatchObject({ since: "2026-08-15", until: "2026-11-06" });
  });

  it("decides whether a statement period has ended on the configured clock", async () => {
    const early = await servicesAt(() => new Date("2026-11-06T12:00:00.000Z")).statements!.get({ projectId: "portal", period: "2026-11" });
    expect(early?.canIssue.ok).toBe(false);
    const late = await servicesAt(() => new Date("2026-12-02T12:00:00.000Z")).statements!.get({ projectId: "portal", period: "2026-11" });
    expect(late?.canIssue.ok).toBe(true);
  });
});
