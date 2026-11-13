// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { savingsReportSchema, type SavingsReport } from "@agent-cost-analyzer/domain";
import { ClaudeCodeLogProvider } from "../data-sources/claude-code/claude-code-log-provider.js";
import { LogProviderRegistry } from "../data-sources/log-providers/registry.js";
import { loadVendorProfiles } from "../data-sources/vendor-profiles/loader.js";
import { createSavingsReport } from "../composition/create-savings-report.js";
import { createSessionAttributor } from "../composition/create-session-attributor.js";
import { createSessionReplay } from "../composition/create-session-replay.js";
import { createTurnPricer } from "../composition/create-turn-pricer.js";
import { BundledPriceBookSource } from "../services/pricing/bundled-price-book-source.js";
import { PriceBook } from "../services/pricing/price-book.js";
import { InMemoryAppSettingsStore } from "./in-memory-app-settings-store.js";
import { createExtensionApiService } from "../composition/create-extension-api-service.js";
import { COPILOT_CLI_FIXTURE_HOME, writeCopilotCliAgentHostStores } from "./copilot-cli-fixtures.js";
import { seedCopilotSessionStore, writeUsageDebugLog } from "./copilot-session-store.js";
import {
  SAVINGS_AGENT_HOST_SESSION_ID,
    SAVINGS_VSCODE_SESSION_ID,
  writeSavingsAgentHostSession,
  writeSavingsClaudeCodeSession,
  writeSavingsVscodeSession,
} from "./savings-fixtures.js";

// Phase 16 SR13 (docs/plans/savings-report.md §10): what the report finds in
// the savings fixtures, committed as JSON under __golden__/ (update with
// `vitest -u` after checking the diff by hand). The window is the e2e web
// home's: its clock is 2026-11-06, so the default 30 days start 2026-10-08.

const here = path.dirname(fileURLToPath(import.meta.url));
const profiles = loadVendorProfiles(path.join(here, "../../fixtures/vendor-profiles"));
const NOW = new Date("2026-11-06T12:00:00.000Z");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function serviceOver(registry: LogProviderRegistry) {
  const priceBook = new PriceBook(new BundledPriceBookSource());
  const pricer = createTurnPricer(priceBook, () => NOW);
  const attribution = createSessionAttributor({ vendorProfiles: profiles });
  return createSavingsReport({
    providers: registry,
    profiles,
    priceBook,
    pricer,
    attribution,
    replay: createSessionReplay({ providers: registry, profiles, priceBook, pricer, attribution }),
    now: () => NOW,
  });
}

describe("savings fixtures: the Claude Code session (web-e2e home)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "savings-fixtures-"));
    writeSavingsClaudeCodeSession(dir, "/home/dev/scratch", "2026-10-30");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("loses the cache to an idle gap and to a model switch", async () => {
    const registry = new LogProviderRegistry([new ClaudeCodeLogProvider({ projectsDirPath: dir })], new InMemoryAppSettingsStore());

    const report: SavingsReport = await serviceOver(registry).report();

    expect(savingsReportSchema.parse(report)).toEqual(report);
    // Claude Code's session id hashes the log's path, which is a temp folder here.
    const ids = new Set(report.opportunities.flatMap((o) => o.sessions.map((ref) => ref.sessionId)));
    expect(ids.size).toBe(1);
    await expect(json(report).replaceAll([...ids][0]!, "<claude-code-session>")).toMatchFileSnapshot("./__golden__/savings-claude-code-session.json");
    expect(report.opportunities.map((o) => o.kind).sort()).toEqual(["idle-cache-expiry", "model-switch"]);
    expect(report.opportunities.every((o) => o.sessions.some((ref) => ref.sessionId.length > 0))).toBe(true);
  });
});

describe("savings fixtures: the Copilot sessions (extension-ui home)", () => {
  let dir: string;
  let userDataDir: string;
  let copilotHome: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "savings-fixtures-vscode-"));
    userDataDir = path.join(dir, "user-data");
    copilotHome = path.join(dir, "copilot-home");
    cpSync(COPILOT_CLI_FIXTURE_HOME, copilotHome, { recursive: true, filter: (source) => path.basename(source) !== "logs" });
    const storeDb = path.join(dir, "session-store.db");
    seedCopilotSessionStore(storeDb, "2026-10-27T11:00:00.000Z");
    writeUsageDebugLog(path.join(dir, "debug-logs"));
    writeSavingsVscodeSession({ sessionStoreDbPath: storeDb, debugLogsDir: path.join(dir, "debug-logs"), startedAt: "2026-10-28T10:00:00.000Z" });
    writeCopilotCliAgentHostStores(userDataDir);
    writeSavingsAgentHostSession({ userDataDir, copilotHome, startedAtMs: Date.parse("2026-10-29T10:00:00.000Z") });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("loads an MCP server nothing calls, and fails rg three times the same way", async () => {
    const service = createExtensionApiService({
      sessionStoreDbPath: path.join(dir, "session-store.db"),
      debugLogsDirPaths: [path.join(dir, "debug-logs")],
      agentTracesDbPath: null,
      agentHostUserDataDir: userDataDir,
      copilotHome,
      vscodeSettingsPath: null,
      appSettings: new InMemoryAppSettingsStore(),
      learnScriptsDir: path.join(here, "../../fixtures/learn-scripts"),
      vendorProfilesDir: path.join(here, "../../fixtures/vendor-profiles"),
      appVersion: "0.0.0-test",
    });

    const report = savingsReportSchema.parse(await service.getSavingsReport({ since: "2026-10-01", until: "2026-11-06" }));

    await expect(json(report)).toMatchFileSnapshot("./__golden__/savings-copilot-sessions.json");
    const kinds = report.opportunities.map((o) => o.kind);
    expect(kinds).toContain("unused-tools");
    expect(kinds).toContain("failed-tool-calls");
    const unused = report.opportunities.find((o) => o.kind === "unused-tools")!;
    expect(unused.subject).toBe("acmedocs");
    expect(unused.sessions).toEqual([{ providerId: "vscode", sessionId: SAVINGS_VSCODE_SESSION_ID }]);
    expect(unused.evidence.tokens).toMatchObject({ known: true });
    const failed = report.opportunities.find((o) => o.kind === "failed-tool-calls")!;
    expect(failed.subject).toBe("rg");
    expect(failed.evidence.occurrences).toBe(3);
    expect(failed.sessions).toEqual([{ providerId: "vscode", sessionId: SAVINGS_AGENT_HOST_SESSION_ID }]);
  });
});
