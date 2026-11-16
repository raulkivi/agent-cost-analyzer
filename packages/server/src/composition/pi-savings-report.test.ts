// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// V27 (savings-increment-3.md §7.1): the standalone app's savings report over
// V14's real pi captures. The model is a local one the price book doesn't
// know, so pi's rows show tokens and requests and the amount is Not priced;
// pi sessions with system messages are no longer "no tool inventory".
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { FIXTURE_VENDOR_PROFILES_DIR } from "../test-support/vendor-profiles-dir.js";
import { createStandaloneApiService } from "./create-standalone-api-service.js";

const generatedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/pi-agent/generated");
const settingsDir = mkdtempSync(path.join(tmpdir(), "pi-savings-"));
afterAll(() => rmSync(settingsDir, { recursive: true, force: true }));

describe("getSavingsReport over the real pi fixtures", () => {
  const app = createStandaloneApiService({
    appSettingsDir: settingsDir,
    vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR,
    appVersion: "0.0.0-test",
    claudeCodeProjectsDirPath: null,
    piAgentSessionsDirPath: generatedDir,
    mitmproxyCapturesDirPath: null,
    vscodeSettingsPath: null,
    learnScriptsDir: path.join(FIXTURE_VENDOR_PROFILES_DIR, "..", "learn-scripts"),
    // The fixtures were captured on 2026-11-14.
    now: () => new Date("2026-11-16T10:00:00Z"),
  });

  it("lists pi's unused tools with tokens per request and the money Not priced, and no session under 'no tool inventory'", async () => {
    const report = await app.getSavingsReport({ provider: "pi-agent" });

    const rows = report.opportunities.filter((row) => row.kind === "unused-tools");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.evidence.tokens).toMatchObject({ known: true, estimated: true });
      expect(row.perWindow).toMatchObject({ known: false, reason: expect.stringContaining("vendor is unknown") });
      expect(row.tools?.length).toBeGreaterThan(0);
      expect(row.coverage.sessionsAnalysed).toBe(row.coverage.sessionsInWindow);
    }
    expect(rows.map((row) => row.subject)).toContain("write");
    const unusedToolsNotAnalysed = report.notAnalysed.filter((entry) => entry.kind === "unused-tools");
    expect(unusedToolsNotAnalysed.filter((entry) => entry.reason.includes("no tool inventory"))).toEqual([]);
  });
});
