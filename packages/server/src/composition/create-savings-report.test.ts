// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { savingsReportSchema, type SavingsReport } from "@agent-cost-analyzer/domain";
import { ClaudeCodeLogProvider } from "../data-sources/claude-code/claude-code-log-provider.js";
import { LogProviderRegistry } from "../data-sources/log-providers/registry.js";
import { PiAgentLogProvider } from "../data-sources/pi-agent/pi-agent-log-provider.js";
import { loadVendorProfiles } from "../data-sources/vendor-profiles/loader.js";
import { BundledPriceBookSource } from "../services/pricing/bundled-price-book-source.js";
import { PriceBook } from "../services/pricing/price-book.js";
import { COPILOT_CLI_FIXTURE_HOME, writeCopilotCliAgentHostStores } from "../test-support/copilot-cli-fixtures.js";
import { InMemoryAppSettingsStore } from "../test-support/in-memory-app-settings-store.js";
import { composeCopilotProviders } from "./compose-copilot-providers.js";
import { createSavingsReport } from "./create-savings-report.js";
import { createSessionAttributor } from "./create-session-attributor.js";
import { createSessionReplay } from "./create-session-replay.js";
import { createTurnPricer } from "./create-turn-pricer.js";

// Phase 16 SR10: one wiring of SavingsService for every product (the
// standalone app over every provider, the extension over Copilot only, D10),
// over the same price book, attribution, turn pricer and replay as the rest
// of each product.

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const profiles = loadVendorProfiles(path.join(fixtures, "vendor-profiles"));
// Wide enough for every fixture session; "today" so the price book has a price.
const RANGE = { since: "2026-01-01", until: "2026-11-30" };

function wiringOver(registry: LogProviderRegistry) {
  const priceBook = new PriceBook(new BundledPriceBookSource());
  const pricer = createTurnPricer(priceBook);
  const attribution = createSessionAttributor({ vendorProfiles: profiles });
  return createSavingsReport({
    providers: registry,
    profiles,
    priceBook,
    pricer,
    attribution,
    replay: createSessionReplay({ providers: registry, profiles, priceBook, pricer, attribution }),
  });
}

function providerIdsOf(report: SavingsReport): Set<string> {
  return new Set([
    ...[...report.opportunities, ...report.simulated].flatMap((opportunity) => opportunity.sessions.map((ref) => ref.providerId)),
    ...report.notAnalysed.map((row) => row.providerId),
  ]);
}

describe("createSavingsReport", () => {
  it("standalone: reports over every provider, with the replay only when asked", async () => {
    const registry = new LogProviderRegistry(
      [new ClaudeCodeLogProvider({ projectsDirPath: path.join(fixtures, "claude-code") }), new PiAgentLogProvider({ sessionsDirPath: path.join(fixtures, "pi-agent") })],
      new InMemoryAppSettingsStore(),
    );
    const service = wiringOver(registry);

    const report = await service.report(RANGE, { pricing: "today" });
    const withReplay = await service.report(RANGE, { pricing: "today", includeSimulated: true });

    expect(savingsReportSchema.safeParse(report).success).toBe(true);
    expect(savingsReportSchema.safeParse(withReplay).success).toBe(true);
    expect(providerIdsOf(report)).toEqual(new Set(["claude-code", "pi-agent"]));
    // pi's log records no request trace: its sessions are listed with the reason.
    expect(report.notAnalysed).toContainEqual(expect.objectContaining({ kind: "idle-cache-expiry", providerId: "pi-agent", reason: expect.stringMatching(/records no request trace/) }));
    expect(report.notAnalysed.some((row) => row.kind === "cheaper-model")).toBe(false);
    // Asked for, the replay ran: these fixtures' sessions say why it couldn't price them.
    expect(withReplay.notAnalysed.some((row) => row.kind === "cheaper-model")).toBe(true);
  });

  describe("extension (D10: Copilot sessions only)", () => {
    let userDataDir: string;
    beforeAll(() => {
      userDataDir = mkdtempSync(path.join(tmpdir(), "savings-report-ah-"));
      writeCopilotCliAgentHostStores(userDataDir);
    });
    afterAll(() => rmSync(userDataDir, { recursive: true, force: true }));

    it("reports over the extension's Copilot-only registry", async () => {
      const { registry } = composeCopilotProviders({
        sessionStoreDbPath: path.join("/nonexistent", "state.vscdb"),
        debugLogsDirPaths: [],
        agentTracesDbPath: null,
        agentHostUserDataDir: userDataDir,
        copilotHome: COPILOT_CLI_FIXTURE_HOME,
        vscodeSettingsPath: null,
        appSettings: new InMemoryAppSettingsStore(),
      });

      const report = await wiringOver(registry).report(RANGE, { pricing: "today", includeSimulated: true });

      expect(savingsReportSchema.safeParse(report).success).toBe(true);
      expect(providerIdsOf(report)).toEqual(new Set(["vscode"]));
      // The replay's saving names the Copilot price version it was priced at.
      expect(report.simulated[0]?.perWindow).toMatchObject({ known: true, basis: "simulated", priceVersionIds: [expect.stringMatching(/^github-copilot:claude-haiku-5\.5:/)] });
    });
  });
});
